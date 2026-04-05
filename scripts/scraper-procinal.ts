/**
 * Procinal scraper — direct API, no browser needed.
 * Confirmed endpoints from logs:
 * - GET /api/cinemas              → 16 cines con ciudad/dirección
 * - GET /api/site                 → movies_active[] con id, slug, titulo, imagen
 * - GET /api/contents/cartelera  → vacío (retorna null)
 *
 * For showtimes, we try multiple endpoint patterns per movie.
 */
import { supabaseAdmin as supabase } from '../lib/supabase-admin';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(process.cwd(), '.env.local') });

const today = new Date().toISOString().split('T')[0];
const API = 'https://apinew.procinal.com.co';

function slugify(text: string): string {
  return text.toLowerCase().normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function cleanTitle(raw: string): string {
  return raw.replace(/[\s\n\r]+/g, ' ')
    .replace(/^REESTRENO\s*-?\s*/i, '')
    .replace(/\s*\(?\s*(DOB|SUB|DUBBED|SUBTITULAD[AO])\s*(2D|3D|IMAX|4DX|XD|PRE|BIS)?\s*[A-Z]*\s*\)?\s*$/i, '')
    .replace(/\s*\(?\s*(2D|3D|IMAX|4DX|XD|PREMIUM|PRE|BIS)\s*\)?\s*$/i, '')
    .trim();
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

const CITY_SLUG_MAP: Record<string, string> = {
  bogota: 'bogota', bogotá: 'bogota',
  medellin: 'medellin', medellín: 'medellin',
  cali: 'cali', barranquilla: 'barranquilla',
  bucaramanga: 'bucaramanga', cartagena: 'cartagena',
  pereira: 'pereira', manizales: 'manizales',
  cucuta: 'cucuta', cúcuta: 'cucuta',
  villavicencio: 'villavicencio', ibague: 'ibague', ibagué: 'ibague',
  pasto: 'pasto', neiva: 'neiva', armenia: 'armenia',
};

const CITY_NAMES: Record<string, string> = {
  bogota: 'Bogotá', medellin: 'Medellín', cali: 'Cali',
  barranquilla: 'Barranquilla', bucaramanga: 'Bucaramanga',
  cartagena: 'Cartagena', pereira: 'Pereira', manizales: 'Manizales',
  cucuta: 'Cúcuta', villavicencio: 'Villavicencio', ibague: 'Ibagué',
  pasto: 'Pasto', neiva: 'Neiva', armenia: 'Armenia',
};

function citySlugFromText(text: string): string {
  const norm = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  return CITY_SLUG_MAP[norm] ?? norm.replace(/\s+/g, '-');
}

async function getOrCreateCity(slug: string): Promise<number | null> {
  const { data } = await supabase.from('cities').select('id').eq('slug', slug).single();
  if (data) return data.id;
  const name = CITY_NAMES[slug] ?? slug.charAt(0).toUpperCase() + slug.slice(1);
  const { data: c, error } = await supabase.from('cities').insert({ slug, name }).select('id').single();
  if (error) { console.error('Error ciudad:', error.message); return null; }
  return c?.id ?? null;
}

async function getOrCreateCinema(name: string, cityId: number, address?: string): Promise<number | null> {
  const { data } = await supabase.from('cinemas').select('id').eq('name', name).eq('city_id', cityId).single();
  if (data) return data.id;
  const { data: c, error } = await supabase.from('cinemas')
    .insert({ name, city_id: cityId, chain: 'procinal', address: address ?? null })
    .select('id').single();
  if (error) { console.error('Error cine:', error.message); return null; }
  return c?.id ?? null;
}

async function apiFetch(url: string): Promise<any | null> {
  try {
    const res = await fetch(url, { headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' } });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function scrapeProcinal() {
  console.log('🎬 Iniciando scraper de Procinal Colombia...');

  // ── Step 1: Cinema map ────────────────────────────────────────────────────
  const cinemasRes = await apiFetch(`${API}/api/cinemas`);
  const cinemaList: any[] = Array.isArray(cinemasRes) ? cinemasRes : cinemasRes?.data ?? [];
  console.log(`  ${cinemaList.length} cines en /api/cinemas`);

  if (cinemaList[0]) console.log(`  Cinema[0] keys: ${Object.keys(cinemaList[0]).join(', ')}`);

  const cinemaMap: Record<string, { name: string; citySlug: string; address: string }> = {};
  for (const c of cinemaList) {
    const id = String(c.id ?? c._id ?? c.score_id ?? '');
    const name = c.nombre_completo ?? c.nombre ?? c.name ?? '';
    const rawCity = c.ciudad ?? c.city ?? c.ciudad_nombre ?? c.complemento ?? '';
    const citySlug = citySlugFromText(rawCity);
    const address = c.direccion ?? c.address ?? '';
    if (id && name) cinemaMap[id] = { name, citySlug, address };
  }
  console.log(`  ${Object.keys(cinemaMap).length} cines mapeados`);

  // ── Step 2: Movie list from /api/site ────────────────────────────────────
  const siteData = await apiFetch(`${API}/api/site`);
  const siteMovies: any[] = siteData?.movies_active ?? siteData?.movies ?? [];
  console.log(`  ${siteMovies.length} películas en /api/site`);
  if (siteMovies[0]) console.log(`  Movie[0] keys: ${Object.keys(siteMovies[0]).join(', ')}`);

  // ── Step 3: Try cartelera endpoints ──────────────────────────────────────
  let cartelaMovies: any[] = [];
  const cartelaEndpoints = [
    `${API}/api/contents/cartelera`,
    `${API}/api/cartelera`,
    `${API}/api/movies`,
    `${API}/api/contents/movies`,
  ];
  for (const ep of cartelaEndpoints) {
    const data = await apiFetch(ep);
    const list: any[] = Array.isArray(data) ? data : data?.data ?? data?.movies ?? data?.films ?? data?.contents ?? [];
    if (list.length > 0) {
      console.log(`  ✅ ${list.length} películas en ${ep}`);
      cartelaMovies = list;
      break;
    }
  }

  const allMovies = cartelaMovies.length > 0 ? cartelaMovies : siteMovies;

  // ── Step 4: Per-movie funciones ───────────────────────────────────────────
  let firstFuncionesLogged = false;
  for (const m of allMovies) {
    const title = cleanTitle(m.titulo ?? m.title ?? m.nombre ?? m.name ?? '');
    if (!title) continue;
    const slug = m.slug ?? slugify(title);
    const movieId = m.id ?? m._id ?? m.movie_id;

    const { data: movie } = await supabase.from('movies').upsert({
      slug, title,
      poster_url: m.imagen ?? m.image ?? m.poster_url ?? m.poster ?? null,
      description: m.sinopsis ?? m.synopsis ?? m.description ?? null,
      duration_minutes: parseInt(String(m.duracion ?? m.duration ?? '0')) || null,
      rating: m.clasificacion ?? m.rating ?? null,
      genres: (m.generos ?? m.genres ?? []).map((g: any) => g?.nombre ?? g?.name ?? g ?? ''),
    }, { onConflict: 'slug' }).select('id').single();

    if (!movie || !movieId) continue;

    // Try all known funciones endpoint patterns
    const funcEndpoints = [
      `${API}/api/contents/funciones/${movieId}`,
      `${API}/api/contents/funciones/${slug}`,
      `${API}/api/funciones/${movieId}`,
      `${API}/api/movies/${movieId}/funciones`,
      `${API}/api/movies/${movieId}/showtimes`,
      `${API}/api/site/funciones/${movieId}`,
    ];

    let funciones: any[] = [];
    for (const ep of funcEndpoints) {
      const data = await apiFetch(ep);
      if (!data) continue;
      const list: any[] = Array.isArray(data) ? data
        : data?.data ?? data?.funciones ?? data?.functions ?? data?.showtimes ?? [];
      if (list.length > 0) {
        if (!firstFuncionesLogged) {
          firstFuncionesLogged = true;
          console.log(`  ✅ Funciones endpoint: ${ep}`);
          console.log(`  Funcion[0] keys: ${Object.keys(list[0]).join(', ')}`);
          console.log(`  Funcion[0] preview: ${JSON.stringify(list[0]).substring(0, 400)}`);
        }
        funciones = list;
        break;
      }
    }

    if (funciones.length === 0) {
      // Try showings embedded in the movie object from /api/site
      funciones = m.funciones ?? m.functions ?? m.showings ?? m.horarios ?? [];
    }

    console.log(`  🎥 ${title}: ${funciones.length} funciones`);

    for (const f of funciones) {
      await processProcinalFuncion(f, movie.id, cinemaMap);
    }
  }

  // ── Step 5: Try per-cinema endpoint ──────────────────────────────────────
  if (!firstFuncionesLogged) {
    console.log('  ⚠️  Ningún endpoint de funciones funcionó. Intentando por cinema...');
    for (const [cinemaId] of Object.entries(cinemaMap)) {
      const data = await apiFetch(`${API}/api/cinemas/${cinemaId}/funciones`);
      if (!data) continue;
      const list: any[] = Array.isArray(data) ? data : data?.data ?? data?.funciones ?? [];
      if (list.length > 0) {
        console.log(`  ✅ Funciones por cinema: /api/cinemas/${cinemaId}/funciones → ${list.length} funciones`);
        console.log(`  Funcion[0] keys: ${Object.keys(list[0]).join(', ')}`);
        console.log(`  Funcion[0] preview: ${JSON.stringify(list[0]).substring(0, 400)}`);
        break;
      }
    }
  }

  console.log('✅ Procinal Scraper finalizado.');
}

async function processProcinalFuncion(
  f: any,
  movieDbId: number,
  cinemaMap: Record<string, { name: string; citySlug: string; address: string }>,
) {
  const cinemaRef = String(f.cine_id ?? f.cinema_id ?? f.cinemaId ?? f.complejo_id ?? f.sede_id ?? '');
  let cinemaName: string = f.cine ?? f.cine_nombre ?? f.cinema?.nombre ?? f.cinema_nombre ?? cinemaMap[cinemaRef]?.name ?? '';
  const rawCity: string = f.ciudad ?? f.city ?? cinemaMap[cinemaRef]?.citySlug ?? '';
  const citySlug = rawCity ? citySlugFromText(rawCity) : 'bogota';
  const address: string = cinemaMap[cinemaRef]?.address ?? '';

  if (!cinemaName && cinemaRef && cinemaMap[cinemaRef]) cinemaName = cinemaMap[cinemaRef].name;
  if (!cinemaName) return;

  const cityId = await getOrCreateCity(citySlug);
  if (!cityId) return;
  const cinemaId = await getOrCreateCinema(cinemaName, cityId, address);
  if (!cinemaId) return;

  const rawTime: string = f.hora ?? f.time ?? f.horario ?? f.start_time ?? f.datetime ?? f.fecha_hora ?? '';
  if (!rawTime) return;

  const startTime = /^\d{1,2}:\d{2}$/.test(rawTime)
    ? `${today}T${rawTime.padStart(5, '0')}:00` : rawTime;

  await supabase.from('screenings').upsert({
    movie_id: movieDbId, cinema_id: cinemaId, start_time: startTime,
    format: normalizeFormat(f.sala ?? f.format ?? f.formato ?? f.tipo ?? '2D'),
    language: normalizeLanguage(f.idioma ?? f.language ?? f.tipo_idioma ?? 'subtitulada'),
    buy_url: f.url_compra ?? f.buy_url ?? null,
  }, { onConflict: 'movie_id,cinema_id,start_time' });
}
