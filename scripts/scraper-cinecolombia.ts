/**
 * CineColombia scraper — Vista Cinema API (digital-api.cinecolombia.com/ocapi/v1)
 *
 * JWT auth strategy (12h token issued by auth.moviexchange.com):
 *   1. Check CINECOLOMBIA_JWT env var — use it if still valid
 *   2. Playwright: load /films/ → click first film → intercept digital-api call → grab JWT
 *      (works on local machine or self-hosted GitHub Actions runner)
 *
 * Once we have the JWT, ALL data comes from digital-api.cinecolombia.com directly:
 *   GET /ocapi/v1/sites         → all cinemas with name, city, coords
 *   GET /ocapi/v1/attributes    → attribute ID → format/language map
 *   GET /ocapi/v1/films/now-playing → all films in cartelera
 *   GET /ocapi/v1/showtimes/by-business-date/{date}?filmIds=&siteIds= → showtimes
 *
 * For GitHub Actions (non-self-hosted):
 *   Set CINECOLOMBIA_JWT secret. When it expires (~12h) the run is skipped gracefully.
 *   Recommended: use a self-hosted runner on your Mac for automatic JWT refresh.
 */
import { chromium } from 'playwright';
import { supabaseAdmin as supabase } from '../lib/supabase-admin';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(process.cwd(), '.env.local') });

const DIGITAL_API = 'https://digital-api.cinecolombia.com/ocapi/v1';
const CC_BASE = 'https://www.cinecolombia.com';
const CHAIN = 'cinecolombia';
const DAYS_AHEAD = 4; // today + 3 more days

// Fallback attribute map derived from observed data.
// Overridden by live /attributes response at runtime.
const ATTR_FALLBACK: Record<string, { kind: 'format' | 'language'; value: string }> = {
  '0000000001': { kind: 'format', value: '3D' },
  '0000000002': { kind: 'format', value: 'IMAX' },
  '0000000003': { kind: 'format', value: '4DX' },
  '0000000004': { kind: 'format', value: '2D' },
  '0000000007': { kind: 'language', value: 'subtitulada' },
  '0000000008': { kind: 'language', value: 'doblada' },
};

// Vista Cinema API returns localized text as {"text":"ANDINO","translations":[]}
// This extracts the plain string from that format (or returns the value as-is if already a string)
function extractText(val: any): string {
  if (!val) return '';
  if (typeof val === 'string') return val;
  if (typeof val === 'object') return String(val.text ?? val.Text ?? val.value ?? val.name ?? '');
  return String(val);
}

