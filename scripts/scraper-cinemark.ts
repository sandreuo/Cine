import { chromium } from 'playwright';
import { supabaseAdmin as supabase } from '../lib/supabase-admin';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(process.cwd(), '.env.local') });

const today = new Date().toISOString().split('T')[0];

function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function cleanTitle(raw: string): string {
  return raw
    .replace(/[\s\n\r]+/g, ' ')
    .replace(/\s*\(?\s*(DOB|SUB|DUBBED|SUBTITULAD[AO])\s*(2D|3D|IMAX|4DX|XD)?\s*\)?\s*$/i, '')
    .replace(/\s*\(?\s*(2D|3D|IMAX|4DX|XD)\s*\)?\s*$/i, '')
    .trim();
}

const GARBAGE_PATTERNS = [
  /^(top[\s-]+)?banner/i,
  /^horario[\s-]+apertura/i,
  /\bmembership\b/i,
  /\bactivated\b/i,
  /\bworld[\s-]+tour\b/i,
  /\blive[\s-]+viewing\b/i,
  /arirang/i,
  /^bts\b/i,
  /^standar(d)?$/i,
  /^cine[\s-]club/i,
];

function isValidMovieTitle(title: string): boolean {
  if (!title || title.trim().length < 2) return false;
  return !GARBAGE_PATTERNS.some(p => p.test(title.trim()));
}

function normalizeFormat(raw: string): string {
  const f = raw.toUpperCase().trim();
  if (f.includes('IMAX')) return 'IMAX';
  if (f.includes('4DX')) return '4DX';
  if (f.includes('XD')) return 'XD';
  if (f.includes('PREMIUM')) return 'PREMIUM';
  if (f.includes('3D')) return '3D';
  return '2D';
}

function normalizeLanguage(raw: string): 'subtitulada' | 'doblada' | 'original' {
  const l = raw.toLowerCase();
  if (l.includes('dob') || l.includes('dub')) return 'doblada';
  if (l.includes('orig')) return 'original';
  return 'subtitulada';
}

async function getOrCreateCity(slug: string): Promise<number | null> {
  const { data } = await supabase.from('cities').select('id').eq('slug', slug).single();
  if (data) return data.id;
  const name = slug.charAt(0).toUpperCase() + slug.slice(1);
  const { data: created, error } = await supabase
    .from('cities').insert({ slug, name }).select('id').single();
  if (error) { console.error('Error creando ciudad:', error.message); return null; }
  return created?.id ?? null;
}

async function getOrCreateCinema(name: string, cityId: number): Promise<number | null> {
  const { data } = await supabase
    .from('cinemas').select('id').eq('name', name).eq('city_id', cityId).single();
  if (data) return data.id;
  const { data: created, error } = await supabase
    .from('cinemas').insert({ name, city_id: cityId, chain: 'cinemark' })
    .select('id').single();
  if (error) { console.error('Error creando cine:', error.message); return null; }
  return created?.id ?? null;
}

// Cinemark Colombia city slugs
const CITIES = ['bogota', 'medellin', 'cali', 'barranquilla', 'bucaramanga', 'cartagena'];

// Upsert movie from a Cinemark PremieresBillboard item
async function upsertCinemarkMovie(m: any): Promise<number | null> {
  // Cinemark API fields confirmed from logs:
  // Title, SlugName, CoverImageUrl, GraphicUrl, Synopsis, SynopsisAlt, RunTime, Rating, GenreName
  const title = cleanTitle(m.Title ?? m.title ?? '');
  if (!isValidMovieTitle(title)) return null;

  const slug = m.SlugName ?? m.slug ?? slugify(title);
  const { data: movie, error } = await supabase.from('movies').upsert({
    slug, title,
    poster_url: m.CoverImageUrl ?? m.GraphicUrl ?? m.poster_url ?? m.poster ?? null,
    description: m.Synopsis ?? m.SynopsisAlt ?? m.synopsis ?? null,
    duration_minutes: parseInt(String(m.RunTime ?? m.duration ?? '0')) || null,
    rating: m.Rating ?? m.RatingAlt ?? m.rating ?? null,
    genres: m.GenreName ? [m.GenreName] : [],
    is_estreno: m.IsRelease === true || m.Premiere === true || m.IsPremiere === true,
    is_preventa: m.IsPresale === true || m.Presale === true,
  }, { onConflict: 'slug' }).select('id').single();

  if (error) { console.error(`Error upsert ${title}:`, error.message); return null; }
  return movie?.id ?? null;
}

