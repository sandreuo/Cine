import { chromium } from 'playwright';
import { supabaseAdmin as supabase } from '../lib/supabase-admin';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(process.cwd(), '.env.local') });

const today = new Date().toISOString().split('T')[0];

function slugify(text: string): string {
  return text.toLowerCase().normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function cleanTitle(raw: string): string {
  return raw.replace(/[\s\n\r]+/g, ' ')
    .replace(/\s*\(?\s*(DOB|SUB|DUBBED|SUBTITULAD[AO])\s*(2D|3D|IMAX|4DX|XD)?\s*\)?\s*$/i, '')
    .replace(/\s*\(?\s*(2D|3D|IMAX|4DX|XD)\s*\)?\s*$/i, '').trim();
}

const GARBAGE_PATTERNS = [
  /^(top[\s-]+)?banner/i, /^horario[\s-]+apertura/i, /\bmembership\b/i,
  /\bactivated\b/i, /\bworld[\s-]+tour\b/i, /\blive[\s-]+viewing\b/i,
  /arirang/i, /^bts\b/i, /^standar(d)?$/i, /^cine[\s-]club/i,
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

async function getOrCreateCity(slug: string, name?: string): Promise<number | null> {
  const { data } = await supabase.from('cities').select('id').eq('slug', slug).single();
  if (data) return data.id;
  const cityName = name ?? slug.charAt(0).toUpperCase() + slug.slice(1);
  const { data: c, error } = await supabase.from('cities').insert({ slug, name: cityName }).select('id').single();
  if (error) { console.error('Error ciudad:', error.message); return null; }
  return c?.id ?? null;
}

async function getOrCreateCinema(name: string, cityId: number): Promise<number | null> {
  const { data } = await supabase.from('cinemas').select('id').eq('name', name).eq('city_id', cityId).single();
  if (data) return data.id;
  const { data: c, error } = await supabase.from('cinemas')
    .insert({ name, city_id: cityId, chain: 'cinepolis' }).select('id').single();
  if (error) { console.error('Error cine:', error.message); return null; }
  return c?.id ?? null;
}

// Cinépolis Colombia cities: confirmed 404 for most except bogota, cali, barranquilla, manizales
// Keeping all and gracefully skipping 404s
const CITIES: Array<{ slug: string; name: string }> = [
  { slug: 'bogota', name: 'Bogotá' },
  { slug: 'cali', name: 'Cali' },
  { slug: 'barranquilla', name: 'Barranquilla' },
  { slug: 'manizales', name: 'Manizales' },
  { slug: 'medellin', name: 'Medellín' },
  { slug: 'bucaramanga', name: 'Bucaramanga' },
  { slug: 'cartagena', name: 'Cartagena' },
  { slug: 'pereira', name: 'Pereira' },
];

export async function scrapeCinepolis() {
  console.log('🎬 Iniciando scraper de Cinépolis Colombia...');

  const browser = await chromium.launch({
    headless: true,
    args: ['--disable-blink-features=AutomationControlled', '--no-sandbox', '--disable-setuid-sandbox'],
  });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    locale: 'es-CO',
    timezoneId: 'America/Bogota',
    extraHTTPHeaders: { 'Accept-Language': 'es-CO,es;q=0.9' },
  });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  try {
    for (const { slug: citySlug, name: cityName } of CITIES) {
      console.log(`\n📍 Cinépolis: ${citySlug}`);

      const allApiData: { url: string; body: any }[] = [];
      const cartelaPage = await context.newPage();

      // Capture ALL JSON responses — no filter
      await cartelaPage.route('**/*', async (route, request) => {
        const response = await route.fetch();
        const ct = response.headers()['content-type'] ?? '';
        if (ct.includes('application/json')) {
          try {
            const body = await response.json();
            allApiData.push({ url: request.url(), body });
          } catch { /* ignore */ }
        }
        await route.fulfill({ response });
      });

      const cartelaUrl = `https://cinepolis.com.co/cartelera/${citySlug}-colombia`;
      try {
        await cartelaPage.goto(cartelaUrl, { waitUntil: 'networkidle', timeout: 40000 });
      } catch {
        try {
          await cartelaPage.goto(cartelaUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        } catch {
          await cartelaPage.close();
          continue;
        }
      }
      await cartelaPage.waitForTimeout(5000);

      const pageTitle = await cartelaPage.title();
      if (pageTitle.toLowerCase().includes('404') || pageTitle.toLowerCase().includes('error')) {
        console.log(`   ⚠️  404 — ciudad no existe en Cinépolis`);
        await cartelaPage.unroute('**/*');
        await cartelaPage.close();
        continue;
      }

      console.log(`   APIs capturadas: ${allApiData.length}`);
      for (const { url, body } of allApiData) {
        console.log(`      📡 ${url.substring(0, 100)} → keys: ${Object.keys(body ?? {}).join(', ').substring(0, 80)}`);
      }

      // Try __NEXT_DATA__
      const ndStr = await cartelaPage.evaluate(() => document.getElementById('__NEXT_DATA__')?.textContent ?? null);
      let movieRefs: { slug: string; title: string; url: string }[] = [];

      if (ndStr) {
        const nd = JSON.parse(ndStr);
        const pp = nd?.props?.pageProps ?? {};
        console.log(`   pageProps keys: ${Object.keys(pp).join(', ')}`);

        const rawMovies: any[] = pp.movies ?? pp.billboard?.movies ?? pp.data?.movies ?? pp.films ?? pp.cartelera ?? [];
        console.log(`   ${rawMovies.length} películas en __NEXT_DATA__`);

        movieRefs = rawMovies.map((m: any) => ({
          slug: m.slug ?? m.url_slug ?? slugify(m.title ?? m.titulo ?? ''),
          title: cleanTitle(m.title ?? m.titulo ?? m.name ?? ''),
          url: m.url ?? '',
        })).filter(r => isValidMovieTitle(r.title));
      }

      // DOM fallback: find movie links
      if (movieRefs.length === 0) {
        movieRefs = await cartelaPage.evaluate(() => {
          const refs: { slug: string; title: string; url: string }[] = [];
          document.querySelectorAll('a[href*="/pelicula/"], a[href*="/cartelera/"]').forEach((a) => {
            const href = (a as HTMLAnchorElement).href;
            // Match /cartelera/{city}/{slug} or /pelicula/{slug}
            const m = href.match(/\/(?:pelicula|cartelera\/[^/]+)\/([^/?#]+)/);
            if (!m) return;
            const slug = m[1];
            // Exclude city slugs
            if (['bogota', 'cali', 'medellin', 'barranquilla', 'bucaramanga', 'cartagena', 'manizales', 'pereira'].includes(slug)) return;
            const title = a.querySelector('h2,h3,h4,[class*="title"],[class*="titulo"]')?.textContent?.trim()
              ?? a.getAttribute('title') ?? slug.replace(/-/g, ' ');
            if (!refs.find(r => r.slug === slug)) refs.push({ slug, title, url: href });
          });
          return refs;
        });
        movieRefs = movieRefs
          .map(r => ({ ...r, title: cleanTitle(r.title) }))
          .filter(r => isValidMovieTitle(r.title));
        console.log(`   ${movieRefs.length} películas desde DOM`);
      }

      await cartelaPage.unroute('**/*');
      await cartelaPage.close();

      if (movieRefs.length === 0) {
        console.log(`   ⚠️  Sin películas para ${citySlug}`);
        continue;
      }

      const cityId = await getOrCreateCity(citySlug, cityName);
      if (!cityId) continue;

      // ── STEP 2: Per-movie detail page → all cinema sedes ─────────────────
      for (const ref of movieRefs) {
        const { slug, title, url: refUrl } = ref;
        const movieSlug = slug || slugify(title);

        const { data: movie } = await supabase.from('movies').upsert(
          { slug: movieSlug, title }, { onConflict: 'slug' }
        ).select('id').single();
        if (!movie) continue;

        // Cinépolis movie page: /cartelera/{city}-colombia/{slug}
        const movieUrl = refUrl?.startsWith('http')
          ? refUrl
          : `https://cinepolis.com.co/cartelera/${citySlug}-colombia/${slug}`;

        const movieApiData: { url: string; body: any }[] = [];
        const moviePage = await context.newPage();

        await moviePage.route('**/*', async (route, request) => {
          const response = await route.fetch();
          const ct = response.headers()['content-type'] ?? '';
          if (ct.includes('application/json')) {
            try { movieApiData.push({ url: request.url(), body: await response.json() }); } catch { /* ignore */ }
          }
          await route.fulfill({ response });
        });

        console.log(`   🎥 ${title}`);
        try {
          await moviePage.goto(movieUrl, { waitUntil: 'domcontentloaded', timeout: 35000 });
          await moviePage.waitForTimeout(4000);

          // Try __NEXT_DATA__ on movie page
          const movieNd = await moviePage.evaluate(() => document.getElementById('__NEXT_DATA__')?.textContent ?? null);

          let sedeCount = 0;
          if (movieNd) {
            const nd = JSON.parse(movieNd);
            const pp = nd?.props?.pageProps ?? {};

            // Update movie metadata if available
            const m = pp.movie ?? pp.film ?? pp.data ?? pp.pelicula ?? {};
            if (m.titulo ?? m.title ?? m.poster_url ?? m.image) {
              await supabase.from('movies').update({
                title: cleanTitle(m.titulo ?? m.title ?? title),
                poster_url: m.poster_url ?? m.image ?? m.poster ?? null,
                description: m.sinopsis ?? m.synopsis ?? m.description ?? null,
                duration_minutes: parseInt(String(m.duracion ?? m.duration ?? '0')) || null,
                rating: m.clasificacion ?? m.rating ?? null,
              }).eq('id', movie.id);
            }

            // Showings: sedes with schedules
            const showings: any[] = pp.showings ?? pp.screenings ?? pp.funciones ?? pp.horarios ??
              m.showings ?? m.screenings ?? m.funciones ?? [];

            for (const showing of showings) {
              const cinemaName: string = showing.nombre ?? showing.cinema?.nombre ??
                showing.name ?? showing.cinema?.name ?? showing.complejo ?? '';
              if (!cinemaName) continue;

              // Cinema city — may differ from current city loop
              const rawCity: string = showing.ciudad ?? showing.city ?? showing.cinema?.ciudad ?? citySlug;
              const sCity = rawCity.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(' ')[0];
              const scdCitySlug = sCity || citySlug;
              const scCityId = scdCitySlug !== citySlug
                ? (await getOrCreateCity(scdCitySlug) ?? cityId)
                : cityId;

              const cinemaId = await getOrCreateCinema(cinemaName, scCityId);
              if (!cinemaId) continue;
              sedeCount++;

              const schedules: any[] = showing.horarios ?? showing.schedules ??
                showing.funciones ?? (showing.hora ? [showing] : []);
              for (const sched of schedules) {
                const rawTime: string = sched.hora ?? sched.time ?? sched.start_time ?? '';
                if (!rawTime) continue;
                const startTime = /^\d{1,2}:\d{2}$/.test(rawTime)
                  ? `${today}T${rawTime.padStart(5, '0')}:00` : rawTime;

                await supabase.from('screenings').upsert({
                  movie_id: movie.id, cinema_id: cinemaId, start_time: startTime,
                  format: normalizeFormat(sched.tipo ?? sched.format ?? sched.sala ?? '2D'),
                  language: normalizeLanguage(sched.idioma ?? sched.language ?? 'subtitulada'),
                  buy_url: null,
                }, { onConflict: 'movie_id,cinema_id,start_time' });
              }
            }
            if (sedeCount > 0) console.log(`      ✅ ${sedeCount} sedes en __NEXT_DATA__`);
          }

          // Log all captured APIs on movie page for structure discovery
          if (movieApiData.length > 0) {
            for (const { url, body } of movieApiData) {
              console.log(`      📡 ${url.substring(0, 100)}`);
              const preview = JSON.stringify(body).substring(0, 200);
              console.log(`         ${preview}`);
            }
          }

          // DOM fallback: scan for cinema name headings + time buttons
          if (sedeCount === 0) {
            const domSedes = await moviePage.evaluate(() => {
              const result: { cinema: string; times: { time: string; format: string; lang: string }[] }[] = [];

              document.querySelectorAll('h2, h3, h4').forEach((h) => {
                const name = h.textContent?.trim() ?? '';
                if (name.length < 4) return;

                const times: { time: string; format: string; lang: string }[] = [];
                let sibling = h.nextElementSibling;
                let depth = 0;
                while (sibling && depth < 10) {
                  sibling.querySelectorAll('button, a[href], [class*="hora"], [class*="time"]').forEach((btn) => {
                    const t = btn.textContent?.trim() ?? '';
                    const match = t.match(/\b(\d{1,2}:\d{2})\b/);
                    if (!match) return;
                    const ctx = btn.closest('[class]')?.textContent ?? btn.parentElement?.textContent ?? '';
                    const format = ctx.match(/\b(IMAX|4DX|3D|2D|XD|Premium)\b/i)?.[1]?.toUpperCase() ?? '2D';
                    const lang = ctx.toLowerCase().includes('dob') ? 'doblada' : 'subtitulada';
                    times.push({ time: match[1], format, lang });
                  });
                  if (['H2', 'H3', 'H4'].includes(sibling.tagName)) break;
                  sibling = sibling.nextElementSibling;
                  depth++;
                }
                if (times.length > 0) result.push({ cinema: name, times });
              });
              return result;
            });

            if (domSedes.length > 0) {
              console.log(`      ✅ ${domSedes.length} sedes via DOM`);
              for (const { cinema: cinemaName, times } of domSedes) {
                const cinemaId = await getOrCreateCinema(cinemaName, cityId);
                if (!cinemaId) continue;
                for (const sched of times) {
                  await supabase.from('screenings').upsert({
                    movie_id: movie.id, cinema_id: cinemaId,
                    start_time: `${today}T${sched.time.padStart(5, '0')}:00`,
                    format: sched.format, language: sched.lang, buy_url: null,
                  }, { onConflict: 'movie_id,cinema_id,start_time' });
                }
              }
            }
          }

        } catch (err) {
          console.error(`      ❌ ${title}:`, (err as Error).message);
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