function slugify(text: any): string {
  if (!text) return '';
  return extractText(text).toLowerCase().normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function citySlugFromText(text: string): string {
  const n = (text ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  const MAP: Record<string, string> = {
    bogota: 'bogota', medellin: 'medellin', cali: 'cali',
    barranquilla: 'barranquilla', bucaramanga: 'bucaramanga', cartagena: 'cartagena',
    manizales: 'manizales', pereira: 'pereira', cucuta: 'cucuta',
    villavicencio: 'villavicencio', monteria: 'monteria', armenia: 'armenia',
    pasto: 'pasto', ibague: 'ibague', neiva: 'neiva', 'santa marta': 'santa-marta',
    palmira: 'palmira', chia: 'chia', zipaquira: 'zipaquira',
    girardot: 'girardot', rionegro: 'rionegro', sincelejo: 'sincelejo',
    // Municipios del área metropolitana → ciudad principal
    soledad: 'barranquilla',
    envigado: 'medellin', sabaneta: 'medellin', itagui: 'medellin',
    bello: 'medellin', copacabana: 'medellin', caldas: 'medellin',
    floridablanca: 'bucaramanga', piedecuesta: 'bucaramanga', giron: 'bucaramanga',
    yumbo: 'cali', jamundi: 'cali',
    cota: 'bogota',
  };
  return MAP[n] ?? slugify(n) ?? 'bogota';
}

function normalizeFormat(raw: string): string {
  const f = (raw ?? '').toUpperCase();
  if (f.includes('IMAX')) return 'IMAX';
  if (f.includes('4DX') || f.includes('FOUR')) return '4DX';
  if (f.includes('XD')) return 'XD';
  if (f.includes('PREMIUM') || f.includes('VIP') || f.includes('ELITE')) return 'PREMIUM';
  if (f.includes('3D')) return '3D';
  return '2D';
}

function isJWTExpired(jwt: string): boolean {
  try {
    const payload = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64').toString());
    const exp: number = payload.exp ?? 0;
    // Consider expired if less than 30 min remaining
    return Date.now() / 1000 > exp - 1800;
  } catch {
    return true;
  }
}

function businessDates(): string[] {
  const dates: string[] = [];
  for (let i = 0; i < DAYS_AHEAD; i++) {
    const d = new Date();
    d.setDate(d.getDate() + i);
    // Format as YYYYMMDD (Vista Cinema date format)
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    dates.push(`${yyyy}${mm}${dd}`);
  }
  return dates;
}

// ── DB helpers ────────────────────────────────────────────────────────────────

async function getOrCreateCity(slug: string, displayName?: string): Promise<number | null> {
  const { data } = await supabase.from('cities').select('id').eq('slug', slug).single();
  if (data) return (data as any).id;
  const name = displayName ?? slug.charAt(0).toUpperCase() + slug.slice(1);
  const { data: c, error } = await supabase.from('cities').insert({ slug, name }).select('id').single();
  if (error) { console.error('Error ciudad:', error.message); return null; }
  return (c as any)?.id ?? null;
}

async function getOrCreateCinema(
  name: string, cityId: number, lat?: number, lng?: number, address?: string
): Promise<number | null> {
  const { data } = await supabase.from('cinemas').select('id').eq('name', name).eq('city_id', cityId).single();
  if (data) return (data as any).id;
  const { data: c, error } = await supabase.from('cinemas').insert({
    name, city_id: cityId, chain: CHAIN,
    lat: lat ?? null, lng: lng ?? null,
    address: address ?? null,
  }).select('id').single();
  if (error) { console.error('Error cine:', error.message); return null; }
  return (c as any)?.id ?? null;
}

// ── Phase 1: Acquire JWT ──────────────────────────────────────────────────────

async function acquireJWTViaPlaywright(): Promise<string> {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
  });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    locale: 'es-CO',
    timezoneId: 'America/Bogota',
  });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  let jwt = '';
  const page = await context.newPage();

  // Intercept ALL requests — grab JWT from any digital-api call
  await page.route('**/*', async (route, request) => {
    if (request.url().includes('digital-api.cinecolombia.com')) {
      const auth = request.headers()['authorization'] ?? '';
      if (auth.startsWith('Bearer ') && !jwt) {
        jwt = auth.replace('Bearer ', '');
        console.log('   🔑 JWT interceptado de digital-api');
      }
    }
    await route.continue();
  });

  try {
    // Step 1: Load films listing to find a film to click
    console.log('   🌐 Cargando /films/...');
    await page.goto(`${CC_BASE}/films/`, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(3000);

    // Step 2: If no JWT yet, click the first film card to trigger the showtimes request
    if (!jwt) {
      const filmLink = await page.$('a[href*="/films/"][href*="/HO"]');
      if (filmLink) {
        const href = await filmLink.getAttribute('href');
        console.log(`   🎯 Navegando a película: ${href}`);
        await page.goto(`${CC_BASE}${href}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(4000);
      }
    }

    // Step 3: If still no JWT, try the known working URL
    if (!jwt) {
      console.log('   🎯 Intentando URL fija de Project Hail Mary...');
      await page.goto(`${CC_BASE}/films/project-hail-mary/HO00000456/`, {
        waitUntil: 'domcontentloaded', timeout: 30000,
      });
      await page.waitForTimeout(4000);
    }
  } catch (err) {
    console.error('   ❌ Playwright error:', (err as Error).message);
  } finally {
    await browser.close();
  }

  if (!jwt) {
    throw new Error(
      'No se pudo obtener JWT. Opciones:\n' +
      '  1. Corre el scraper localmente (Mac)\n' +
      '  2. Usa un self-hosted GitHub Actions runner en tu Mac\n' +
      '  3. Exporta CINECOLOMBIA_JWT manualmente desde Chrome DevTools'
    );
  }
  return jwt;
}

async function acquireJWT(): Promise<string> {
  const envJwt = process.env.CINECOLOMBIA_JWT ?? '';
  if (envJwt && !isJWTExpired(envJwt)) {
    console.log('   🔑 Usando JWT de variable de entorno (válido)');
    return envJwt;
  }
  if (envJwt) console.log('   ⚠️  JWT de env expirado, obteniendo nuevo via Playwright...');
  return acquireJWTViaPlaywright();
}

// ── Phase 2: API calls with JWT ───────────────────────────────────────────────

function apiHeaders(jwt: string): Record<string, string> {
  return {
    'Authorization': `Bearer ${jwt}`,
    'Accept': 'application/json',
    'Accept-Language': 'es-CO,es;q=0.9',
    'Origin': CC_BASE,
    'Referer': `${CC_BASE}/`,
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
  };
}

async function fetchSites(jwt: string): Promise<any[]> {
  try {
    const res = await fetch(`${DIGITAL_API}/sites`, { headers: apiHeaders(jwt) });
    if (!res.ok) { console.warn(`   ⚠️  /sites → ${res.status}`); return []; }
    const data = await res.json();
    const sites = Array.isArray(data) ? data : (data?.sites ?? data?.Sites ?? []);
    console.log(`   📍 ${sites.length} sedes en /sites`);
    return sites;
  } catch (err) {
    console.error('   ❌ Error /sites:', (err as Error).message);
    return [];
  }
}

async function fetchAttributes(jwt: string): Promise<Record<string, { kind: 'format' | 'language'; value: string }>> {
  try {
    const res = await fetch(`${DIGITAL_API}/attributes`, { headers: apiHeaders(jwt) });
    if (!res.ok) return ATTR_FALLBACK;
    const data = await res.json();
    const attrs: any[] = Array.isArray(data) ? data : (data?.attributes ?? data?.Attributes ?? []);

    const map: Record<string, { kind: 'format' | 'language'; value: string }> = { ...ATTR_FALLBACK };
    for (const a of attrs) {
      const id = String(a.Id ?? a.id ?? a.AttributeId ?? '');
      const desc = (a.Description ?? a.description ?? a.ShortName ?? a.Name ?? a.name ?? '').toUpperCase();
      if (!id || !desc) continue;
      if (desc.includes('IMAX')) map[id] = { kind: 'format', value: 'IMAX' };
      else if (desc.includes('4DX') || desc.includes('4D')) map[id] = { kind: 'format', value: '4DX' };
      else if (desc.includes('XD') || desc.includes('XTREME')) map[id] = { kind: 'format', value: 'XD' };
      else if (desc.includes('3D')) map[id] = { kind: 'format', value: '3D' };
      else if (desc.includes('2D')) map[id] = { kind: 'format', value: '2D' };
      else if (desc.includes('SUB') || desc.includes('SUBT') || desc.includes('SUBTITULAD')) map[id] = { kind: 'language', value: 'subtitulada' };
      else if (desc.includes('DOB') || desc.includes('DUB') || desc.includes('DOBLAD')) map[id] = { kind: 'language', value: 'doblada' };
    }
    console.log(`   🎭 ${Object.keys(map).length} atributos cargados`);
    return map;
  } catch {
    return ATTR_FALLBACK;
  }
}

async function fetchNowPlaying(jwt: string): Promise<any[]> {
  // Try multiple Vista Cinema endpoint variants
  const endpoints = [
    `${DIGITAL_API}/films/now-playing`,
    `${DIGITAL_API}/films?status=NowShowing`,
    `${DIGITAL_API}/films/now-showing`,
    `${DIGITAL_API}/films`,
  ];
  for (const url of endpoints) {
    try {
      const res = await fetch(url, { headers: apiHeaders(jwt) });
      if (!res.ok) continue;
      const data = await res.json();
      const films: any[] = Array.isArray(data) ? data : (data?.films ?? data?.Films ?? data?.nowShowing ?? []);
      if (films.length > 0) {
        console.log(`   🎬 ${films.length} películas en ${url.replace(DIGITAL_API, '')}`);
        return films;
      }
    } catch { /* try next */ }
  }
  return [];
}

async function fetchShowtimes(jwt: string, filmId: string, allSiteIds: string[], dateStr: string): Promise<any[]> {
  // dateStr = YYYYMMDD
  // Try specific date first, then 'first' (= today)
  const endpoints = [
    `${DIGITAL_API}/showtimes/by-business-date/${dateStr}`,
    dateStr === businessDates()[0] ? `${DIGITAL_API}/showtimes/by-business-date/first` : null,
  ].filter(Boolean) as string[];

  for (const base of endpoints) {
    try {
      const params = new URLSearchParams();
      params.append('filmIds', filmId);
      // Pass all site IDs (Vista API filters internally — returns only matching ones)
      for (const id of allSiteIds) params.append('siteIds', id);
      const url = `${base}?${params}`;
      const res = await fetch(url, { headers: apiHeaders(jwt) });
      if (!res.ok) continue;
      const data = await res.json();
      const list: any[] = data?.showtimes ?? data?.Showtimes ?? [];
      if (list.length >= 0) return list; // even empty is valid
    } catch { /* try next */ }
  }
  return [];
}

// ── Main export ────────────────────────────────────────────────────────────────

export async function scrapeCineColombia() {
  console.log('🎬 Iniciando scraper CineColombia (Vista Cinema API)...');

  // ── Phase 1: JWT ─────────────────────────────────────────────────────────
  let jwt: string;
  try {
    jwt = await acquireJWT();
  } catch (err) {
    console.error('❌ JWT no disponible:', (err as Error).message);
    console.error('   💡 Solución rápida: exporta CINECOLOMBIA_JWT desde Chrome DevTools');
    return;
  }

  // ── Phase 2: Sites → build cinema/city map ────────────────────────────────
  console.log('\n📍 Cargando sedes...');
  const rawSites = await fetchSites(jwt);

  // siteId → { dbCinemaId, dbCityId }
  const siteDbMap: Record<string, { cinemaId: number; cityId: number }> = {};
  const cityCache: Record<string, number> = {};

  for (const s of rawSites) {
    const siteId = String(s.Id ?? s.id ?? s.SiteId ?? s.siteId ?? '');
    if (!siteId) continue;

    const name: string = extractText(s.Name ?? s.name ?? s.SiteName) || `CineColombia ${siteId}`;
    const rawCity: string = extractText(s.City ?? s.city ?? s.CityName ?? s.Region ?? s.region);
    const citySlug = rawCity ? citySlugFromText(rawCity) : 'bogota';
    const cityDisplay: string = rawCity || citySlug;
    const lat: number | undefined = parseFloat(s.Latitude ?? s.latitude ?? s.Lat ?? '') || undefined;
    const lng: number | undefined = parseFloat(s.Longitude ?? s.longitude ?? s.Lng ?? '') || undefined;
    const address: string | undefined = s.Address ?? s.address ?? undefined;

    let cityId = cityCache[citySlug];
    if (!cityId) {
      cityId = await getOrCreateCity(citySlug, cityDisplay) ?? 0;
      if (cityId) cityCache[citySlug] = cityId;
    }
    if (!cityId) continue;

    const cinemaId = await getOrCreateCinema(name, cityId, lat, lng, address);
    if (cinemaId) siteDbMap[siteId] = { cinemaId, cityId };
  }

  // If /sites returned nothing, fall back to Bogotá siteIds from the known showtimes URL
  if (rawSites.length === 0) {
    console.log('   ⚠️  /sites vacío — usando siteIds conocidos de Bogotá como fallback');
    const BOGOTA_SITE_IDS = [
      '6871','6461','6760','6493','6541','6669','6501','6791',
      '6451','6754','6736','6674','6431','6536','7249','6427',
      '6630','6750','6659','7131','6183',
    ];
    const bogotaId = await getOrCreateCity('bogota', 'Bogotá') ?? 0;
    if (bogotaId) {
      cityCache['bogota'] = bogotaId;
      for (const id of BOGOTA_SITE_IDS) {
        const cinemaId = await getOrCreateCinema(`CineColombia ${id}`, bogotaId);
        if (cinemaId) siteDbMap[id] = { cinemaId, cityId: bogotaId };
      }
    }
  }

  const allSiteIds = Object.keys(siteDbMap);
  console.log(`   ✅ ${allSiteIds.length} sedes mapeadas en DB`);

  // ── Phase 3: Attribute map ────────────────────────────────────────────────
  const attrMap = await fetchAttributes(jwt);

  // ── Phase 4: Films in cartelera ───────────────────────────────────────────
  console.log('\n🎬 Cargando películas...');
  let vistaFilms = await fetchNowPlaying(jwt);

  if (vistaFilms.length === 0) {
    console.warn('   ⚠️  No se encontraron películas via API — intentando via Playwright __NEXT_DATA__...');
    // Fallback: scrape __NEXT_DATA__ from films page (requires Playwright again)
    const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
    const ctx = await browser.newContext({ locale: 'es-CO' });
    const pg = await ctx.newPage();
    try {
      await pg.goto(`${CC_BASE}/films/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await pg.waitForTimeout(2000);
      const ndStr = await pg.evaluate(() => document.getElementById('__NEXT_DATA__')?.textContent ?? null);
      if (ndStr) {
        const nd = JSON.parse(ndStr);
        const pp = nd?.props?.pageProps ?? {};
        vistaFilms = pp.films ?? pp.movies ?? pp.billboard ?? pp.Films ?? [];
        console.log(`   🎬 ${vistaFilms.length} películas en __NEXT_DATA__`);
      }
    } catch { /* ignore */ }
    await browser.close();
  }

  if (vistaFilms.length === 0) {
    console.error('❌ Sin películas — abortando');
    return;
  }

  // ── Phase 5: Showtimes per film per date ──────────────────────────────────
  console.log('\n🕐 Cargando horarios...');
  let totalScreenings = 0;
  const dates = businessDates();

  for (const vf of vistaFilms) {
    const filmId: string = String(vf.Id ?? vf.id ?? vf.FilmId ?? vf.ExternalCode ?? vf.externalCode ?? '');
    if (!filmId) continue;

    // Upsert movie with whatever info Vista gives us
    try {
      const rawTitle = extractText(vf.Title ?? vf.title ?? vf.Name ?? vf.name);
      const title = rawTitle || `Film ${filmId}`;
      const rawSlug = extractText(vf.Slug ?? vf.slug ?? vf.UrlSlug);
      const slug = rawSlug || slugify(title);
      if (!slug) continue;

      const poster: string | null = vf.PosterUrl ?? vf.posterUrl ?? vf.GraphicUrl ?? vf.Poster ?? vf.poster ?? null;

      const { data: dbMovie } = await supabase.from('movies').upsert({
        slug, title, poster_url: poster,
        is_estreno: vf.IsNowShowing === true || vf.status === 'NowShowing',
        is_preventa: vf.IsComingSoon === true || vf.status === 'ComingSoon',
      }, { onConflict: 'slug' }).select('id').single();

      if (!dbMovie) continue;

      let filmTotal = 0;

      for (const dateStr of dates) {
        const showtimes = await fetchShowtimes(jwt, filmId, allSiteIds, dateStr);

        for (const st of showtimes) {
          const siteId = String(st.siteId ?? st.SiteId ?? '');
          const dbSite = siteDbMap[siteId];
          if (!dbSite) continue;

          const startTime: string = st.schedule?.startsAt ?? st.schedule?.filmStartsAt ?? '';
          if (!startTime) continue;

          let format = '2D';
          let language: 'subtitulada' | 'doblada' | 'original' = 'subtitulada';

          for (const attrId of (st.attributeIds ?? [])) {
            const attr = attrMap[String(attrId)];
            if (!attr) continue;
            if (attr.kind === 'format') format = normalizeFormat(attr.value);
            else if (attr.kind === 'language') language = attr.value as 'subtitulada' | 'doblada' | 'original';
          }

          const { error } = await supabase.from('screenings').upsert({
            movie_id: (dbMovie as any).id,
            cinema_id: dbSite.cinemaId,
            start_time: startTime,
            format,
            language,
            buy_url: st.bookingUrl ?? st.BookingUrl ?? null,
          }, { onConflict: 'movie_id,cinema_id,start_time' });

          if (!error) filmTotal++;
        }

        await new Promise(r => setTimeout(r, 150));
      }

      if (filmTotal > 0) console.log(`   ✅ ${title}: ${filmTotal} funciones (${dates.length} días)`);
      totalScreenings += filmTotal;
    } catch (filmErr) {
      console.error(`   ❌ Error procesando film ${filmId}:`, (filmErr as Error).message);
    }
  }

  console.log(`\n✅ CineColombia: ${totalScreenings} funciones guardadas (${vistaFilms.length} películas, ${allSiteIds.length} sedes)`);
}
