/**
 * Cinépolis Colombia scraper
 * Uses confirmed real APIs (captured from Playwright logs):
 * 1. GET  /manejadores/CiudadesComplejos.ashx?EsVIP=false  → all cities + complexes + coords
 * 2. POST /Cartelera.aspx/GetNowPlayingByCity              → movies per city  (ASP.NET {d:[...]})
 * 3. DOM fallback for movie title/poster extraction from cartelera page
 */
import { chromium } from 'playwright';
import { supabaseAdmin as supabase } from '../lib/supabase-admin';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(process.cwd(), '.env.local') });

const today = new Date().toISOString().split('T')[0];
const BASE = 'https://cinepolis.com.co';
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Accept': 'application/json, text/javascript, */*',
  'Accept-Language': 'es-CO,es;q=0.9',
  'Referer': BASE + '/',
};

function slugify(text: string): string {
  return text.toLowerCase().normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function cleanTitle(raw: string): string {
  return raw.replace(/[\s\n\r]+/g, ' ')
    .replace(/\s*\(?\s*(REESTRENO\s*-?\s*)?/i, (m) => m.includes('REESTRENO') ? '' : m)
    .replace(/^REESTRENO\s*-?\s*/i, '')
    .replace(/\s*\(?\s*(DOB|SUB|DUBBED|SUBTITULAD[AO])\s*(2D|3D|IMAX|4DX|XD|PRE|BIS)?\s*[A-Z]*\s*\)?\s*$/i, '')
    .replace(/\s*\(?\s*(2D|3D|IMAX|4DX|XD|PREMIUM|PRE|BIS)\s*\)?\s*$/i, '')
    .trim();
}

const GARBAGE_PATTERNS = [
  /^(top[\s-]+)?banner/i, /^horario[\s-]+apertura/i, /\bmembership\b/i,
  /\bactivated\b/i, /\bworld[\s-]+tour\b/i, /\blive[\s-]+viewing\b/i,
  /arirang/i, /^bts\b/i, /^standar(d)?$/i, /^cine[\s-]club/i,
  /^todas las pel/i, /^disponibles?$/i,
];

function isValidMovieTitle(title: string): boolean {
  if (!title || title.trim().length < 2) return false;
  return !GARBAGE_PATTERNS.some(p => p.test(title.trim()));
}

function normalizeFormat(raw: string): string {
  const f = (raw ?? '').toUpperCase();
  if (f.includes('IMAX')) return 'IMAX';
  if (f.includes('4DX')) return '4DX';
  if (f.includes('XD')) return 'XD';
  if (f.includes('PREMIUM')) return 'PREMIUM';
  if (f.includes('3D')) return '3D';
  return '2D';
}

function normalizeLanguage(raw: string): 'subtitulada' | 'doblada' | 'original' {
  const l = (raw ?? '').toLowerCase();
  if (l.includes('dob') || l.includes('dub')) return 'doblada';
  if (l.includes('orig')) return 'original';
  return 'subtitulada';
}

function citySlugFromText(text: string): string {
  const norm = text.toLowerCase().normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/,\s*colombia.*$/i, '')
    .replace(/-colombia$/i, '')
    .trim().replace(/\s+/g, '-');
  const MAP: Record<string, string> = {
    bogota: 'bogota', medellin: 'medellin', cali: 'cali',
    barranquilla: 'barranquilla', bucaramanga: 'bucaramanga',
    cartagena: 'cartagena', manizales: 'manizales', pereira: 'pereira',
    barrancabermeja: 'barrancabermeja', cucuta: 'cucuta',
    villavicencio: 'villavicencio', 'santa-marta': 'santa-marta',
    monteria: 'monteria', armenia: 'armenia', pasto: 'pasto',
    ibague: 'ibague', neiva: 'neiva', palmira: 'palmira',
  };
  return MAP[norm] ?? norm;
}

