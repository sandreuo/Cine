/**
 * CineColombia scraper
 * Strategy: Next.js /_next/data/ API calls bypass Cloudflare entirely.
 * We first fetch the HTML minimally to get the build ID, then call JSON endpoints directly.
 * Fallback: Playwright if build ID fetch fails.
 */
import { chromium } from 'playwright';
import { supabaseAdmin as supabase } from '../lib/supabase-admin';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(process.cwd(), '.env.local') });

const today = new Date().toISOString().split('T')[0];
const BASE = 'https://www.cinecolombia.com';

const CITIES = ['bogota', 'medellin', 'cali', 'barranquilla', 'bucaramanga', 'cartagena'];

const CITY_NAMES: Record<string, string> = {
  bogota: 'Bogotá', medellin: 'Medellín', cali: 'Cali',
  barranquilla: 'Barranquilla', bucaramanga: 'Bucaramanga', cartagena: 'Cartagena',
};

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
  /^todas las pel/i,
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

async function getOrCreateCity(slug: string): Promise<number | null> {
  const { data } = await supabase.from('cities').select('id').eq('slug', slug).single();
  if (data) return data.id;
  const name = CITY_NAMES[slug] ?? slug.charAt(0).toUpperCase() + slug.slice(1);
  const { data: c, error } = await supabase.from('cities').insert({ slug, name }).select('id').single();
  if (error) { console.error(`Error ciudad ${slug}:`, error.message); return null; }
  return c?.id ?? null;
}

async function getOrCreateCinema(name: string, cityId: number): Promise<number | null> {
  const { data } = await supabase.from('cinemas').select('id').eq('name', name).eq('city_id', cityId).single();
  if (data) return data.id;
  const { data: c, error } = await supabase.from('cinemas')
    .insert({ name, city_id: cityId, chain: 'cinecolombia' }).select('id').single();
  if (error) { console.error(`Error cine ${name}:`, error.message); return null; }
  return c?.id ?? null;
}

// Try to fetch Next.js build ID from the page HTML using Playwright to bypass basic Cloudflare
async function getNextBuildId(): Promise<string | null> {
  console.log('   🔍 Obteniendo Build ID via Playwright (Modo Sigilo)...');
  const browser = await chromium.launch({ 
    headless: true,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--window-size=1280,720'
    ]
  });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 720 },
    locale: 'es-CO',
    timezoneId: 'America/Bogota',
  });
  
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    // @ts-ignore
    window.chrome = { runtime: {} };
    // @ts-ignore
    navigator.languages = ['es-CO', 'es'];
  });

  const page = await context.newPage();
  
  try {
    // Random wait to seem more human
    await page.goto(`${BASE}/bogota/cartelera`, { waitUntil: 'networkidle', timeout: 60000 });
    
    // Simulate some human interaction
    await page.mouse.move(Math.random() * 500, Math.random() * 500);
    await page.evaluate(() => window.scrollTo(0, 300));
    await page.waitForTimeout(3000 + Math.random() * 2000);
    
    const buildId = await page.evaluate(() => {
      try {
        const nextData = document.getElementById('__NEXT_DATA__');
        if (nextData) return JSON.parse(nextData.textContent || '{}').buildId;
        // Fallback: search in script tags
        const scripts = Array.from(document.querySelectorAll('script'));
        for (const s of scripts) {
          const match = s.textContent?.match(/"buildId":"([^"]+)"/);
          if (match) return match[1];
        }
        return null;
      } catch { return null; }
    });
    
    if (buildId) console.log(`      ✅ Build ID encontrado: ${buildId}`);
    else {
      const title = await page.title();
      console.error(`      ⚠️  Build ID no encontrado. Título de página: "${title}"`);
    }

    await browser.close();
    return buildId || null;
  } catch (err) {
    console.error('      ❌ Error obteniendo buildId:', (err as Error).message);
    await browser.close();
    return null;
  }
}

