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
    .from('cinemas').insert({ name, city_id: cityId, chain: 'procinal', address: address ?? null })
    .select('id').single();
  if (error) { console.error('Error creando cine:', error.message); return null; }
  return created?.id ?? null;
}

// Procinal Colombia main cities
const CITIES: Record<string, string> = {
  bogota: 'bogota',
  medellin: 'medellin',
  cali: 'cali',
  barranquilla: 'barranquilla',
  bucaramanga: 'bucaramanga',
};

export async function scrapeProcinal() {
  console.log('🎬 Iniciando scraper de Procinal Colombia...');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });

  try {
    // Procinal typically has a single national cartelera page
    const capturedData: any[] = [];
    const page = await context.newPage();

    await page.route('**/*', async (route, request) => {
      const url = request.url();
      if (
        request.method() === 'GET' &&
        (url.includes('/api/') || url.includes('json') ||
         url.includes('movies') || url.includes('pelicula') ||
         url.includes('cartelera') || url.includes('procinal'))
      ) {
        const response = await route.fetch();
        const ct = response.headers()['content-type'] ?? '';
        if (ct.includes('application/json')) {
          try {
            const body = await response.json();
            capturedData.push({ url, body });
            console.log(`  📡 API interceptada: ${url.substring(0, 80)}`);
          } catch { /* ignore */ }
        }
        await route.fulfill({ response });
      } else {
        await route.continue();
      }
    });

    console.log('  Navegando a procinal.com.co/cartelera...');
    try {
      await page.goto('https://procinal.com.co/cartelera', {
        waitUntil: 'networkidle',
        timeout: 40000,
      });
    } catch {
      await page.goto('https://procinal.com.co/cartelera', {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });
    }

    await page.waitForTimeout(4000);

    // Try __NEXT_DATA__
    const nextDataStr = await page.evaluate(() => {
      const el = document.getElementById('__NEXT_DATA__');
      return el?.textContent ?? null;
    });

    if (nextDataStr) {
      const nd = JSON.parse(nextDataStr);
      const pp = nd?.props?.pageProps ?? {};
      console.log(`  __NEXT_DATA__ pageProps keys: ${Object.keys(pp).join(', ')}`);
      const movies: any[] = pp.movies ?? pp.billboard?.movies ?? pp.data?.movies ?? pp.films ?? [];
      console.log(`  ${movies.length} películas en __NEXT_DATA__`);
      for (const m of movies) {
        await processMovieGlobal(m);
      }
    }

    // Process intercepted API data
    for (const { url, body } of capturedData) {
      const movies: any[] =
        body?.movies ?? body?.data?.movies ?? body?.films ??
        body?.results ?? (Array.isArray(body) ? body : []);
      if (movies.length > 0) {
        console.log(`  ${movies.length} películas en API: ${url.substring(0, 70)}`);
        for (const m of movies) await processMovieGlobal(m);
      }
    }

    // DOM fallback: Procinal may have a simpler structure
    const domData = await page.evaluate(() => {
      const results: any[] = [];

      // Try to find cinema blocks
      const cinemaEls = document.querySelectorAll('[class*="cine"], [class*="teatro"], [class*="sala"]');
      if (cinemaEls.length > 0) {
        cinemaEls.forEach((el) => {
          const nameEl = el.querySelector('h2, h3, h4, [class*="nombre"], [class*="name"]');
          const cinemaName = nameEl?.textContent?.trim() ?? '';
          const cityEl = el.querySelector('[class*="ciudad"], [class*="city"]');
          const city = cityEl?.textContent?.trim()?.toLowerCase() ?? '';

          const movies: any[] = [];
          el.querySelectorAll('[class*="pelicula"], [class*="movie"], article, li').forEach((mov) => {
            const titleEl = mov.querySelector('h2, h3, h4, a, [class*="titulo"], [class*="title"]');
            const title = titleEl?.textContent?.trim() ?? '';
            if (!title || title.length < 3) return;
            const img = mov.querySelector('img');
            const poster = img?.src ?? img?.getAttribute('data-src') ?? null;
            const times: any[] = [];
            mov.querySelectorAll('button, a, [class*="hora"], [class*="time"]').forEach((btn) => {
              const t = btn.textContent?.trim() ?? '';
              if (/\d{1,2}:\d{2}/.test(t)) {
                times.push({
                  time: t.match(/\d{1,2}:\d{2}/)?.[0] ?? t,
                  url: (btn as HTMLAnchorElement).href || null,
                });
              }
            });
            movies.push({ title, poster, times });
          });

          if (movies.length > 0) results.push({ cinemaName, city, movies });
        });
      }

      if (results.length === 0) {
        // Global movie cards without cinema grouping
        document.querySelectorAll('[class*="movie"], [class*="pelicula"], article').forEach((card) => {
          const titleEl = card.querySelector('h2, h3, h4, a[class*="title"], [class*="titulo"]');
          const title = titleEl?.textContent?.trim() ?? '';
          if (!title || title.length < 3) return;
          const img = card.querySelector('img');
          const poster = img?.src ?? img?.getAttribute('data-src') ?? null;
          const times: any[] = [];
          card.querySelectorAll('button, [class*="hora"], [class*="time"]').forEach((btn) => {
            const t = btn.textContent?.trim() ?? '';
            if (/\d{1,2}:\d{2}/.test(t)) {
              times.push({ time: t.match(/\d{1,2}:\d{2}/)?.[0] ?? t });
            }
          });
          results.push({ cinemaName: 'Procinal', city: '', movies: [{ title, poster, times }] });
        });
      }

      return results;
    });

    console.log(`  ${domData.length} bloques de cine en DOM`);
    const today = new Date().toISOString().split('T')[0];

    for (const { cinemaName, city, movies } of domData) {
      // Match city slug
      const citySlug = Object.keys(CITIES).find(
        (k) => city.includes(k) || cinemaName.toLowerCase().includes(k)
      ) ?? 'bogota';
      const cityId = await getOrCreateCity(citySlug);
      if (!cityId) continue;

      const cinemaId = await getOrCreateCinema(cinemaName, cityId);
      if (!cinemaId) continue;

      for (const { title, poster, times } of movies) {
        if (!title) continue;
        const slug = slugify(title);
        const { data: movie } = await supabase
          .from('movies')
          .upsert({ slug, title, poster_url: poster ?? null }, { onConflict: 'slug' })
          .select('id')
          .single();
        if (!movie) continue;

        for (const sched of times) {
          const startTime = `${today}T${sched.time.padStart(5, '0')}:00`;
          await supabase.from('screenings').upsert(
            {
              movie_id: movie.id,
              cinema_id: cinemaId,
              start_time: startTime,
              format: '2D',
              language: 'subtitulada',
              buy_url: sched.url ?? null,
            },
            { onConflict: 'movie_id,cinema_id,start_time' }
          );
        }
      }
    }

    // Per-city pages as fallback
    for (const [citySlug, dbSlug] of Object.entries(CITIES)) {
      const cityId = await getOrCreateCity(dbSlug);
      if (!cityId) continue;

      const cityPage = await context.newPage();
      try {
        await cityPage.goto(`https://procinal.com.co/cartelera/${citySlug}`, {
          waitUntil: 'domcontentloaded',
          timeout: 25000,
        });
        await cityPage.waitForTimeout(3000);

        const cityNextData = await cityPage.evaluate(() => {
          const el = document.getElementById('__NEXT_DATA__');
          return el?.textContent ?? null;
        });

        if (cityNextData) {
          const nd = JSON.parse(cityNextData);
          const pp = nd?.props?.pageProps ?? {};
          const movies: any[] = pp.movies ?? pp.billboard?.movies ?? pp.data?.movies ?? [];
          for (const m of movies) {
            await processMovieWithCity(m, cityId);
          }
        }
      } catch {
        // City-specific page may not exist
      } finally {
        await cityPage.close();
      }
    }

    await page.close();
  } catch (err) {
    console.error('❌ Error fatal en Procinal Scraper:', err);
  } finally {
    await browser.close();
    console.log('✅ Procinal Scraper finalizado.');
  }
}

