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

const GARBAGE_PATTERNS = [
  /^(top[\s-]+)?banner/i, /^horario[\s-]+apertura/i, /\bmembership\b/i,
  /\bactivated\b/i, /\bworld[\s-]+tour\b/i, /\blive[\s-]+viewing\b/i,
  /arirang/i, /^bts\b/i, /^standar(d)?$/i, /^cine[\s-]club/i,
  /^todas las pel/i, /^disponibles?$/i,
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

// Map of our city slugs to Procinal internal IDs
const PROCINAL_CITIES: Record<string, number> = {
  'soacha': 4,
  'cartagena': 2,
  'bogota': 1,
  'medellin': 5,
  'villavicencio': 3,
  'barrancabermeja': 6
};

// Map of city slug to display name
const CITY_NAMES: Record<string, string> = {
  'bogota': 'Bogotá', 'medellin': 'Medellín', 'cali': 'Cali',
  'barranquilla': 'Barranquilla', 'bucaramanga': 'Bucaramanga',
  'cartagena': 'Cartagena', 'pereira': 'Pereira', 'manizales': 'Manizales',
  'villavicencio': 'Villavicencio', 'barrancabermeja': 'Barrancabermeja',
  'soacha': 'Soacha'
};

async function apiFetch(url: string): Promise<any | null> {
  try {
    const res = await fetch(url, { headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' } });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function getOrCreateCity(slug: string): Promise<number | null> {
  const { data } = await supabase.from('cities').select('id').eq('slug', slug).single();
  if (data) return data.id;
  const name = CITY_NAMES[slug] ?? slug.charAt(0).toUpperCase() + slug.slice(1);
  const { data: c, error } = await supabase.from('cities').insert({ slug, name }).select('id').single();
  if (error) { console.error(`Error ciudad ${slug}:`, error.message); return null; }
  return c?.id ?? null;
}

async function getOrCreateCinema(name: string, cityId: number, address?: string): Promise<number | null> {
  const { data } = await supabase.from('cinemas').select('id').eq('name', name).eq('city_id', cityId).single();
  if (data) return data.id;
  const { data: c, error } = await supabase.from('cinemas')
    .insert({ name, city_id: cityId, chain: 'procinal', address: address ?? null })
    .select('id').single();
  if (error) { console.error(`Error cine ${name}:`, error.message); return null; }
  return c?.id ?? null;
}

export async function scrapeProcinal() {
  console.log('🎬 Iniciando scraper de Procinal Colombia (API 100% Reescrita)...');

  // 1. Map cinemas to internal IDs to know their names/locations
  const cinemasRes = await apiFetch(`${API}/api/cinemas`);
  const cinemaList: any[] = Array.isArray(cinemasRes) ? cinemasRes : cinemasRes?.data ?? [];
  const cinemaInfoMap: Record<number, { name: string; address: string }> = {};
  for (const c of cinemaList) {
    if (c.id && c.nombre) {
      cinemaInfoMap[c.id] = { name: c.nombre_completo ?? c.nombre, address: c.direccion ?? '' };
    }
  }

  // 2. Scrape each supported city
  for (const [citySlug, procinalCityId] of Object.entries(PROCINAL_CITIES)) {
    console.log(`   📍 ${citySlug}`);
    const cityId = await getOrCreateCity(citySlug);
    if (!cityId) continue;

    const data = await apiFetch(`${API}/api/movies?city=${procinalCityId}`);
    const movies: any[] = data?.movies ?? [];
    console.log(`      ${movies.length} películas encontradas`);

    for (const m of movies) {
      const title = cleanTitle(m.titulo ?? m.title ?? '');
      if (!isValidMovieTitle(title)) continue;

      const slug = m.slug ?? slugify(title);
      const { data: dbMovie } = await supabase.from('movies').upsert({
        slug, title,
        poster_url: m.imagen ?? m.poster ?? null,
        description: m.sinopsis ?? m.description ?? null,
        duration_minutes: parseInt(String(m.duracion ?? '0')) || null,
        rating: m.clasificacion ?? null,
        genres: (m.generos ?? []).map((g: any) => g?.nombre ?? g ?? ''),
      }, { onConflict: 'slug' }).select('id').single();

      if (!dbMovie) continue;

      let totalFunctions = 0;
      for (const room of m.rooms ?? []) {
        const procinalCinemaId = room.cinema_id;
        const info = cinemaInfoMap[procinalCinemaId];
        if (!info) continue;

        const cinemaId = await getOrCreateCinema(info.name, cityId, info.address);
        if (!cinemaId) continue;

        for (const showtime of room.showtimes_list ?? []) {
          const date = showtime.fecha_funcion; // YYYY-MM-DD
          const time = showtime.hora_funcion;  // HH:MM:SS
          if (!date || !time) continue;

          const startTime = `${date}T${time}`;

          await supabase.from('screenings').upsert({
            movie_id: dbMovie.id,
            cinema_id: cinemaId,
            start_time: startTime,
            format: normalizeFormat(showtime.tipo_sala ?? '2D'),
            language: normalizeLanguage(showtime.tipo_idioma ?? 'subtitulada'),
            buy_url: showtime.link_bi ?? null,
          }, { onConflict: 'movie_id,cinema_id,start_time' });
          totalFunctions++;
        }
      }
      if (totalFunctions > 0) console.log(`      🎥 ${title}: ${totalFunctions} funciones`);
    }
  }

  console.log('✅ Procinal Scraper finalizado con éxito (API 100%).');
}

async function processProcinalFuncion() {
  // Logic merged into scrapeProcinal
}
