import { chromium } from 'playwright';
import { supabaseAdmin as supabase } from '../lib/supabase-admin';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(process.cwd(), '.env.local') });

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
];

function isValidMovieTitle(title: string): boolean {
  if (!title || title.trim().length < 3) return false;
  return !GARBAGE_PATTERNS.some(p => p.test(title.trim()));
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

async function getOrCreateCinema(name: string, cityId: number, address?: string): Promise<number | null> {
  const { data } = await supabase
    .from('cinemas').select('id').eq('name', name).eq('city_id', cityId).single();
  if (data) return data.id;
  const { data: created, error } = await supabase
    .from('cinemas').insert({ name, city_id: cityId, chain: 'cinemark', address: address ?? null })
    .select('id').single();
  if (error) { console.error('Error creando cine:', error.message); return null; }
  return created?.id ?? null;
}

// Cinemark Colombia city URL slugs
const CITIES: Record<string, string> = {
  bogota: 'bogota',
  medellin: 'medellin',
  cali: 'cali',
  barranquilla: 'barranquilla',
  bucaramanga: 'bucaramanga',
  cartagena: 'cartagena',
};

export async function scrapeCinemark() {
  console.log('🎬 Iniciando scraper REAL de CINEMARK...');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });

  try {
    // Cinemark has one national billboard page; city filter is applied client-side
    // We scrape the global page once and get all movies+cinemas from __NEXT_DATA__
    const capturedApiData: any[] = [];
    const page = await context.newPage();

    await page.route('**/*', async (route, request) => {
      const url = request.url();
      if (request.method() === 'GET' &&
        (url.includes('/api/') || url.includes('graphql') ||
         url.includes('movies') || url.includes('showtimes') ||
         url.includes('billboard') || url.includes('cinemark'))) {
        const response = await route.fetch();
        const ct = response.headers()['content-type'] ?? '';
        if (ct.includes('application/json')) {
          try {
            const body = await response.json();
            capturedApiData.push({ url, body });
          } catch { /* ignore */ }
        }
        await route.fulfill({ response });
      } else {
        await route.continue();
      }
    });

    try {
      await page.goto('https://www.cinemark.com.co/', {
        waitUntil: 'networkidle', timeout: 45000,
      });
    } catch {
      await page.goto('https://www.cinemark.com.co/', {
        waitUntil: 'domcontentloaded', timeout: 30000,
      });
    }
    await page.waitForTimeout(4000);

    const nextDataStr = await page.evaluate(() => {
      const el = document.getElementById('__NEXT_DATA__');
      return el?.textContent ?? null;
    });

    if (nextDataStr) {
      const nd = JSON.parse(nextDataStr);
      const pp = nd?.props?.pageProps ?? {};
      console.log(`   __NEXT_DATA__ pageProps keys: ${Object.keys(pp).join(', ')}`);

      // PremieresBillboard is the actual cartelera data — log first item structure
      const premiereBillboard = pp.PremieresBillboard;
      if (premiereBillboard) {
        const sample = Array.isArray(premiereBillboard)
          ? premiereBillboard[0]
          : typeof premiereBillboard === 'object' ? premiereBillboard : null;
        if (sample) console.log(`   PremieresBillboard sample keys: ${Object.keys(sample).join(', ')}`);
      }

      // Try all known Cinemark data paths
      const movies: any[] =
        (Array.isArray(pp.PremieresBillboard) ? pp.PremieresBillboard : null) ||
        pp.PremieresBillboard?.movies ||
        pp.PremieresBillboard?.Films ||
        pp.PremieresBillboard?.films ||
        pp.movies ||
        pp.billboard?.movies ||
        [];

      console.log(`   ${movies.length} películas en __NEXT_DATA__`);

      for (const m of movies) {
        await processMovieGlobal(m);
      }
    }

    // Process intercepted API responses — these may have showtime+cinema data
    for (const { url, body } of capturedApiData) {
      const movies: any[] =
        body?.movies ?? body?.data?.movies ?? body?.Films ?? body?.films ??
        body?.results ?? (Array.isArray(body) ? body : []);

      if (movies.length > 0) {
        console.log(`   ${movies.length} películas en API: ${url.substring(0, 70)}`);
        // Try to find cinema context from URL
        const citySlug = Object.keys(CITIES).find(c => url.toLowerCase().includes(c)) ?? '';
        const cityId = citySlug ? await getOrCreateCity(citySlug) : null;

        for (const m of movies) {
          if (cityId) {
            await processMovie(m, cityId);
          } else {
            await processMovieGlobal(m);
          }
        }
      }
    }

    await page.unroute('**/*');
    await page.close();

    // Per-city pages for showtimes
    for (const [citySlug, dbSlug] of Object.entries(CITIES)) {
      console.log(`\n📍 Funciones Cinemark en: ${dbSlug}`);
      const cityId = await getOrCreateCity(dbSlug);
      if (!cityId) continue;

      const cityPage = await context.newPage();
      const cityApiData: any[] = [];

      await cityPage.route('**/*', async (route, request) => {
        const url = request.url();
        if (request.method() === 'GET' &&
          (url.includes('/api/') || url.includes('showtimes') || url.includes('horarios') ||
           url.includes('billboard') || url.includes('schedule'))) {
          const response = await route.fetch();
          const ct = response.headers()['content-type'] ?? '';
          if (ct.includes('application/json')) {
            try { cityApiData.push({ url, body: await response.json() }); } catch { /* ignore */ }
          }
          await route.fulfill({ response });
        } else {
          await route.continue();
        }
      });

      try {
        // Try city-specific URL formats
        await cityPage.goto(`https://www.cinemark.com.co/cartelera/${citySlug}`, {
          waitUntil: 'domcontentloaded', timeout: 25000,
        });
        await cityPage.waitForTimeout(3000);

        const cityNd = await cityPage.evaluate(() => {
          const el = document.getElementById('__NEXT_DATA__');
          return el?.textContent ?? null;
        });

        if (cityNd) {
          const nd = JSON.parse(cityNd);
          const pp = nd?.props?.pageProps ?? {};
          console.log(`   ${dbSlug} __NEXT_DATA__ keys: ${Object.keys(pp).join(', ')}`);

          // Check for showtime data in city page
          const showtimes: any[] =
            (Array.isArray(pp.PremieresBillboard) ? pp.PremieresBillboard : null) ||
            pp.showtimes ||
            pp.Showtimes ||
            [];

          for (const s of showtimes) {
            await processShowtime(s, cityId, dbSlug);
          }
        }

        // Process city-level API data
        for (const { url, body } of cityApiData) {
          const movies: any[] =
            body?.movies ?? body?.Films ?? body?.films ??
            body?.results ?? (Array.isArray(body) ? body : []);
          if (movies.length > 0) {
            console.log(`   ${movies.length} items en API ciudad: ${url.substring(0, 70)}`);
            for (const m of movies) await processMovie(m, cityId);
          }
        }
      } catch (e) {
        console.error(`   ❌ Error en ciudad ${dbSlug}:`, e);
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

async function processMovieGlobal(m: any) {
  const title: string = cleanTitle(m.title ?? m.Title ?? m.nombre ?? m.name ?? '');
  if (!isValidMovieTitle(title)) return;
  const slug = m.slug ?? slugify(title);
  await supabase.from('movies').upsert(
    {
      slug, title,
      poster_url: m.poster_url ?? m.poster ?? m.PosterUrl ?? m.image ?? null,
      description: m.synopsis ?? m.description ?? m.Synopsis ?? null,
      duration_minutes: parseInt(m.duration ?? m.Duration ?? m.duracion ?? '0') || null,
      rating: m.rating ?? m.Rating ?? m.clasificacion ?? null,
      genres: (m.genres ?? m.Genres ?? m.generos ?? []).map((g: any) => g?.name ?? g?.Name ?? g ?? ''),
    },
    { onConflict: 'slug' }
  );
}

async function processMovie(m: any, cityId: number) {
  const title: string = cleanTitle(m.title ?? m.Title ?? m.nombre ?? m.name ?? '');
  if (!isValidMovieTitle(title)) return;
  const slug = m.slug ?? slugify(title);

  const { data: movie } = await supabase.from('movies').upsert(
    {
      slug, title,
      poster_url: m.poster_url ?? m.poster ?? m.PosterUrl ?? m.image ?? null,
      description: m.synopsis ?? m.description ?? m.Synopsis ?? null,
      duration_minutes: parseInt(m.duration ?? m.Duration ?? m.duracion ?? '0') || null,
      rating: m.rating ?? m.Rating ?? m.clasificacion ?? null,
      genres: (m.genres ?? m.Genres ?? m.generos ?? []).map((g: any) => g?.name ?? g?.Name ?? g ?? ''),
    },
    { onConflict: 'slug' }
  ).select('id').single();

  if (!movie) return;

  const showings: any[] = m.showings ?? m.Showings ?? m.screenings ?? m.functions ?? m.showtimes ?? m.Showtimes ?? [];
  for (const showing of showings) {
    await processShowtime(showing, cityId, '', movie.id);
  }
}

async function processShowtime(showing: any, cityId: number, _citySlug: string, movieIdOverride?: number) {
  const cinemaName: string = showing.cinema?.name ?? showing.Cinema?.Name ?? showing.theater?.name ?? showing.CinemaName ?? showing.name ?? '';
  if (!cinemaName) return;
  const cinemaId = await getOrCreateCinema(cinemaName, cityId);
  if (!cinemaId) return;

  // Resolve movie if not overridden
  let movieId = movieIdOverride;
  if (!movieId) {
    const title = showing.movie?.title ?? showing.Movie?.Title ?? showing.movieTitle ?? '';
    if (!title) return;
    const slug = slugify(title);
    const { data: m } = await supabase.from('movies').upsert({ slug, title }, { onConflict: 'slug' }).select('id').single();
    movieId = m?.id;
  }
  if (!movieId) return;

  const schedules: any[] = showing.schedules ?? showing.Schedules ?? showing.horarios ?? (showing.time ? [showing] : []);
  const today = new Date().toISOString().split('T')[0];

  for (const sched of schedules) {
    const rawTime: string = sched.time ?? sched.Time ?? sched.hora ?? sched.start_time ?? sched.StartTime ?? '';
    if (!rawTime) continue;
    const startTime = /^\d{1,2}:\d{2}$/.test(rawTime)
      ? `${today}T${rawTime.padStart(5, '0')}:00`
      : rawTime;

    await supabase.from('screenings').upsert(
      {
        movie_id: movieId, cinema_id: cinemaId, start_time: startTime,
        format: sched.format ?? sched.Format ?? sched.formato ?? '2D',
        language: sched.language ?? sched.Language ?? sched.idioma ?? 'subtitulada',
        buy_url: null,
      },
      { onConflict: 'movie_id,cinema_id,start_time' }
    );
  }
}