async function getOrCreateCity(slug: string, displayName?: string): Promise<number | null> {
  const { data } = await supabase.from('cities').select('id').eq('slug', slug).single();
  if (data) return data.id;
  const name = displayName ?? slug.charAt(0).toUpperCase() + slug.slice(1);
  const { data: c, error } = await supabase.from('cities').insert({ slug, name }).select('id').single();
  if (error) { console.error('Error ciudad:', error.message); return null; }
  return c?.id ?? null;
}

async function getOrCreateCinema(name: string, cityId: number, lat?: number, lng?: number): Promise<number | null> {
  const { data } = await supabase.from('cinemas').select('id, lat').eq('name', name).eq('city_id', cityId).single();
  if (data) {
    // Update coords if we now have them and didn't before
    if (lat && lng && !data.lat) {
      await supabase.from('cinemas').update({ lat, lng }).eq('id', (data as any).id);
    }
    return (data as any).id;
  }
  const { data: c, error } = await supabase.from('cinemas')
    .insert({ name, city_id: cityId, chain: 'cinepolis', lat: lat ?? null, lng: lng ?? null })
    .select('id').single();
  if (error) { console.error('Error cine:', error.message); return null; }
  return c?.id ?? null;
}

// Process a movie from GetNowPlayingByCity.d response
async function processCinepolisMovieEntry(m: any, defaultCityId: number) {
  // Field names are unknown until first log — try many patterns
  const title = cleanTitle(
    m.Titulo ?? m.Title ?? m.title ?? m.PeliculaNombre ?? m.Nombre ?? m.nombre ?? ''
  );
  if (!isValidMovieTitle(title)) return;

  const slug = m.Slug ?? m.slug ?? m.SlugName ?? slugify(title);
  const { data: movie } = await supabase.from('movies').upsert({
    slug, title,
    poster_url: m.PosterUrl ?? m.Poster ?? m.poster ?? m.ImagenUrl ?? m.imagen ?? m.Image ?? null,
    rating: m.Clasificacion ?? m.Rating ?? m.clasificacion ?? null,
    description: m.Sinopsis ?? m.Synopsis ?? m.sinopsis ?? null,
    duration_minutes: parseInt(String(m.Duracion ?? m.Duration ?? m.duracion ?? '0')) || null,
    genres: m.Genero ? [m.Genero] : (m.Generos ?? m.generos ?? []),
  }, { onConflict: 'slug' }).select('id').single();

  if (!movie) return;

  // Showtimes nested under cinema/complejo blocks
  const complejos: any[] = m.Complejos ?? m.Cines ?? m.Cinemas ?? m.Sedes ?? m.theaters ?? [];

  let totalScreenings = 0;
  for (const c of complejos) {
    const cinemaName: string = c.Nombre ?? c.Name ?? c.name ?? c.ComplexName ?? '';
    if (!cinemaName) continue;

    const rawCity: string = c.Ciudad ?? c.City ?? c.ciudad ?? '';
    const cSlug = rawCity ? citySlugFromText(rawCity) : '';
    const cCityId = cSlug ? (await getOrCreateCity(cSlug) ?? defaultCityId) : defaultCityId;

    const cinemaLat = parseFloat(c.GeoX ?? c.lat ?? c.Lat ?? '') || undefined;
    const cinemaLng = parseFloat(c.GeoY ?? c.lng ?? c.Lng ?? '') || undefined;

    const cinemaId = await getOrCreateCinema(cinemaName, cCityId, cinemaLat, cinemaLng);
    if (!cinemaId) continue;

    const funciones: any[] = c.Funciones ?? c.Horarios ?? c.Sessions ?? c.Showtimes ?? c.horarios ?? [];
    for (const f of funciones) {
      const rawTime: string = f.Hora ?? f.Time ?? f.hora ?? f.time ?? f.Horario ?? f.HoraInicio ?? '';
      if (!rawTime) continue;

      const startTime = /^\d{1,2}:\d{2}$/.test(rawTime)
        ? `${today}T${rawTime.padStart(5, '0')}:00` : rawTime;

      await supabase.from('screenings').upsert({
        movie_id: movie.id, cinema_id: cinemaId, start_time: startTime,
        format: normalizeFormat(f.Sala ?? f.Format ?? f.Tipo ?? f.sala ?? '2D'),
        language: normalizeLanguage(f.Idioma ?? f.Language ?? f.idioma ?? 'subtitulada'),
        buy_url: f.UrlCompra ?? f.BuyUrl ?? f.buy_url ?? null,
      }, { onConflict: 'movie_id,cinema_id,start_time' });
      totalScreenings++;
    }
  }

  if (totalScreenings > 0) console.log(`      ✅ ${title}: ${totalScreenings} funciones`);
}