async function processMovieGlobal(m: any) {
  const title: string = m.title ?? m.nombre ?? m.name ?? '';
  if (!title) return;
  const slug = m.slug ?? slugify(title);
  await supabase.from('movies').upsert(
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
  );
}

async function processMovieWithCity(m: any, cityId: number) {
  const title: string = m.title ?? m.nombre ?? m.name ?? '';
  if (!title) return;
  const slug = m.slug ?? slugify(title);

  const { data: movie } = await supabase
    .from('movies')
    .upsert(
      {
        slug,
        title,
        poster_url: m.poster_url ?? m.poster ?? m.image ?? null,
        description: m.synopsis ?? m.description ?? null,
        duration_minutes: parseInt(m.duration ?? m.duracion ?? '0') || null,
        rating: m.rating ?? m.clasificacion ?? null,
        genres: (m.genres ?? m.generos ?? []).map((g: any) => g?.name ?? g ?? ''),
      },
      { onConflict: 'slug' }
    )
    .select('id')
    .single();

  if (!movie) return;

  const showings: any[] = m.showings ?? m.screenings ?? m.functions ?? m.showtimes ?? [];
  for (const showing of showings) {
    const cinemaName: string = showing.cinema?.name ?? showing.theater?.name ?? showing.name ?? '';
    if (!cinemaName) continue;
    const cinemaId = await getOrCreateCinema(cinemaName, cityId);
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
          format: sched.format ?? '2D',
          language: sched.language ?? 'subtitulada',
          buy_url: sched.buy_url ?? sched.url ?? null,
        },
        { onConflict: 'movie_id,cinema_id,start_time' }
      );
    }
  }
}
