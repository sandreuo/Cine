import { chromium, Route, Request } from 'playwright';
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

async function getOrCreateCity(slug: string): Promise<number | null> {
  const { data } = await supabase.from('cities').select('id').eq('slug', slug).single();
  if (data) return data.id;
  const name = slug.charAt(0).toUpperCase() + slug.slice(1);
  const { data: created, error } = await supabase
    .from('cities')
    .insert({ slug, name })
    .select('id')
    .single();
  if (error) { console.error('Error creando ciudad:', error.message); return null; }
  return created?.id ?? null;
}

async function getOrCreateCinema(
  name: string,
  cityId: number,
  address?: string
): Promise<number | null> {
  const { data } = await supabase
    .from('cinemas')
    .select('id')
    .eq('name', name)
    .eq('city_id', cityId)
    .single();
  if (data) return data.id;
  const { data: created, error } = await supabase
    .from('cinemas')
    .insert({ name, city_id: cityId, chain: 'cinemark', address: address ?? null })
    .select('id')
    .single();
  if (error) { console.error('Error creando cine:', error.message); return null; }
  return created?.id ?? null;
}

// Cinemark Colombia cities and their URL slugs
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
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });

  // Intercept Cinemark API calls to capture showtime data
  let capturedApiData: any[] = [];

  try {
    for (const [citySlug, dbSlug] of Object.entries(CITIES)) {
      console.log(`\n📍 Scrapeando Cinemark en: ${dbSlug}`);
      const cityId = await getOrCreateCity(dbSlug);
      if (!cityId) continue;

      capturedApiData = [];
      const page = await context.newPage();

      // Intercept API responses from Cinemark's backend
      await page.route('**/*', async (route: Route, request: Request) => {
        const url = request.url();
        const isApiCall =
          url.includes('/api/') ||
          url.includes('graphql') ||
          url.includes('/movies') ||
          url.includes('/showtimes') ||
          url.includes('/billboard') ||
          url.includes('/cartelera');

        if (isApiCall && request.method() === 'GET') {
          const response = await route.fetch();
          const contentType = response.headers()['content-type'] ?? '';
          if (contentType.includes('application/json')) {
            try {
              const body = await response.json();
              capturedApiData.push({ url, body });
              console.log(`   📡 API interceptada: ${url.substring(0, 80)}`);
            } catch {
              // Not JSON, ignore
            }
          }
          await route.fulfill({ response });
        } else {
          await route.continue();
        }
      });

      try {
        await page.goto(`https://www.cinemark.com.co/cartelera?ciudad=${citySlug}`, {
          waitUntil: 'networkidle',
          timeout: 45000,
        });
      } catch {
        // networkidle may timeout on heavy pages; try domcontentloaded as fallback
        try {
          await page.goto(`https://www.cinemark.com.co/`, {
            waitUntil: 'domcontentloaded',
            timeout: 30000,
          });
        } catch (e) {
          console.error(`   ❌ No se pudo cargar Cinemark para ${dbSlug}:`, e);
          await page.close();
          continue;
        }
      }

      await page.waitForTimeout(3000);

      // Try __NEXT_DATA__ first
      const nextDataStr = await page.evaluate(() => {
        const el = document.getElementById('__NEXT_DATA__');
        return el?.textContent ?? null;
      });

      if (nextDataStr) {
        const nd = JSON.parse(nextDataStr);
        const pp = nd?.props?.pageProps ?? {};
        console.log(`   __NEXT_DATA__ pageProps keys: ${Object.keys(pp).join(', ')}`);

        const movies: any[] =
          pp.movies ?? pp.billboard?.movies ?? pp.data?.movies ?? pp.initialData?.movies ?? [];

        console.log(`   ${movies.length} películas en __NEXT_DATA__`);

        for (const m of movies) {
          await processMovie(m, cityId);
        }
      }

      // Process any captured API data
      for (const { url, body } of capturedApiData) {
        const movies: any[] =
          body?.movies ??
          body?.data?.movies ??
          body?.billboard?.movies ??
          body?.results ??
          (Array.isArray(body) ? body : []);

        if (movies.length > 0) {
          console.log(`   ${movies.length} películas en API ${url.substring(0, 60)}`);
          for (const m of movies) {
            await processMovie(m, cityId);
          }
        }
      }

      // DOM fallback: scrape movie cards directly
      const domMovies = await page.evaluate(() => {
        const results: any[] = [];
        const cards = document.querySelectorAll(
          '.movie-card, article.pelicula, [class*="movie"], [class*="film"], [class*="pelicula"]'
        );
        cards.forEach((card) => {
          const titleEl = card.querySelector('h2, h3, h4, [class*="title"], [class*="titulo"]');
          const title = titleEl?.textContent?.trim() ?? '';
          const imgEl = card.querySelector('img');
          const poster = imgEl?.src ?? imgEl?.getAttribute('data-src') ?? null;
          const link = card.querySelector('a');
          const href = link?.href ?? null;
          if (title) results.push({ title, poster, href });
        });
        return results;
      });

      if (domMovies.length > 0) {
        console.log(`   ${domMovies.length} películas encontradas en DOM`);
        for (const dm of domMovies) {
          if (!dm.title) continue;
          const slug = slugify(dm.title);
          await supabase.from('movies').upsert(
            { slug, title: dm.title, poster_url: dm.poster },
            { onConflict: 'slug' }
          );
        }
      }

      await page.unroute('**/*');
      await page.close();
    }

    console.log('\n✅ Cinemark Scraper finalizado.');
  } catch (err) {
    console.error('❌ Error fatal en Cinemark Scraper:', err);
  } finally {
    await browser.close();
  }
}

