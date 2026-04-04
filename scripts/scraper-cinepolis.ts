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
    .from('cinemas').insert({ name, city_id: cityId, chain: 'cinepolis', address: address ?? null })
    .select('id').single();
  if (error) { console.error('Error creando cine:', error.message); return null; }
  return created?.id ?? null;
}

// Cinepolis Colombia city slugs (their URL format)
const CITIES: Record<string, string> = {
  'bogota-colombia': 'bogota',
  'medellin-colombia': 'medellin',
  'cali-colombia': 'cali',
  'barranquilla-colombia': 'barranquilla',
  'bucaramanga-colombia': 'bucaramanga',
  'cartagena-colombia': 'cartagena',
};

export async function scrapeCinepolis() {
  console.log('🎬 Iniciando scraper de Cinépolis Colombia...');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });

  try {
    for (const [cinepolisSlug, dbSlug] of Object.entries(CITIES)) {
      console.log(`\n📍 Scrapeando Cinépolis en: ${dbSlug}`);
      const cityId = await getOrCreateCity(dbSlug);
      if (!cityId) continue;

      const page = await context.newPage();

      // Intercept API calls from Cinepolis SPA
      const capturedData: any[] = [];
      await page.route('**/*', async (route, request) => {
        const url = request.url();
        if (
          request.method() === 'GET' &&
          (url.includes('/api/') || url.includes('graphql') ||
           url.includes('movies') || url.includes('showtimes') ||
           url.includes('billboard') || url.includes('cartelera') ||
           url.includes('cinepolis'))
        ) {
          const response = await route.fetch();
          const ct = response.headers()['content-type'] ?? '';
          if (ct.includes('application/json')) {
            try {
              const body = await response.json();
              capturedData.push({ url, body });
            } catch { /* ignore */ }
          }
          await route.fulfill({ response });
        } else {
          await route.continue();
        }
      });

      try {
        await page.goto(`https://cinepolis.com.co/cartelera/${cinepolisSlug}`, {
          waitUntil: 'networkidle',
          timeout: 40000,
        });
      } catch {
        try {
          await page.goto(`https://cinepolis.com.co/cartelera/${cinepolisSlug}`, {
            waitUntil: 'domcontentloaded',
            timeout: 30000,
          });
        } catch (e) {
          console.error(`  ❌ No se pudo cargar Cinépolis ${dbSlug}:`, e);
          await page.close();
          continue;
        }
      }

      await page.waitForTimeout(4000);

      // Try __NEXT_DATA__ first
      const nextDataStr = await page.evaluate(() => {
        const el = document.getElementById('__NEXT_DATA__');
        return el?.textContent ?? null;
      });

      if (nextDataStr) {
        const nd = JSON.parse(nextDataStr);
        const pp = nd?.props?.pageProps ?? {};
        console.log(`  __NEXT_DATA__ pageProps keys: ${Object.keys(pp).join(', ')}`);

        const movies: any[] =
          pp.movies ?? pp.billboard?.movies ?? pp.data?.movies ?? pp.films ?? [];

        for (const m of movies) {
          await processMovie(m, cityId);
        }
      }

      // Process intercepted API responses
      for (const { url, body } of capturedData) {
        const movies: any[] =
          body?.movies ?? body?.data?.movies ?? body?.billboard?.movies ??
          body?.films ?? body?.results ?? (Array.isArray(body) ? body : []);
        if (movies.length > 0) {
          console.log(`  ${movies.length} películas en API: ${url.substring(0, 70)}`);
          for (const m of movies) await processMovie(m, cityId);
        }
      }

      // DOM fallback: scrape movie cards + showtimes
      const domData = await page.evaluate(() => {
        const cinemaBlocks: any[] = [];

        // Cinepolis groups showtimes by complex (teatro)
        const complexEls = document.querySelectorAll(
          '[class*="complex"], [class*="teatro"], [class*="venue"], [class*="cinema-name"]'
        );

        if (complexEls.length > 0) {
          complexEls.forEach((el) => {
            const nameEl = el.querySelector('h2, h3, h4, [class*="name"], [class*="nombre"]');
            const cinemaName = nameEl?.textContent?.trim() ?? el.textContent?.trim() ?? '';
            if (!cinemaName) return;

            const movieEls = el.querySelectorAll('[class*="movie"], [class*="pelicula"], article');
            const movies: any[] = [];
            movieEls.forEach((mov) => {
              const titleEl = mov.querySelector('h2, h3, [class*="title"], [class*="titulo"]');
              const title = titleEl?.textContent?.trim() ?? '';
              if (!title) return;

              const timeBtns = mov.querySelectorAll('button, a[href*="comprar"], [class*="hora"], [class*="time"]');
              const times: any[] = [];
              timeBtns.forEach((btn) => {
                const t = btn.textContent?.trim() ?? '';
                if (/\d{1,2}:\d{2}/.test(t)) {
                  times.push({
                    time: t.match(/\d{1,2}:\d{2}/)?.[0] ?? t,
                    url: (btn as HTMLAnchorElement).href || null,
                    format: btn.getAttribute('data-format') ?? '2D',
                    language: btn.getAttribute('data-lang') ?? 'subtitulada',
                  });
                }
              });
              movies.push({ title, times });
            });
            cinemaBlocks.push({ cinemaName, movies });
          });
        } else {
          // Alternative: global movie cards with times
          document.querySelectorAll('[class*="movie"], article').forEach((card) => {
            const titleEl = card.querySelector('h2, h3, [class*="title"]');
            const title = titleEl?.textContent?.trim() ?? '';
            if (!title) return;
            const timeBtns = card.querySelectorAll('button, [class*="hora"], [class*="time"]');
            const times: any[] = [];
            timeBtns.forEach((btn) => {
              const t = btn.textContent?.trim() ?? '';
              if (/\d{1,2}:\d{2}/.test(t)) {
                times.push({ time: t.match(/\d{1,2}:\d{2}/)?.[0] ?? t });
              }
            });
            cinemaBlocks.push({ cinemaName: 'Cinépolis', movies: [{ title, times }] });
          });
        }

        return cinemaBlocks;
      });

      const today = new Date().toISOString().split('T')[0];
      for (const { cinemaName, movies } of domData) {
        const cinemaId = await getOrCreateCinema(cinemaName, cityId);
        if (!cinemaId) continue;

        for (const { title, times } of movies) {
          if (!title || !times.length) continue;
          const slug = slugify(title);
          const { data: movie } = await supabase
            .from('movies').upsert({ slug, title }, { onConflict: 'slug' }).select('id').single();
          if (!movie) continue;

          for (const sched of times) {
            const startTime = `${today}T${sched.time.padStart(5, '0')}:00`;
            await supabase.from('screenings').upsert(
              {
                movie_id: movie.id,
                cinema_id: cinemaId,
                start_time: startTime,
                format: sched.format ?? '2D',
                language: sched.language ?? 'subtitulada',
                buy_url: sched.url ?? null,
              },
              { onConflict: 'movie_id,cinema_id,start_time' }
            );
          }
        }
      }

      await page.unroute('**/*');
      await page.close();
    }
  } catch (err) {
    console.error('❌ Error fatal en Cinépolis Scraper:', err);
  } finally {
    await browser.close();
    console.log('✅ Cinépolis Scraper finalizado.');
  }
}

