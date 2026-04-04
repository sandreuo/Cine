import { chromium } from 'playwright';
import { supabaseAdmin as supabase } from '../lib/supabase-admin';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(process.cwd(), '.env.local') });

const CITIES: Record<string, string> = {
  bogota: 'bogota',
  medellin: 'medellin',
  cali: 'cali',
  barranquilla: 'barranquilla',
  bucaramanga: 'bucaramanga',
  cartagena: 'cartagena',
};

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
  if (error) { console.error(`Error creando ciudad ${slug}:`, error.message); return null; }
  return c?.id ?? null;
}

async function getOrCreateCinema(name: string, cityId: number): Promise<number | null> {
  const { data } = await supabase.from('cinemas').select('id').eq('name', name).eq('city_id', cityId).single();
  if (data) return data.id;
  const { data: c, error } = await supabase.from('cinemas')
    .insert({ name, city_id: cityId, chain: 'cinecolombia' }).select('id').single();
  if (error) { console.error(`Error creando cine ${name}:`, error.message); return null; }
  return c?.id ?? null;
}

export async function scrapeCineColombia() {
  console.log('🎬 Iniciando scraper de CINE COLOMBIA...');

  const browser = await chromium.launch({
    headless: true,
    args: ['--disable-blink-features=AutomationControlled', '--no-sandbox', '--disable-setuid-sandbox'],
  });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    extraHTTPHeaders: {
      'Accept-Language': 'es-CO,es;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'sec-ch-ua': '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"',
    },
    locale: 'es-CO',
    timezoneId: 'America/Bogota',
  });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  const today = new Date().toISOString().split('T')[0];

  try {
    // ── STEP 1: Get movie list from Bogotá cartelera ─────────────────────
    // We only scrape cartelera once (Bogotá) to get the movie list + codes.
    // Then for each movie we get ALL sedes (nationwide on their movie page).
    const cartelaPage = await context.newPage();
    console.log('   Cargando cartelera de Bogotá...');
    try {
      await cartelaPage.goto('https://www.cinecolombia.com/bogota/cartelera', {
        waitUntil: 'networkidle', timeout: 60000,
      });
    } catch {
      await cartelaPage.goto('https://www.cinecolombia.com/bogota/cartelera', {
        waitUntil: 'domcontentloaded', timeout: 45000,
      });
    }
    await cartelaPage.waitForTimeout(5000);

    const title = await cartelaPage.title();
    console.log(`   Título: "${title}"`);

    if (title.toLowerCase().includes('just a moment') || title.toLowerCase().includes('cloudflare')) {
      console.log('   ⚠️  Cloudflare bloqueó el acceso. Saltando Cine Colombia.');
      await cartelaPage.close();
      await browser.close();
      return;
    }

    // Extract movie list with slugs and codes from __NEXT_DATA__ or DOM
    const movieRefs: { slug: string; code: string; title: string }[] = await cartelaPage.evaluate(() => {
      const refs: { slug: string; code: string; title: string }[] = [];

      // Try __NEXT_DATA__ first
      const nd = document.getElementById('__NEXT_DATA__');
      if (nd) {
        try {
          const data = JSON.parse(nd.textContent ?? '{}');
          const pp = data?.props?.pageProps ?? {};
          console.log('pageProps keys:', Object.keys(pp).join(', '));

          const movies: any[] =
            pp.movies ?? pp.billboard?.movies ?? pp.data?.movies ?? pp.content?.movies ?? [];

          movies.forEach((m: any) => {
            const slug = m.slug ?? m.url_slug ?? '';
            const code = m.code ?? m.id ?? m.film_id ?? m.HO ?? '';
            const t = m.title ?? m.titulo ?? '';
            if (slug || code) refs.push({ slug, code: String(code), title: t });
          });
          if (refs.length > 0) return refs;
        } catch { /* ignore */ }
      }

      // DOM fallback: find movie links like /films/{slug}/{code}/
      document.querySelectorAll('a[href*="/films/"]').forEach((a) => {
        const href = (a as HTMLAnchorElement).href;
        const match = href.match(/\/films\/([^/]+)\/([^/]+)\//);
        if (match) {
          const slug = match[1];
          const code = match[2];
          const title = a.querySelector('h2,h3,h4,[class*="title"]')?.textContent?.trim()
            ?? a.textContent?.trim() ?? slug;
          if (!refs.find(r => r.code === code)) refs.push({ slug, code, title });
        }
      });

      // Also try /pelicula/ links
      document.querySelectorAll('a[href*="/pelicula/"]').forEach((a) => {
        const href = (a as HTMLAnchorElement).href;
        const match = href.match(/\/pelicula\/([^/]+)/);
        if (match) {
          const slug = match[1];
          const title = a.querySelector('h2,h3,h4,[class*="title"]')?.textContent?.trim()
            ?? a.textContent?.trim() ?? slug;
          if (!refs.find(r => r.slug === slug)) refs.push({ slug, code: '', title });
        }
      });

      return refs;
    });

    console.log(`   ${movieRefs.length} películas encontradas en cartelera`);
    await cartelaPage.close();

    if (movieRefs.length === 0) {
      console.log('   ❌ No se pudo obtener listado de películas. Cloudflare o cambio de estructura.');
      await browser.close();
      return;
    }

    // ── STEP 2: For each movie, scrape its detail page for ALL sedes ──────
    for (const ref of movieRefs) {
      const { slug, code, title } = ref;

      // Upsert movie skeleton first
      const movieSlug = slug || slugify(title);
      const { data: movie } = await supabase.from('movies').upsert(
        { slug: movieSlug, title },
        { onConflict: 'slug' }
      ).select('id').single();
      if (!movie) continue;

      // Navigate to movie detail page (their URL uses /films/{slug}/{code}/ or /bogota/pelicula/{slug})
      const movieUrl = code
        ? `https://www.cinecolombia.com/films/${slug}/${code}/`
        : `https://www.cinecolombia.com/bogota/pelicula/${slug}`;

      const moviePage = await context.newPage();
      console.log(`   🎥 ${title} → ${movieUrl}`);
      try {
        await moviePage.goto(movieUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
        await moviePage.waitForTimeout(4000);

        // First try __NEXT_DATA__ for structured data
        const pageNd = await moviePage.evaluate(() => {
          const el = document.getElementById('__NEXT_DATA__');
          return el?.textContent ?? null;
        });

        if (pageNd) {
          const nd = JSON.parse(pageNd);
          const pp = nd?.props?.pageProps ?? {};
          // Update movie with full data
          const m = pp.movie ?? pp.film ?? pp.data ?? {};
          if (m.title || m.poster_url || m.synopsis) {
            await supabase.from('movies').update({
              title: m.title ?? m.titulo ?? title,
              poster_url: m.poster_url ?? m.poster ?? m.image ?? null,
              description: m.synopsis ?? m.description ?? m.sinopsis ?? null,
              duration_minutes: parseInt(m.duration ?? m.duracion ?? '0') || null,
              rating: m.rating ?? m.clasificacion ?? null,
              genres: (m.genres ?? m.generos ?? []).map((g: any) => g?.name ?? g ?? ''),
            }).eq('id', movie.id);
          }

          // Get showings: structured as [{cinema: {name}, schedules: [{time, format, language}]}]
          const showings: any[] =
            pp.showings ?? pp.screenings ?? pp.functions ?? pp.showtimes ??
            m.showings ?? m.screenings ?? [];

          for (const showing of showings) {
            const cinemaName: string =
              showing.cinema?.name ?? showing.cinema?.nombre ??
              showing.theater?.name ?? showing.name ?? '';
            if (!cinemaName) continue;

            // Map cinema to city
            const cinemaCity: string =
              showing.cinema?.city?.slug ?? showing.cinema?.ciudad?.slug ?? '';
            const citySlug = Object.keys(CITIES).find(k => cinemaCity.includes(k)) ?? 'bogota';
            const cityId = await getOrCreateCity(citySlug);
            if (!cityId) continue;
            const cinemaId = await getOrCreateCinema(cinemaName, cityId);
            if (!cinemaId) continue;

            const schedules: any[] =
              showing.schedules ?? showing.horarios ?? (showing.time ? [showing] : []);
            for (const sched of schedules) {
              const rawTime: string = sched.time ?? sched.hora ?? sched.start_time ?? '';
              if (!rawTime) continue;
              const startTime = /^\d{1,2}:\d{2}$/.test(rawTime)
                ? `${today}T${rawTime.padStart(5, '0')}:00`
                : rawTime;
              await supabase.from('screenings').upsert(
                {
                  movie_id: movie.id, cinema_id: cinemaId, start_time: startTime,
                  format: sched.format ?? sched.formato ?? '2D',
                  language: sched.language ?? sched.idioma ?? (sched.dubbed ? 'doblada' : 'subtitulada'),
                  buy_url: null,
                },
                { onConflict: 'movie_id,cinema_id,start_time' }
              );
            }
          }
        }

        // ── DOM scraping: reads the rendered cinema blocks ──────────────
        // CineColombia renders: <section/div per cinema> → cinema name heading → time buttons
        const domSedes = await moviePage.evaluate(() => {
          const result: { cinema: string; times: { time: string; format: string; lang: string }[] }[] = [];

          // Their page groups by cinema/sede with headings
          // Try several selector strategies
          const cinemaSelectors = [
            '[class*="complejo"]', '[class*="cinema"]', '[class*="theater"]',
            '[class*="sede"]', '[class*="venue"]', 'section[id]',
          ];

          let cinemaEls: Element[] = [];
          for (const sel of cinemaSelectors) {
            const found = Array.from(document.querySelectorAll(sel));
            if (found.length > 0) { cinemaEls = found; break; }
          }

          cinemaEls.forEach((el) => {
            // Get cinema name from heading
            const heading = el.querySelector('h1,h2,h3,h4,[class*="name"],[class*="nombre"],[class*="title"]');
            const cinema = heading?.textContent?.trim() ?? '';
            if (!cinema || cinema.length < 3) return;

            // Get times from buttons/links
            const times: { time: string; format: string; lang: string }[] = [];
            el.querySelectorAll('button, a[href*="comprar"], a[href*="buy"], [class*="hora"], [class*="time"], [class*="schedule"]').forEach((btn) => {
              const text = btn.textContent?.trim() ?? '';
              const timeMatch = text.match(/\d{1,2}:\d{2}/);
              if (!timeMatch) return;

              // Look for format/language context in parent or sibling elements
              const parent = btn.closest('[class*="format"], [class*="tipo"], [class*="sala"]') ?? btn.parentElement;
              const parentText = parent?.textContent ?? '';
              const format = parentText.match(/\b(IMAX|4DX|3D|2D|XD|Premium)\b/i)?.[1]?.toUpperCase() ?? '2D';
              const lang = parentText.toLowerCase().includes('dob') ? 'doblada' : 'subtitulada';

              times.push({ time: timeMatch[0], format, lang });
            });

            if (times.length > 0) result.push({ cinema, times });
          });

          // If nothing found via section selectors, try reading ALL time buttons and guess cinema from proximity
          if (result.length === 0) {
            // Find all cinema headings followed by time blocks
            const allH = Array.from(document.querySelectorAll('h2, h3, h4'));
            allH.forEach((h) => {
              const name = h.textContent?.trim() ?? '';
              // Cinema names are usually uppercase and > 5 chars
              if (name.length < 5 || name !== name.toUpperCase()) return;

              const times: { time: string; format: string; lang: string }[] = [];
              let next = h.nextElementSibling;
              while (next && !['H2', 'H3', 'H4'].includes(next.tagName)) {
                next.querySelectorAll('button, a').forEach((btn) => {
                  const t = btn.textContent?.trim() ?? '';
                  const m = t.match(/\d{1,2}:\d{2}/);
                  if (m) times.push({ time: m[0], format: '2D', lang: 'subtitulada' });
                });
                next = next.nextElementSibling;
              }
              if (times.length > 0) result.push({ cinema: name, times });
            });
          }

          return result;
        });

        console.log(`      ${domSedes.length} sedes en DOM`);

        for (const { cinema: cinemaName, times } of domSedes) {
          // We don't know the city per sede from DOM alone — assume movie's city context
          // Default to bogota, but log for review
          const cityId = await getOrCreateCity('bogota');
          if (!cityId) continue;
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

      } catch (err) {
        console.error(`      ❌ Error procesando ${title}:`, err);
      } finally {
        await moviePage.close();
      }

      // Small delay between movie pages
      await new Promise(r => setTimeout(r, 1000));
    }

  } catch (err) {
    console.error('❌ Error fatal en Cine Colombia Scraper:', err);
  } finally {
    await browser.close();
    console.log('\n✅ Cine Colombia Scraper finalizado.');
  }
}