// Fetch Next.js JSON data endpoint directly
async function fetchNextData(buildId: string, pagePath: string): Promise<any | null> {
  const url = `${BASE}/_next/data/${buildId}${pagePath}.json`;
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
        'Accept-Language': 'es-CO,es;q=0.9',
        'x-nextjs-data': '1',
      },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function processShowings(showings: any[], movieId: number, defaultCitySlug: string) {
  for (const showing of showings) {
    const cinemaName: string = showing.cinema?.name ?? showing.cinema?.nombre ??
      showing.theater?.name ?? showing.nombre ?? showing.name ?? '';
    if (!cinemaName) continue;

    const rawCity: string = showing.cinema?.city?.slug ?? showing.cinema?.ciudad?.slug ??
      showing.ciudad ?? showing.city ?? '';
    const citySlug = rawCity
      ? CITIES.find(c => rawCity.toLowerCase().includes(c)) ?? defaultCitySlug
      : defaultCitySlug;

    const cityId = await getOrCreateCity(citySlug);
    if (!cityId) continue;
    const cinemaId = await getOrCreateCinema(cinemaName, cityId);
    if (!cinemaId) continue;

    const schedules: any[] = showing.schedules ?? showing.horarios ??
      showing.funciones ?? (showing.time ?? showing.hora ? [showing] : []);

    for (const sched of schedules) {
      const rawTime: string = sched.time ?? sched.hora ?? sched.start_time ?? '';
      if (!rawTime) continue;
      const startTime = /^\d{1,2}:\d{2}$/.test(rawTime)
        ? `${today}T${rawTime.padStart(5, '0')}:00` : rawTime;

      await supabase.from('screenings').upsert({
        movie_id: movieId, cinema_id: cinemaId, start_time: startTime,
        format: normalizeFormat(sched.format ?? sched.tipo ?? sched.sala ?? '2D'),
        language: normalizeLanguage(sched.language ?? sched.idioma ?? 'subtitulada'),
        buy_url: sched.buy_url ?? null,
      }, { onConflict: 'movie_id,cinema_id,start_time' });
    }
  }
}