async function processMovie(m: any, cityId: number) {
  const title: string = m.title ?? m.nombre ?? m.name ?? '';
  if (!title) return;
  const slug = m.slug ?? slugify(title);

  const { data: movie, error } = await supabase
    .from('movies')
    .upsert(
      {
        slug,
        title,
        poster_url: m.poster_url ?? m.poster ?? m.image ?? null,
        description: m.synopsis ?? m.description ?? m.sinopsis ?? null,
        duration_minutes: parseInt(m.duration ?? m.duracion ?? '0') || null,
        rating: m.rating ?? m.clasificacion ?? null,
        genres: (m.genres ?? m.generos ?? []).map((g: any) => g?.name ?? g ?? ''),
      },
      { onConflict: 'slug' }
    )
    .select('id')
    .single();

  if (error || !movie) { console.error(`Error guardando ${title}:`, error?.message); return; }

  const showings: any[] = m.showings ?? m.screenings ?? m.functions ?? m.showtimes ?? [];
  for (const showing of showings) {
    const cinemaName: string = showing.cinema?.name ?? showing.theater?.name ?? showing.name ?? '';
    if (!cinemaName) continue;
    const cinemaId = await getOrCreateCinema(cinemaName, cityId, showing.cinema?.address);
    if (!cinemaId) continue;

    const schedules: any[] = showing.schedules ?? showing.horarios ?? (showing.time ? [showing] : []);
    for (const sched of schedules) {
      const rawTime: string = sched.time ?? sched.hora ?? sched.start_time ?? '';
      if (!rawTime) continue;
      const today = new Date().toISOString().split('T')[0];
      const startTime = /^\d{1,2}:\d{2}$/.test(rawTime)
        ? `${today}T${rawTime.padStart(5, '0')}:00`
        : rawTime;

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
