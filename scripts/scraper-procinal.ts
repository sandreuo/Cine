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

async function getOrCreateCity(slug: string, name?: string): Promise<number | null> {
  const { data } = await supabase.from('cities').select('id').eq('slug', slug).single();
  if (data) return data.id;
  const cityName = name ?? slug.charAt(0).toUpperCase() + slug.slice(1);
  const { data: created, error } = await supabase
    .from('cities').insert({ slug, name: cityName }).select('id').single();
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

const CITY_NAME_MAP: Record<string, string> = {
  bogota: 'Bogotá',
  medellin: 'Medellín',
  cali: 'Cali',
  barranquilla: 'Barranquilla',
  bucaramanga: 'Bucaramanga',
  cartagena: 'Cartagena',
  pereira: 'Pereira',
  manizales: 'Manizales',
  cucuta: 'Cúcuta',
};

export async function scrapeProcinal() {
  console.log('🎬 Iniciando scraper de Procinal Colombia (API directa)...');

  const today = new Date().toISOString().split('T')[0];

  try {
    // Hit Procinal's real API endpoints discovered from network interception
    const [cartelera, cinemas] = await Promise.all([
      fetch('https://apinew.procinal.com.co/api/contents/cartelera').then(r => r.json()).catch(() => null),
      fetch('https://apinew.procinal.com.co/api/cinemas').then(r => r.json()).catch(() => null),
    ]);

    console.log(`  Cartelera: ${cartelera ? JSON.stringify(cartelera).substring(0, 200) : 'null'}`);
    console.log(`  Cinemas: ${cinemas ? JSON.stringify(cinemas).substring(0, 200) : 'null'}`);

    // Build cinema lookup: id → { name, city }
    const cinemaMap: Record<string, { name: string; city: string }> = {};
    const cinemaList: any[] = Array.isArray(cinemas) ? cinemas : cinemas?.data ?? cinemas?.cinemas ?? [];
    for (const c of cinemaList) {
      const id = c.id ?? c._id ?? c.cinema_id;
      const name = c.name ?? c.nombre ?? c.cinema_name ?? '';
      const city = (c.city ?? c.ciudad ?? c.city_name ?? '').toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '');
      if (id && name) cinemaMap[String(id)] = { name, city };
    }
    console.log(`  ${Object.keys(cinemaMap).length} cines en mapa`);

    // Parse cartelera
    const movies: any[] = Array.isArray(cartelera)
      ? cartelera
      : cartelera?.data ?? cartelera?.movies ?? cartelera?.films ?? cartelera?.contents ?? [];

    console.log(`  ${movies.length} películas en cartelera`);

    for (const m of movies) {
      const title: string = m.title ?? m.titulo ?? m.name ?? m.nombre ?? '';
      if (!title) continue;
      const slug = m.slug ?? slugify(title);

      const { data: movie, error: movieErr } = await supabase.from('movies').upsert(
        {
          slug, title,
          poster_url: m.poster_url ?? m.poster ?? m.image ?? m.imagen ?? null,
          description: m.synopsis ?? m.description ?? m.sinopsis ?? null,
          duration_minutes: parseInt(m.duration ?? m.duracion ?? '0') || null,
          rating: m.rating ?? m.clasificacion ?? null,
          genres: (m.genres ?? m.generos ?? m.categories ?? []).map((g: any) => g?.name ?? g?.nombre ?? g ?? ''),
        },
        { onConflict: 'slug' }
      ).select('id').single();

      if (movieErr || !movie) { console.error(`  Error guardando ${title}:`, movieErr?.message); continue; }

      // Showtimes: may be nested in the movie or as separate functions/showings
      const showings: any[] =
        m.showings ?? m.functions ?? m.screenings ?? m.showtimes ??
        m.horarios ?? m.schedules ?? m.sessions ?? [];

      for (const showing of showings) {
        // Cinema reference
        const cinemaRef = showing.cinema_id ?? showing.cinemaId ?? showing.cinema?.id;
        const cinemaName: string = showing.cinema?.name ?? showing.cinema?.nombre ??
          showing.cinema_name ?? cinemaMap[String(cinemaRef)]?.name ?? '';
        if (!cinemaName) continue;

        // City from cinema map or showing
        const rawCity: string = showing.city ?? showing.ciudad ?? cinemaMap[String(cinemaRef)]?.city ?? '';
        const citySlug = Object.keys(CITY_NAME_MAP).find(k =>
          rawCity.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').includes(k)
        ) ?? 'bogota';

        const cityId = await getOrCreateCity(citySlug, CITY_NAME_MAP[citySlug]);
        if (!cityId) continue;
        const cinemaId = await getOrCreateCinema(cinemaName, cityId, showing.cinema?.address);
        if (!cinemaId) continue;

        const schedules: any[] =
          showing.schedules ?? showing.horarios ?? showing.sessions ??
          (showing.time ?? showing.hora ? [showing] : []);

        for (const sched of schedules) {
          const rawTime: string = sched.time ?? sched.hora ?? sched.start_time ?? sched.datetime ?? '';
          if (!rawTime) continue;
          const startTime = /^\d{1,2}:\d{2}$/.test(rawTime)
            ? `${today}T${rawTime.padStart(5, '0')}:00`
            : rawTime;

          await supabase.from('screenings').upsert(
            {
              movie_id: movie.id, cinema_id: cinemaId, start_time: startTime,
              format: sched.format ?? sched.formato ?? sched.sala ?? '2D',
              language: sched.language ?? sched.idioma ?? 'subtitulada',
              buy_url: sched.buy_url ?? sched.url ?? null,
            },
            { onConflict: 'movie_id,cinema_id,start_time' }
          );
        }
      }
    }

    // Also fetch cinemas list with their own city/showtime data if cartelera didn't have it
    if (movies.length === 0) {
      console.log('  Cartelera vacía, intentando endpoint alternativo...');
      const alt = await fetch('https://apinew.procinal.com.co/api/site').then(r => r.json()).catch(() => null);
      console.log(`  Site API: ${alt ? JSON.stringify(alt).substring(0, 300) : 'null'}`);
    }

  } catch (err) {
    console.error('❌ Error fatal en Procinal Scraper:', err);
  }

  console.log('✅ Procinal Scraper finalizado.');
}