export async function scrapeCineColombia() {
  console.log('🎬 Iniciando scraper de CINE COLOMBIA...');

  // ── STRATEGY 1: Next.js data API (bypasses Cloudflare) ───────────────────
  const buildId = await getNextBuildId();
  if (buildId) {
    console.log(`   Build ID: ${buildId}`);
    let apiSuccess = false;

    for (const city of CITIES) {
      console.log(`   📍 ${city}`);
      const data = await fetchNextData(buildId, `/${city}/cartelera`);
      if (!data) {
        console.log(`      ⚠️  Sin datos JSON`);
        continue;
      }

      const pp = data?.pageProps ?? {};
      console.log(`      pageProps keys: ${Object.keys(pp).join(', ')}`);

      const rawMovies: any[] = pp.movies ?? pp.billboard?.movies ?? pp.data?.movies ?? pp.content?.movies ?? [];
      console.log(`      ${rawMovies.length} películas`);

      for (const m of rawMovies) {
        const title = cleanTitle(m.title ?? m.titulo ?? '');
        if (!isValidMovieTitle(title)) continue;

        const movieSlug = m.slug ?? m.url_slug ?? slugify(title);
        const { data: movie } = await supabase.from('movies').upsert({
          slug: movieSlug, title,
          poster_url: m.poster_url ?? m.poster ?? m.image ?? null,
          description: m.synopsis ?? m.sinopsis ?? m.description ?? null,
          duration_minutes: parseInt(String(m.duration ?? m.duracion ?? '0')) || null,
          rating: m.rating ?? m.clasificacion ?? null,
          genres: (m.genres ?? m.generos ?? []).map((g: any) => g?.name ?? g?.nombre ?? g ?? ''),
        }, { onConflict: 'slug' }).select('id').single();

        if (!movie) continue;
        apiSuccess = true;

        // Try to get per-movie showings from the movie detail JSON endpoint
        const code = m.code ?? m.id ?? m.film_id ?? m.HO ?? '';
        if (m.slug && code) {
          const movieData = await fetchNextData(buildId, `/films/${m.slug}/${code}/`);
          const mpp = movieData?.pageProps ?? {};
          const showings: any[] = mpp.showings ?? mpp.screenings ?? mpp.functions ?? [];
          if (showings.length > 0) {
            await processShowings(showings, movie.id, city);
            console.log(`      🎥 ${title}: ${showings.length} sedes`);
          }
        }

        // Also process showings embedded in cartelera item
        const embeddedShowings: any[] = m.showings ?? m.screenings ?? m.funciones ?? [];
        if (embeddedShowings.length > 0) {
          await processShowings(embeddedShowings, movie.id, city);
        }
      }
    }

    if (apiSuccess) {
      console.log('✅ Cine Colombia Scraper finalizado (vía Next.js API).');
      return;
    }
    console.log('   ⚠️  API sin datos útiles, usando Playwright...');
  } else {
    console.log('   ⚠️  No se obtuvo buildId, usando Playwright...');
  }

  // ── STRATEGY 2: Playwright with all captured APIs ─────────────────────────
  const browser = await chromium.launch({
    headless: true,
    args: ['--disable-blink-features=AutomationControlled', '--no-sandbox', '--disable-setuid-sandbox'],
  });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    extraHTTPHeaders: {
      'Accept-Language': 'es-CO,es;q=0.9',
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

  try {
    // Load Bogotá cartelera and capture ALL API calls
    const allApiData: { url: string; body: any }[] = [];
    const cartelaPage = await context.newPage();

    await cartelaPage.route('**/*', async (route, request) => {
      const response = await route.fetch();
      const ct = response.headers()['content-type'] ?? '';
      if (ct.includes('application/json')) {
        try { allApiData.push({ url: request.url(), body: await response.json() }); } catch { /* ignore */ }
      }
      await route.fulfill({ response });
    });

    try {
      await cartelaPage.goto(`${BASE}/bogota/cartelera`, { waitUntil: 'networkidle', timeout: 60000 });
    } catch {
      await cartelaPage.goto(`${BASE}/bogota/cartelera`, { waitUntil: 'domcontentloaded', timeout: 45000 });
    }
    await cartelaPage.waitForTimeout(5000);

    const title = await cartelaPage.title();
    console.log(`   Título: "${title}"`);

    if (title.toLowerCase().includes('just a moment') || title.toLowerCase().includes('cloudflare') || title.toLowerCase().includes('un momento')) {
      console.log('   ⚠️  Cloudflare activo. Logeando APIs capturadas antes del bloqueo:');
      for (const { url, body } of allApiData) {
        console.log(`      📡 ${url.substring(0, 100)}`);
      }
      await cartelaPage.close();
      await browser.close();
      console.log('✅ Cine Colombia Scraper finalizado (bloqueado por Cloudflare).');
      return;
    }

    // Log all captured APIs for structure discovery
    console.log(`   ${allApiData.length} APIs capturadas:`);
    for (const { url, body } of allApiData) {
      console.log(`   📡 ${url.substring(0, 100)}`);
      console.log(`      ${JSON.stringify(body).substring(0, 200)}`);
    }

    // Extract movie refs from __NEXT_DATA__ or DOM
    const movieRefs: { slug: string; code: string; title: string }[] = await cartelaPage.evaluate(() => {
      const refs: { slug: string; code: string; title: string }[] = [];

      const nd = document.getElementById('__NEXT_DATA__');
      if (nd) {
        try {
          const data = JSON.parse(nd.textContent ?? '{}');
          const pp = data?.props?.pageProps ?? {};
          const movies: any[] = pp.movies ?? pp.billboard?.movies ?? pp.data?.movies ?? pp.content?.movies ?? [];
          movies.forEach((m: any) => {
            const slug = m.slug ?? m.url_slug ?? '';
            const code = String(m.code ?? m.id ?? m.film_id ?? m.HO ?? '');
            const t = m.title ?? m.titulo ?? '';
            if (slug || code) refs.push({ slug, code, title: t });
          });
          if (refs.length > 0) return refs;
        } catch { /* ignore */ }
      }

      document.querySelectorAll('a[href*="/films/"]').forEach((a) => {
        const href = (a as HTMLAnchorElement).href;
        const match = href.match(/\/films\/([^/]+)\/([^/]+)\//);
        if (match && !refs.find(r => r.code === match[2])) {
          const t = a.querySelector('h2,h3,h4,[class*="title"]')?.textContent?.trim() ?? match[1];
          refs.push({ slug: match[1], code: match[2], title: t });
        }
      });

      return refs;
    });

    const cleanedRefs = movieRefs
      .map(r => ({ ...r, title: cleanTitle(r.title) }))
      .filter(r => isValidMovieTitle(r.title));

    console.log(`   ${cleanedRefs.length} películas válidas`);
    await cartelaPage.close();

    for (const ref of cleanedRefs) {
      const { slug, code, title: refTitle } = ref;
      const movieSlug = slug || slugify(refTitle);

      const { data: movie } = await supabase.from('movies').upsert(
        { slug: movieSlug, title: refTitle }, { onConflict: 'slug' }
      ).select('id').single();
      if (!movie) continue;

      const movieUrl = code
        ? `${BASE}/films/${slug}/${code}/`
        : `${BASE}/bogota/pelicula/${slug}`;

      const moviePage = await context.newPage();
      const movieApiData: { url: string; body: any }[] = [];

      await moviePage.route('**/*', async (route, request) => {
        const response = await route.fetch();
        const ct = response.headers()['content-type'] ?? '';
        if (ct.includes('application/json')) {
          try { movieApiData.push({ url: request.url(), body: await response.json() }); } catch { /* ignore */ }
        }
        await route.fulfill({ response });
      });

      console.log(`   🎥 ${refTitle}`);
      try {
        await moviePage.goto(movieUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
        await moviePage.waitForTimeout(4000);

        const movieNd = await moviePage.evaluate(() => document.getElementById('__NEXT_DATA__')?.textContent ?? null);
        if (movieNd) {
          const nd = JSON.parse(movieNd);
          const pp = nd?.props?.pageProps ?? {};
          const m = pp.movie ?? pp.film ?? pp.data ?? {};

          if (m.title || m.poster_url || m.synopsis) {
            await supabase.from('movies').update({
              title: cleanTitle(m.title ?? m.titulo ?? refTitle),
              poster_url: m.poster_url ?? m.poster ?? m.image ?? null,
              description: m.synopsis ?? m.sinopsis ?? m.description ?? null,
              duration_minutes: parseInt(String(m.duration ?? m.duracion ?? '0')) || null,
              rating: m.rating ?? m.clasificacion ?? null,
              genres: (m.genres ?? m.generos ?? []).map((g: any) => g?.name ?? g ?? ''),
            }).eq('id', movie.id);
          }

          const showings: any[] = pp.showings ?? pp.screenings ?? pp.functions ?? pp.showtimes ??
            m.showings ?? m.screenings ?? [];
          if (showings.length > 0) {
            await processShowings(showings, movie.id, 'bogota');
            console.log(`      ✅ ${showings.length} sedes`);
          }
        }

        // Log movie page APIs for debugging
        for (const { url, body: apiBody } of movieApiData) {
          console.log(`      📡 ${url.substring(0, 100)}`);
          console.log(`         ${JSON.stringify(apiBody).substring(0, 200)}`);
        }

      } catch (err) {
        console.error(`      ❌ ${refTitle}:`, (err as Error).message);
      } finally {
        await moviePage.unroute('**/*');
        await moviePage.close();
      }
      await new Promise(r => setTimeout(r, 1000));
    }

  } catch (err) {
    console.error('❌ Error fatal:', err);
  } finally {
    await browser.close();
    console.log('\n✅ Cine Colombia Scraper finalizado.');
  }
}