// Save sessions from a PremieresBillboard item to screenings table
// Each item has: CinemaName, Sessions[], ScreenTypes[], LangTypes[]
async function saveCinemarkSessions(m: any, movieId: number, cityId: number) {
  const cinemaName: string = m.CinemaName ?? m.CinemaNameAlt ?? '';
  if (!cinemaName) return 0;

  const cinemaId = await getOrCreateCinema(cinemaName, cityId);
  if (!cinemaId) return 0;

  // ScreenTypes/LangTypes are arrays of strings (e.g. ["2D","3D"], ["Sub","Dob"])
  const screenTypes: string[] = m.ScreenTypes ?? [];
  const langTypes: string[] = m.LangTypes ?? [];

  // Sessions is array of individual showtime entries
  const sessions: any[] = m.Sessions ?? [];
  if (sessions.length === 0) return 0;

  let saved = 0;
  for (const s of sessions) {
    // Session time field: Showtime (ISO string like "2026-04-04T14:30:00")
    const rawTime: string = s.Showtime ?? s.ShowTime ?? s.time ?? s.Time ?? s.start_time ?? '';
    if (!rawTime) continue;

    const startTime = /^\d{1,2}:\d{2}$/.test(rawTime)
      ? `${today}T${rawTime.padStart(5, '0')}:00`
      : rawTime;

    // Format/language may be per-session or inherited from parent
    const format = normalizeFormat(s.ScreenType ?? s.format ?? s.Format ?? screenTypes[0] ?? '2D');
    const language = normalizeLanguage(s.LangType ?? s.language ?? s.Language ?? langTypes[0] ?? 'subtitulada');

    const { error } = await supabase.from('screenings').upsert({
      movie_id: movieId, cinema_id: cinemaId, start_time: startTime,
      format, language, buy_url: null,
    }, { onConflict: 'movie_id,cinema_id,start_time' });

    if (!error) saved++;
  }
  return saved;
}

