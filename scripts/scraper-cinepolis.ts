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
  console.log('🎬 Iniciando scraper de Cinépolis Colombia (APIs directas)...');

  // ── STEP 1: Fetch all cities + complexes directly (no browser needed) ─────
  let allCities: any[] = [];
  try {
    const citiesRes = await fetch(
      `${BASE}/manejadores/CiudadesComplejos.ashx?EsVIP=false`,
      { headers: HEADERS }
    ).then(r => r.json());

    allCities = Array.isArray(citiesRes) ? citiesRes : Object.values(citiesRes);
    console.log(`   📍 ${allCities.length} ciudades en CiudadesComplejos`);

    if (allCities[0]) {
      console.log(`   Ciudad[0] keys: ${Object.keys(allCities[0]).join(', ')}`);
      if (allCities[0].Complejos?.[0]) {
        console.log(`   Complejo[0] keys: ${Object.keys(allCities[0].Complejos[0]).join(', ')}`);
      }
    }

    // Save all cinemas with coords from this endpoint
    for (const city of allCities) {
      const rawName: string = city.Nombre ?? city.name ?? '';
      const cSlug = citySlugFromText(rawName || city.Clave || '');
      const displayName = rawName.replace(/, Colombia.*$/i, '').trim();
      const cityId = await getOrCreateCity(cSlug, displayName);
      if (!cityId) continue;

      const cityLat = parseFloat(city.GeoX ?? '') || undefined;
      const cityLng = parseFloat(city.GeoY ?? '') || undefined;

      for (const complejo of city.Complejos ?? []) {
        const cName: string = complejo.Nombre ?? complejo.name ?? '';
        const cLat = parseFloat(complejo.GeoX ?? complejo.lat ?? '') || cityLat;
        const cLng = parseFloat(complejo.GeoY ?? complejo.lng ?? '') || cityLng;
        if (cName) await getOrCreateCinema(cName, cityId, cLat, cLng);
      }
    }
  } catch (err) {
    console.error('   ❌ Error en CiudadesComplejos:', err);
  }

  // ── STEP 2: For each city, POST to GetNowPlayingByCity ────────────────────
  const citiesToScrape = allCities.length > 0
    ? allCities
    : [
        { Clave: 'bogota-colombia', Nombre: 'Bogotá' },
        { Clave: 'cali-colombia', Nombre: 'Cali' },
        { Clave: 'barranquilla-colombia', Nombre: 'Barranquilla' },
        { Clave: 'manizales-colombia', Nombre: 'Manizales' },
        { Clave: 'barrancabermeja-colombia', Nombre: 'Barrancabermeja' },
        { Clave: 'pasto-colombia', Nombre: 'Pasto' },
        { Clave: 'armenia-colombia', Nombre: 'Armenia' },
      ];

  let firstCityLogged = false;
  for (const city of citiesToScrape) {
    const cityKey: string = city.Clave ?? city.clave ?? '';
    const citySlug = citySlugFromText(city.Nombre ?? cityKey);
    const cityId = await getOrCreateCity(citySlug, (city.Nombre ?? '').replace(/, Colombia.*$/i, '').trim());
    if (!cityId) continue;

    try {
      const res = await fetch(`${BASE}/Cartelera.aspx/GetNowPlayingByCity`, {
        method: 'POST',
        headers: { ...HEADERS, 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ ciudad: cityKey }),
      });
      if (!res.ok) { console.log(`   ⚠️  GetNowPlayingByCity ${cityKey}: ${res.status}`); continue; }

      const json = await res.json();
      const movies: any[] = json?.d ?? [];

      if (!firstCityLogged && movies.length > 0) {
        firstCityLogged = true;
        console.log(`\n   📋 GetNowPlayingByCity estructura (${cityKey}):`);
        console.log(`   Movie[0] keys: ${Object.keys(movies[0]).join(', ')}`);
        // Log nested array keys
        for (const [key, val] of Object.entries(movies[0])) {
          if (Array.isArray(val) && (val as any[]).length > 0) {
            console.log(`   ${key}[0] keys: ${Object.keys((val as any[])[0]).join(', ')}`);
            if ((val as any[])[0] && typeof (val as any[])[0] === 'object') {
              // One more level deep
              for (const [k2, v2] of Object.entries((val as any[])[0])) {
                if (Array.isArray(v2) && (v2 as any[]).length > 0) {
                  console.log(`   ${key}[0].${k2}[0] keys: ${Object.keys((v2 as any[])[0]).join(', ')}`);
                }
              }
            }
          }
        }
        console.log(`   Movie[0] preview: ${JSON.stringify(movies[0]).substring(0, 500)}\n`);
      }

      console.log(`   📍 ${citySlug}: ${movies.length} películas`);
      for (const m of movies) {
        await processCinepolisMovieEntry(m, cityId);
      }

    } catch (err) {
      console.error(`   ❌ ${cityKey}:`, (err as Error).message);
    }

    await new Promise(r => setTimeout(r, 500));
  }

  // ── STEP 3: Playwright fallback for DOM movie links (if APIs gave 0 movies) ─
  // This is a safety net — Playwright loads the page which triggers the APIs above
  // but also gives us DOM links as last resort
  const hasMovies = await supabase.from('screenings')
    .select('id', { count: 'exact', head: true })
    .gte('start_time', today + 'T00:00:00');

  if ((hasMovies.count ?? 0) === 0) {
    console.log('   ⚠️  0 funciones en DB, intentando Playwright...');
    await scrapeCinepolisPlaywright();
  }

  console.log('\n✅ Cinépolis Scraper finalizado.');
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
