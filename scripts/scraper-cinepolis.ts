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
  const { data: c, error } = await supabase.from('cities').insert({ slug, name }).select('id').single();
  if (error) { console.error('Error creando ciudad:', error.message); return null; }
  return c?.id ?? null;
}

async function getOrCreateCinema(name: string, cityId: number): Promise<number | null> {
  const { data } = await supabase.from('cinemas').select('id').eq('name', name).eq('city_id', cityId).single();
  if (data) return data.id;
  const { data: c, error } = await supabase.from('cinemas')
    .insert({ name, city_id: cityId, chain: 'cinepolis' }).select('id').single();
  if (error) { console.error('Error creando cine:', error.message); return null; }
  return c?.id ?? null;
}

// Cinépolis Colombia city slugs
const CITIES: Record<string, string> = {
  'bogota-colombia': 'bogota',
  'medellin-colombia': 'medellin',
  'cali-colombia': 'cali',
  'barranquilla-colombia': 'barranquilla',
  'bucaramanga-colombia': 'bucaramanga',
  'cartagena-colombia': 'cartagena',
};

const today = new Date().toISOString().split('T')[0];

export async function scrapeCinepolis() {
  console.log('🎬 Iniciando scraper de Cinépolis Colombia...');

  const browser = await chromium.launch({
    headless: true,
    args: ['--disable-blink-features=AutomationControlled', '--no-sandbox'],
  });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    locale: 'es-CO',
    timezoneId: 'America/Bogota',
  });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  try {
    for (const [cinepolisSlug, dbSlug] of Object.entries(CITIES)) {
      console.log(`\n📍 Scrapeando Cinépolis: ${dbSlug}`);
      const cityId = await getOrCreateCity(dbSlug);
      if (!cityId) continue;

      // ── STEP 1: Load city cartelera, capture API calls & get movie list ──
      const capturedApiData: any[] = [];
      const cartelaPage = await context.newPage();

      await cartelaPage.route('**/*', async (route, request) => {
        const url = request.url();
        if (request.method() === 'GET') {
          const response = await route.fetch();
          const ct = response.headers()['content-type'] ?? '';
          if (ct.includes('application/json') &&
            (url.includes('/api/') || url.includes('movies') || url.includes('showtimes') ||
             url.includes('billboard') || url.includes('cartelera') || url.includes('cinepolis'))) {
            try {
              const body = await response.json();
              capturedApiData.push({ url, body });
              console.log(`  📡 API: ${url.substring(0, 90)}`);
            } catch { /* ignore */ }
          }
          await route.fulfill({ response });
        } else {
          await route.continue();
        }
      });

      const cartelaUrl = `https://cinepolis.com.co/cartelera/${cinepolisSlug}`;
      console.log(`   Cargando ${cartelaUrl}`);
      try {
        await cartelaPage.goto(cartelaUrl, { waitUntil: 'networkidle', timeout: 40000 });
      } catch {
        try {
          await cartelaPage.goto(cartelaUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        } catch (e) {
          console.error(`   ❌ Timeout cargando ${cartelaUrl}:`, (e as Error).message);
          await cartelaPage.close();
          continue;
        }
      }
      await cartelaPage.waitForTimeout(4000);

      const pageTitle = await cartelaPage.title();
      const pageUrl = cartelaPage.url();
      console.log(`   Título: "${pageTitle}" | URL: ${pageUrl}`);

      // Try __NEXT_DATA__
      const ndStr = await cartelaPage.evaluate(() => {
        const el = document.getElementById('__NEXT_DATA__');
        return el?.textContent ?? null;
      });

      let movieRefs: { slug: string; title: string; url: string }[] = [];

      if (ndStr) {
        const nd = JSON.parse(ndStr);
        const pp = nd?.props?.pageProps ?? {};
        console.log(`   pageProps keys: ${Object.keys(pp).join(', ')}`);

        const movies: any[] =
          pp.movies ?? pp.billboard?.movies ?? pp.data?.movies ?? pp.films ?? [];

        movieRefs = movies.map((m: any) => ({
          slug: m.slug ?? m.url ?? slugify(m.title ?? ''),
          title: m.title ?? m.titulo ?? m.name ?? '',
          url: m.url ?? '',
        })).filter(r => r.title);

        console.log(`   ${movieRefs.length} películas en __NEXT_DATA__`);
      }

      // Process intercepted API data for movies
      for (const { url, body } of capturedApiData) {
        const movies: any[] =
          body?.movies ?? body?.Films ?? body?.films ??
          body?.data?.movies ?? body?.results ?? (Array.isArray(body) ? body : []);
        if (movies.length > 0 && movieRefs.length === 0) {
          console.log(`   ${movies.length} películas desde API: ${url.substring(0, 60)}`);
          movieRefs = movies.map((m: any) => ({
            slug: m.slug ?? slugify(m.title ?? m.Title ?? ''),
            title: m.title ?? m.Title ?? m.nombre ?? '',
            url: m.url ?? '',
          })).filter(r => r.title);
        }
      }

      // DOM fallback: get movie links from rendered page
      if (movieRefs.length === 0) {
        movieRefs = await cartelaPage.evaluate(() => {
          const refs: { slug: string; title: string; url: string }[] = [];
          document.querySelectorAll('a[href*="/pelicula/"], a[href*="/movie/"], a[href*="/film/"]').forEach((a) => {
            const href = (a as HTMLAnchorElement).href;
            const match = href.match(/\/(?:pelicula|movie|film)\/([^/?#]+)/);
            if (!match) return;
            const slug = match[1];
            const title = a.querySelector('h2,h3,h4,[class*="title"],[class*="titulo"]')?.textContent?.trim()
              ?? a.getAttribute('title') ?? slug;
            if (!refs.find(r => r.slug === slug)) refs.push({ slug, title, url: href });
          });
          return refs;
        });
        console.log(`   ${movieRefs.length} películas desde DOM links`);
      }

      await cartelaPage.unroute('**/*');
      await cartelaPage.close();

      if (movieRefs.length === 0) {
        console.log(`   ⚠️  Sin películas para ${dbSlug}`);
        continue;
      }

      // ── STEP 2: For each movie, navigate to its detail page → get all sedes ──
      for (const ref of movieRefs) {
        const { slug, title, url: refUrl } = ref;
        const movieSlug = slug || slugify(title);

        const { data: movie } = await supabase.from('movies').upsert(
          { slug: movieSlug, title }, { onConflict: 'slug' }
        ).select('id').single();
        if (!movie) continue;

        // Build movie page URL
        const moviePageUrl = refUrl.startsWith('http')
          ? refUrl
          : `https://cinepolis.com.co/cartelera/${cinepolisSlug}/${slug}`;

        const movieApiData: any[] = [];
        const moviePage = await context.newPage();
        console.log(`   🎥 ${title}`);

        await moviePage.route('**/*', async (route, request) => {
          const url = request.url();
          if (request.method() === 'GET') {
            const response = await route.fetch();
            const ct = response.headers()['content-type'] ?? '';
            if (ct.includes('application/json') &&
              (url.includes('/api/') || url.includes('showtimes') || url.includes('horarios') ||
               url.includes('schedule') || url.includes('functions'))) {
              try { movieApiData.push({ url, body: await response.json() }); } catch { /* ignore */ }
            }
            await route.fulfill({ response });
          } else {
            await route.continue();
          }
        });

        try {
          await moviePage.goto(moviePageUrl, { waitUntil: 'domcontentloaded', timeout: 35000 });
          await moviePage.waitForTimeout(3000);

          // Try __NEXT_DATA__ on movie page
          const movieNdStr = await moviePage.evaluate(() => {
            const el = document.getElementById('__NEXT_DATA__');
            return el?.textContent ?? null;
          });

          if (movieNdStr) {
            const nd = JSON.parse(movieNdStr);
            const pp = nd?.props?.pageProps ?? {};
            const m = pp.movie ?? pp.film ?? pp.data ?? {};

            // Update movie metadata
            if (m.poster_url ?? m.poster ?? m.image) {
              await supabase.from('movies').update({
                poster_url: m.poster_url ?? m.poster ?? m.image ?? null,
                description: m.synopsis ?? m.description ?? m.sinopsis ?? null,
                duration_minutes: parseInt(m.duration ?? m.duracion ?? '0') || null,
                rating: m.rating ?? m.clasificacion ?? null,
                genres: (m.genres ?? m.generos ?? []).map((g: any) => g?.name ?? g ?? ''),
              }).eq('id', movie.id);
            }

            // Get showings by sede
            const showings: any[] =
              pp.showings ?? pp.screenings ?? pp.functions ?? pp.showtimes ??
              m.showings ?? m.screenings ?? [];

            let sedeCount = 0;
            for (const showing of showings) {
              const cinemaName: string =
                showing.cinema?.name ?? showing.cinema?.nombre ??
                showing.theater?.name ?? showing.CinemaName ?? showing.name ?? '';
              if (!cinemaName) continue;

              const cinemaId = await getOrCreateCinema(cinemaName, cityId);
              if (!cinemaId) continue;
              sedeCount++;

              const schedules: any[] =
                showing.schedules ?? showing.horarios ?? showing.times ?? (showing.time ? [showing] : []);
              for (const sched of schedules) {
                const rawTime: string = sched.time ?? sched.hora ?? sched.start_time ?? '';
                if (!rawTime) continue;
                const startTime = /^\d{1,2}:\d{2}$/.test(rawTime)
                  ? `${today}T${rawTime.padStart(5, '0')}:00`
                  : rawTime;
                await supabase.from('screenings').upsert(
                  {
                    movie_id: movie.id, cinema_id: cinemaId, start_time: startTime,
                    format: sched.format ?? sched.Format ?? sched.formato ?? '2D',
                    language: sched.language ?? sched.idioma ?? 'subtitulada',
                    buy_url: null,
                  },
                  { onConflict: 'movie_id,cinema_id,start_time' }
                );
              }
            }
            if (sedeCount > 0) console.log(`      ✅ ${sedeCount} sedes via __NEXT_DATA__`);
          }

          // ── DOM scraping: read rendered cinema blocks ────────────────
          const domSedes = await moviePage.evaluate(() => {
            const result: { cinema: string; times: { time: string; format: string; lang: string }[] }[] = [];

            // Cinépolis renders cinema blocks — try multiple selector strategies
            const strategies = [
              '[class*="complejo"]', '[class*="complex"]', '[class*="cinema-block"]',
              '[class*="theater"]', '[class*="sede"]', 'section[class*="cine"]',
            ];

            let blocks: Element[] = [];
            for (const sel of strategies) {
              blocks = Array.from(document.querySelectorAll(sel));
              if (blocks.length > 0) break;
            }

            // Fallback: scan for uppercase headings followed by time buttons
            if (blocks.length === 0) {
              document.querySelectorAll('h2, h3, h4').forEach((h) => {
                const name = h.textContent?.trim() ?? '';
                if (name.length < 5) return;

                const times: { time: string; format: string; lang: string }[] = [];
                let sibling = h.nextElementSibling;
                let depth = 0;
                while (sibling && depth < 8) {
                  sibling.querySelectorAll('button, a').forEach((btn) => {
                    const text = btn.textContent?.trim() ?? '';
                    const m = text.match(/\d{1,2}:\d{2}/);
                    if (m) {
                      const ctx = btn.closest('div')?.textContent ?? '';
                      times.push({
                        time: m[0],
                        format: ctx.match(/\b(IMAX|4DX|3D|2D|XD)\b/i)?.[1]?.toUpperCase() ?? '2D',
                        lang: ctx.toLowerCase().includes('dob') ? 'doblada' : 'subtitulada',
                      });
                    }
                  });
                  sibling = sibling.nextElementSibling;
                  depth++;
                }
                if (times.length > 0) result.push({ cinema: name, times });
              });
              return result;
            }

            blocks.forEach((block) => {
              const heading = block.querySelector('h2,h3,h4,[class*="name"],[class*="nombre"],[class*="title"]');
              const cinema = heading?.textContent?.trim() ?? '';
              if (!cinema || cinema.length < 3) return;

              const times: { time: string; format: string; lang: string }[] = [];
              block.querySelectorAll('button, a[href*="comprar"], [class*="hora"], [class*="time"]').forEach((btn) => {
                const text = btn.textContent?.trim() ?? '';
                const m = text.match(/\d{1,2}:\d{2}/);
                if (!m) return;
                const ctx = btn.closest('[class*="format"],[class*="tipo"]')?.textContent
                  ?? btn.parentElement?.textContent ?? '';
                times.push({
                  time: m[0],
                  format: ctx.match(/\b(IMAX|4DX|3D|2D|XD)\b/i)?.[1]?.toUpperCase() ?? '2D',
                  lang: ctx.toLowerCase().includes('dob') ? 'doblada' : 'subtitulada',
                });
              });
              if (times.length > 0) result.push({ cinema, times });
            });

            return result;
          });

          if (domSedes.length > 0) {
            console.log(`      ✅ ${domSedes.length} sedes via DOM`);
            for (const { cinema: cinemaName, times } of domSedes) {
              const cinemaId = await getOrCreateCinema(cinemaName, cityId);
              if (!cinemaId) continue;
              for (const sched of times) {
                const startTime = `${today}T${sched.time.padStart(5, '0')}:00`;
                await supabase.from('screenings').upsert(
                  {
                    movie_id: movie.id, cinema_id: cinemaId, start_time: startTime,
                    format: sched.format, language: sched.lang, buy_url: null,
                  },
                  { onConflict: 'movie_id,cinema_id,start_time' }
                );
              }
            }
          }

          // Process intercepted API data from movie page
          for (const { url, body } of movieApiData) {
            const cinemas: any[] = body?.cinemas ?? body?.theaters ?? body?.venues ?? [];
            if (cinemas.length > 0) {
              console.log(`      📡 ${cinemas.length} sedes en API movie: ${url.substring(0, 60)}`);
              for (const c of cinemas) {
                const cinemaName = c.name ?? c.nombre ?? '';
                if (!cinemaName) continue;
                const cinemaId = await getOrCreateCinema(cinemaName, cityId);
                if (!cinemaId) continue;
                const times: any[] = c.schedules ?? c.showtimes ?? c.horarios ?? [];
                for (const t of times) {
                  const rawTime = t.time ?? t.hora ?? '';
                  if (!rawTime) continue;
                  const startTime = /^\d{1,2}:\d{2}$/.test(rawTime)
                    ? `${today}T${rawTime.padStart(5, '0')}:00` : rawTime;
                  await supabase.from('screenings').upsert(
                    {
                      movie_id: movie.id, cinema_id: cinemaId, start_time: startTime,
                      format: t.format ?? '2D', language: t.language ?? 'subtitulada', buy_url: null,
                    },
                    { onConflict: 'movie_id,cinema_id,start_time' }
                  );
                }
              }
            }
          }

        } catch (err) {
          console.error(`      ❌ Error en página de ${title}:`, (err as Error).message);
        } finally {
          await moviePage.unroute('**/*');
          await moviePage.close();
        }

        await new Promise(r => setTimeout(r, 800));
      }
    }
  } catch (err) {
    console.error('❌ Error fatal en Cinépolis Scraper:', err);
  } finally {
    await browser.close();
    console.log('\n✅ Cinépolis Scraper finalizado.');
  }
}