export async function scrapeCinemark() {
  console.log('🎬 Iniciando scraper REAL de CINEMARK...');

  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    locale: 'es-CO',
    timezoneId: 'America/Bogota',
  });

  // Cinema map from cities-theaters API: cinemaId → { name, citySlug }
  const cinemaMap: Record<string, { name: string; citySlug: string }> = {};

  try {
    // ── STEP 1: Load national page, capture all API data ──────────────────
    const capturedApiData: { url: string; body: any }[] = [];
    const page = await context.newPage();

    await page.route('**/*', async (route, request) => {
      const response = await route.fetch();
      const ct = response.headers()['content-type'] ?? '';
      if (ct.includes('application/json')) {
        try {
          const body = await response.json();
          capturedApiData.push({ url: request.url(), body });
        } catch { /* ignore */ }
      }
      await route.fulfill({ response });
    });

    try {
      await page.goto('https://www.cinemark.com.co/', { waitUntil: 'networkidle', timeout: 45000 });
    } catch {
      await page.goto('https://www.cinemark.com.co/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    }
    await page.waitForTimeout(5000);

    // Build cinema map from cities-theaters API
    for (const { url, body } of capturedApiData) {
      if (url.includes('cities-theaters')) {
        const cinemas: any[] = Array.isArray(body) ? body
          : body?.data ?? body?.theaters ?? body?.cinemas ?? [];
        for (const c of cinemas) {
          const id = String(c.CinemaId ?? c.id ?? c.Id ?? '');
          const name = c.CinemaName ?? c.Name ?? c.name ?? c.nombre ?? '';
          const city = (c.CityName ?? c.City ?? c.city ?? c.ciudad ?? '').toLowerCase()
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '');
          const citySlug = CITIES.find(s => city.includes(s)) ?? '';
          if (id && name) cinemaMap[id] = { name, citySlug };
        }
        console.log(`   📍 ${Object.keys(cinemaMap).length} cines en mapa (cities-theaters)`);
      }
    }

    // Parse national __NEXT_DATA__ — movie list + sessions by cinema
    const ndStr = await page.evaluate(() => document.getElementById('__NEXT_DATA__')?.textContent ?? null);
    let nationalMovies: any[] = [];

    if (ndStr) {
      const nd = JSON.parse(ndStr);
      const pp = nd?.props?.pageProps ?? {};
      console.log(`   __NEXT_DATA__ keys: ${Object.keys(pp).join(', ')}`);

      nationalMovies = Array.isArray(pp.PremieresBillboard) ? pp.PremieresBillboard : [];
      console.log(`   ${nationalMovies.length} ítems en PremieresBillboard nacional`);

      // Log first item structure for debugging
      if (nationalMovies.length > 0) {
        const sample = nationalMovies[0];
        console.log(`   Muestra keys: ${Object.keys(sample).join(', ')}`);
        console.log(`   CinemaName: "${sample.CinemaName}", Sessions count: ${sample.Sessions?.length ?? 0}`);
        if (sample.Sessions?.length > 0) console.log(`   Session[0] keys: ${Object.keys(sample.Sessions[0]).join(', ')}`);
        console.log(`   ScreenTypes: ${JSON.stringify(sample.ScreenTypes)}, LangTypes: ${JSON.stringify(sample.LangTypes)}`);
      }

      // Save movies (metadata only from national page)
      for (const m of nationalMovies) {
        await upsertCinemarkMovie(m);
      }
    }

    await page.unroute('**/*');
    await page.close();

    // ── STEP 2: Per-city pages for cinema-specific sessions ───────────────
    for (const citySlug of CITIES) {
      console.log(`\n📍 Cinemark ${citySlug}`);
      const cityId = await getOrCreateCity(citySlug);
      if (!cityId) continue;

      const cityApiData: { url: string; body: any }[] = [];
      const cityPage = await context.newPage();

      await cityPage.route('**/*', async (route, request) => {
        const response = await route.fetch();
        const ct = response.headers()['content-type'] ?? '';
        if (ct.includes('application/json')) {
          try { cityApiData.push({ url: request.url(), body: await response.json() }); } catch { /* ignore */ }
        }
        await route.fulfill({ response });
      });

      try {
        await cityPage.goto(`https://www.cinemark.com.co/cartelera/${citySlug}`, {
          waitUntil: 'domcontentloaded', timeout: 30000,
        });
        await cityPage.waitForTimeout(4000);

        const cityNd = await cityPage.evaluate(() => document.getElementById('__NEXT_DATA__')?.textContent ?? null);

        if (cityNd) {
          const nd = JSON.parse(cityNd);
          const pp = nd?.props?.pageProps ?? {};

          const items: any[] = Array.isArray(pp.PremieresBillboard) ? pp.PremieresBillboard : [];
          console.log(`   ${items.length} ítems en PremieresBillboard ciudad`);

          let totalScreenings = 0;
          for (const item of items) {
            // Each item = one movie at one cinema (CinemaName + Sessions)
            const movieId = await upsertCinemarkMovie(item);
            if (!movieId) continue;

            // Use CinemaId from item to find city from cinemaMap
            const cinemaIdStr = String(item.CinemaId ?? '');
            const mappedCity = cinemaMap[cinemaIdStr]?.citySlug ?? citySlug;
            const mappedCityId = mappedCity !== citySlug
              ? (await getOrCreateCity(mappedCity) ?? cityId)
              : cityId;

            const saved = await saveCinemarkSessions(item, movieId, mappedCityId);
            totalScreenings += saved;
          }
          console.log(`   ✅ ${totalScreenings} funciones guardadas`);
        }

        // Also process any API responses that have session data
        for (const { url, body } of cityApiData) {
          if (url.includes('cities-theaters')) continue; // skip cinema list
          const sessions: any[] = body?.Sessions ?? body?.sessions ?? body?.Showtimes ?? [];
          if (sessions.length > 0) {
            console.log(`   📡 ${sessions.length} sesiones en API: ${url.substring(0, 80)}`);
          }
        }

      } catch (e) {
        console.error(`   ❌ Error en ${citySlug}:`, (e as Error).message);
      } finally {
        await cityPage.unroute('**/*');
        await cityPage.close();
      }
    }

  } catch (err) {
    console.error('❌ Error fatal en Cinemark Scraper:', err);
  } finally {
    await browser.close();
    console.log('\n✅ Cinemark Scraper finalizado.');
  }
}