export async function scrapeCinepolis() {
  console.log('🎬 Iniciando scraper de Cinépolis Colombia (API 100% Reescrita)...');

  // 1. Get all cities + complexes first
  let allCities: any[] = [];
  try {
    const citiesRes = await fetch(
      `${BASE}/manejadores/CiudadesComplejos.ashx?EsVIP=false`,
      { headers: HEADERS }
    ).then(r => r.json());
    allCities = Array.isArray(citiesRes) ? citiesRes : Object.values(citiesRes);
    console.log(`   📍 ${allCities.length} ciudades encontradas`);

    for (const city of allCities) {
      const citySlug = citySlugFromText(city.Nombre ?? '');
      const cityId = await getOrCreateCity(citySlug, city.Nombre);
      if (!cityId) continue;

      for (const complejo of city.Complejos ?? []) {
        await getOrCreateCinema(complejo.Nombre, cityId, parseFloat(complejo.GeoX), parseFloat(complejo.GeoY));
      }
    }
  } catch (err) {
    console.error('   ❌ Error en CiudadesComplejos:', err);
  }

  // 2. For each city, fetch the nested showtimes structure
  for (const city of allCities) {
    const cityKey: string = city.Clave ?? '';
    const citySlug = citySlugFromText(city.Nombre ?? '');
    const cityId = await getOrCreateCity(citySlug);
    if (!cityId || !cityKey) continue;

    console.log(`   📍 ${citySlug} (${cityKey})`);
    try {
      const res = await fetch(`${BASE}/Cartelera.aspx/GetNowPlayingByCity`, {
        method: 'POST',
        headers: { ...HEADERS, 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ claveCiudad: cityKey, esVIP: false }),
      });
      if (!res.ok) continue;

      const json = await res.json();
      // Try multiple response structures
      const cinemas: any[] = json?.d?.Cinemas ?? json?.Cinemas ?? json?.d ?? [];
      console.log(`      Found ${cinemas.length} cinemas, keys: ${JSON.stringify(Object.keys(json?.d ?? json ?? {})).substring(0, 120)}`);
      if (cinemas.length > 0) {
        const sample = cinemas[0];
        console.log(`      Sample cinema keys: ${Object.keys(sample).join(', ')}`);
        console.log(`      Dates length: ${(sample.Dates ?? sample.dates ?? []).length}, sample date keys: ${JSON.stringify(Object.keys((sample.Dates ?? sample.dates ?? [])[0] ?? {}))}`);
      }

      for (const c of cinemas) {
        const cinemaId = await getOrCreateCinema(c.Name, cityId, parseFloat(c.Lat), parseFloat(c.Lng));
        if (!cinemaId) continue;

        let cinemaFunctions = 0;
        const dates = c.Dates ?? c.dates ?? c.ShowDates ?? [];
        
        for (const dateObj of dates) {
          const dateStr: string = dateObj.DateQuery; // YYYYMMDD
          if (!dateStr || dateStr.length < 8) continue;
          
          const formattedDate = `${dateStr.substring(0, 4)}-${dateStr.substring(4, 6)}-${dateStr.substring(6, 8)}`;
          const moviesInDate = dateObj.Movies ?? [];

          for (const m of moviesInDate) {
            const title = cleanTitle(m.Title ?? m.Nombre ?? '');
            if (!isValidMovieTitle(title)) continue;

            const movieSlug = m.Slug ?? m.Key ?? slugify(title);
            const { data: dbMovie } = await supabase.from('movies').upsert({
              slug: movieSlug, title,
              poster_url: m.Poster || m.Image || null,
              rating: m.Rating || null,
              duration_minutes: parseInt(m.RunTime ?? m.Duration ?? '0') || null,
              genres: m.Gender ? [m.Gender] : (m.Genre ? [m.Genre] : []),
              description: m.Synopsis || m.Sinopsis || null,
              is_estreno: m.IsPremiere === true || m.Premiere === true,
              is_preventa: m.IsPresale === true || m.Presale === true,
            }, { onConflict: 'slug' }).select('id').single();

            if (!dbMovie) continue;

            const formats = m.Formats ?? [];
            for (const format of formats) {
              const showtimes = format.Showtimes ?? format.ShowTimes ?? [];
              for (const showtime of showtimes) {
                const time = showtime.Time; // "21:30"
                if (!time) continue;
                
                const startTime = `${formattedDate}T${time}:00`;

                await supabase.from('screenings').upsert({
                  movie_id: dbMovie.id,
                  cinema_id: cinemaId,
                  start_time: startTime,
                  format: normalizeFormat(format.Name),
                  language: normalizeLanguage(format.Language),
                  buy_url: null,
                }, { onConflict: 'movie_id,cinema_id,start_time' });
                cinemaFunctions++;
              }
            }
          }
        }
        if (cinemaFunctions > 0) console.log(`      ✅ ${c.Name}: ${cinemaFunctions} funciones`);
      }
    } catch (err) {
      console.error(`      ❌ Error en ${citySlug}:`, (err as Error).message);
    }
  }

  console.log('\n✅ Cinépolis Scraper finalizado con éxito.');
}