async function processMovie(m: any, cityId: number) {
  const title: string = m.title ?? m.nombre ?? m.name ?? '';
  if (!title) return;

  const slug = m.slug ?? slugify(title);
  const poster = m.poster_url ?? m.poster ?? m.image ?? null;
  const description = m.synopsis ?? m.description ?? m.sinopsis ?? null;
  const duration = parseInt(m.duration ?? m.duracion ?? '0') || null;
  const rating = m.rating ?? m.clasificacion ?? null;
  const genres: string[] = (m.genres ?? m.generos ?? []).map(
    (g: any) => g?.name ?? g?.nombre ?? g ?? ''
  );

  console.log(`   🎥 Procesando: ${title}`);

  const { data: movie, error: movieErr } = await supabase
    .from('movies')
    .upsert(
      { slug, title, poster_url: poster, description, duration_minutes: duration, rating, genres },
      { onConflict: 'slug' }
    )
    .select('id')
    .single();

  if (movieErr || !movie) {
    console.error(`   ❌ Error guardando ${title}:`, movieErr?.message);
    return;
  }

  // Process showings if embedded in the movie object
  const showings: any[] =
    m.showings ?? m.screenings ?? m.functions ?? m.showtimes ?? m.horarios ?? [];

  for (const showing of showings) {
    const cinemaName: string =
      showing.cinema?.name ??
      showing.cinema?.nombre ??
      showing.theater?.name ??
      showing.name ??
      '';
    if (!cinemaName) continue;

    const cinemaId = await getOrCreateCinema(cinemaName, cityId);
    if (!cinemaId) continue;

    const schedules: any[] =
      showing.schedules ?? showing.horarios ?? showing.times ?? (showing.time ? [showing] : []);

    for (const sched of schedules) {
      const rawTime: string =
        sched.time ?? sched.hora ?? sched.start_time ?? sched.datetime ?? '';
      if (!rawTime) continue;

      let startTime: string;
      if (/^\d{1,2}:\d{2}$/.test(rawTime)) {
        const today = new Date().toISOString().split('T')[0];
        startTime = `${today}T${rawTime.padStart(5, '0')}:00`;
      } else {
        startTime = rawTime;
      }

      await supabase.from('screenings').upsert(
        {
          movie_id: movie.id,
          cinema_id: cinemaId,
          start_time: startTime,
          format: sched.format ?? sched.formato ?? '2D',
          language: sched.language ?? sched.idioma ?? 'subtitulada',
          buy_url: sched.buy_url ?? sched.url ?? null,
        },
        { onConflict: 'movie_id,cinema_id,start_time' }
      );
    }
  }
}
