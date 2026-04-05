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
  cali: 'cali',
  barranquilla: 'barranquilla',
  bucaramanga: 'bucaramanga',
  cartagena: 'cartagena',
  pereira: 'pereira',
  manizales: 'manizales',
  cucuta: 'cucuta', cúcuta: 'cucuta',
  villavicencio: 'villavicencio',
};

const CITY_NAMES: Record<string, string> = {
  bogota: 'Bogotá', medellin: 'Medellín', cali: 'Cali',
  barranquilla: 'Barranquilla', bucaramanga: 'Bucaramanga',
  cartagena: 'Cartagena', pereira: 'Pereira', manizales: 'Manizales',
  cucuta: 'Cúcuta', villavicencio: 'Villavicencio',
};

function citySlugFromText(text: string): string {
  const norm = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  return CITY_SLUG_MAP[norm] ?? norm;
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

export async function scrapeProcinal() {
  console.log('🎬 Iniciando scraper de Procinal Colombia...');

  try {
    // ── STEP 1: Get cinema list (confirmed working from logs) ─────────────
    const cinemasRes = await fetch('https://apinew.procinal.com.co/api/cinemas').then(r => r.json()).catch(() => null);
    const cinemaList: any[] = Array.isArray(cinemasRes) ? cinemasRes : cinemasRes?.data ?? [];
    console.log(`  ${cinemaList.length} cines en /api/cinemas`);

    // Map cinemaId → { name, citySlug, address }
    const cinemaMap: Record<string, { name: string; citySlug: string; address: string }> = {};
    for (const c of cinemaList) {
      const id = String(c.id ?? c._id ?? c.score_id ?? '');
      const name = c.nombre_completo ?? c.nombre ?? c.name ?? '';
      const rawCity = c.ciudad ?? c.city ?? c.ciudad_nombre ?? '';
      const citySlug = citySlugFromText(rawCity);
      const address = c.direccion ?? c.address ?? '';
      if (id && name) cinemaMap[id] = { name, citySlug, address };
    }
    console.log(`  ${Object.keys(cinemaMap).length} cines mapeados`);

    // ── STEP 2: Try primary cartelera endpoint ────────────────────────────
    let movies: any[] = [];

    const cartelera = await fetch('https://apinew.procinal.com.co/api/contents/cartelera')
      .then(r => r.json()).catch(() => null);
    movies = Array.isArray(cartelera) ? cartelera
      : cartelera?.data ?? cartelera?.movies ?? cartelera?.films ?? cartelera?.contents ?? [];

    // ── STEP 3: Fallback to /api/site (confirmed from logs) ───────────────
    if (movies.length === 0) {
      console.log('  Cartelera vacía, usando /api/site...');
      const site = await fetch('https://apinew.procinal.com.co/api/site').then(r => r.json()).catch(() => null);

      // /api/site has: movies_active, cinemas, etc.
      const siteMovies: any[] = site?.movies_active ?? site?.movies ?? [];
      console.log(`  ${siteMovies.length} películas en /api/site`);

      // For each movie in site, fetch its individual functions page
      for (const sm of siteMovies) {
        const movieId = sm.id ?? sm.slug;
        if (!movieId) continue;

        const title = cleanTitle(sm.titulo ?? sm.title ?? sm.nombre ?? '');
        if (!title) continue;
        const slug = sm.slug ?? slugify(title);

        // Upsert movie from site data
        const { data: movie } = await supabase.from('movies').upsert({
          slug, title,
          poster_url: sm.imagen ?? sm.image ?? sm.poster ?? null,
          rating: sm.clasificacion ?? sm.rating ?? null,
        }, { onConflict: 'slug' }).select('id').single();

        if (!movie) continue;

        // Try to fetch functions for this movie
        const funcData = await fetch(`https://apinew.procinal.com.co/api/contents/funciones/${movieId}`)
          .then(r => r.json()).catch(() => null);

        if (!funcData) continue;

        const funcList: any[] = Array.isArray(funcData) ? funcData
          : funcData?.data ?? funcData?.funciones ?? funcData?.functions ?? [];

        console.log(`  🎥 ${title}: ${funcList.length} funciones`);

        for (const f of funcList) {
          await processProcinalFunction(f, movie.id, cinemaMap);
        }
      }
      return;
    }

    // ── STEP 4: Process cartelera movies (primary path) ───────────────────
    console.log(`  ${movies.length} películas en cartelera`);

    for (const m of movies) {
      const title = cleanTitle(m.titulo ?? m.title ?? m.nombre ?? m.name ?? '');
      if (!title) continue;
      const slug = m.slug ?? slugify(title);

      const { data: movie } = await supabase.from('movies').upsert({
        slug, title,
        poster_url: m.imagen ?? m.poster_url ?? m.poster ?? m.image ?? null,
        description: m.sinopsis ?? m.synopsis ?? m.description ?? null,
        duration_minutes: parseInt(String(m.duracion ?? m.duration ?? '0')) || null,
        rating: m.clasificacion ?? m.rating ?? null,
        genres: (m.generos ?? m.genres ?? []).map((g: any) => g?.nombre ?? g?.name ?? g ?? ''),
      }, { onConflict: 'slug' }).select('id').single();

      if (!movie) continue;

      // Showings nested in cartelera item
      const showings: any[] = m.funciones ?? m.functions ?? m.showings ?? m.screenings ??
        m.horarios ?? m.schedules ?? m.sessions ?? [];

      for (const f of showings) {
        await processProcinalFunction(f, movie.id, cinemaMap);
      }
    }

  } catch (err) {
    console.error('❌ Error fatal en Procinal Scraper:', err);
  }

  console.log('✅ Procinal Scraper finalizado.');
}

async function processProcinalFunction(
  f: any,
  movieId: number,
  cinemaMap: Record<string, { name: string; citySlug: string; address: string }>,
) {
  // Resolve cinema
  const cinemaRef = String(f.cine_id ?? f.cinema_id ?? f.cinemaId ?? f.complejo_id ?? '');
  let cinemaName: string = f.cine ?? f.cinema_nombre ?? f.cinema?.nombre ?? cinemaMap[cinemaRef]?.name ?? '';
  const rawCity: string = f.ciudad ?? f.city ?? cinemaMap[cinemaRef]?.citySlug ?? '';
  const citySlug = rawCity ? citySlugFromText(rawCity) : 'bogota';
  const address: string = cinemaMap[cinemaRef]?.address ?? '';

  if (!cinemaName && cinemaRef && cinemaMap[cinemaRef]) {
    cinemaName = cinemaMap[cinemaRef].name;
  }
  if (!cinemaName) return;

  const cityId = await getOrCreateCity(citySlug);
  if (!cityId) return;
  const cinemaId = await getOrCreateCinema(cinemaName, cityId, address);
  if (!cinemaId) return;

  // Time handling
  const rawTime: string = f.hora ?? f.time ?? f.horario ?? f.start_time ?? f.datetime ?? '';
  if (!rawTime) return;
  const startTime = /^\d{1,2}:\d{2}$/.test(rawTime)
    ? `${today}T${rawTime.padStart(5, '0')}:00`
    : rawTime;

  const format = normalizeFormat(f.sala ?? f.format ?? f.formato ?? f.tipo ?? '2D');
  const language = normalizeLanguage(f.idioma ?? f.language ?? f.tipo_idioma ?? 'subtitulada');

  await supabase.from('screenings').upsert({
    movie_id: movieId, cinema_id: cinemaId, start_time: startTime,
    format, language, buy_url: f.url_compra ?? f.buy_url ?? null,
  }, { onConflict: 'movie_id,cinema_id,start_time' });
}