async function scrapeCinepolisPlaywright() {
  const browser = await chromium.launch({
    headless: true,
    args: ['--disable-blink-features=AutomationControlled', '--no-sandbox'],
  });
  const ctx = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    locale: 'es-CO', timezoneId: 'America/Bogota',
  });
  await ctx.addInitScript(() => { Object.defineProperty(navigator, 'webdriver', { get: () => undefined }); });

  const cities = ['bogota', 'cali', 'barranquilla', 'manizales'];

  for (const city of cities) {
    const page = await ctx.newPage();
    const capturedApis: { url: string; body: any }[] = [];

    await page.route('**/*', async (route, request) => {
      const response = await route.fetch();
      const ct = response.headers()['content-type'] ?? '';
      if (ct.includes('application/json')) {
        try { capturedApis.push({ url: request.url(), body: await response.json() }); } catch { /**/ }
      }
      await route.fulfill({ response });
    });

    try {
      await page.goto(`${BASE}/cartelera/${city}-colombia`, { waitUntil: 'networkidle', timeout: 40000 });
      await page.waitForTimeout(4000);

      // Process GetNowPlayingByCity from captured APIs
      for (const { url, body } of capturedApis) {
        if (url.includes('GetNowPlayingByCity')) {
          const movies: any[] = body?.d ?? [];
          console.log(`   [PW] ${city}: ${movies.length} películas en GetNowPlayingByCity`);
          const cityId = await getOrCreateCity(city);
          if (cityId) for (const m of movies) await processCinepolisMovieEntry(m, cityId);
        }
      }
    } catch (err) {
      console.error(`   ❌ PW ${city}:`, (err as Error).message);
    } finally {
      await page.unroute('**/*');
      await page.close();
    }
  }
  await browser.close();
}
