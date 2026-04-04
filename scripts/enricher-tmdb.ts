import { supabaseAdmin as supabase } from '../lib/supabase-admin';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(process.cwd(), '.env.local') });

const TMDB_API_KEY = process.env.TMDB_API_KEY!;
const TMDB_BASE = 'https://api.themoviedb.org/3';
const POSTER_BASE = 'https://image.tmdb.org/t/p/w500';

if (!TMDB_API_KEY) {
  console.error('❌ TMDB_API_KEY no configurada');
  process.exit(1);
}

async function tmdbFetch(endpoint: string, params: Record<string, string> = {}) {
  const url = new URL(`${TMDB_BASE}${endpoint}`);
  url.searchParams.set('api_key', TMDB_API_KEY);
  url.searchParams.set('language', 'es-419'); // Latin American Spanish
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`TMDB ${res.status}: ${url}`);
  return res.json();
}

async function enrichMovie(id: number, title: string) {
  // Search by title
  const search = await tmdbFetch('/search/movie', { query: title, region: 'CO' });
  const result = search.results?.[0];
  if (!result) {
    console.log(`   ⚠️  No encontrada en TMDB: ${title}`);
    return;
  }

  // Get full details + videos in one call
  const details = await tmdbFetch(`/movie/${result.id}`, { append_to_response: 'videos' });

  const poster = details.poster_path ? `${POSTER_BASE}${details.poster_path}` : null;
  const description: string = details.overview || null;
  const duration: number | null = details.runtime || null;
  const genres: string[] = details.genres?.map((g: any) => g.name) ?? [];
  const release_date: string | null = details.release_date || null;

  // Find best YouTube trailer (prefer official, prefer Spanish)
  const videos: any[] = details.videos?.results ?? [];
  const trailer =
    videos.find((v) => v.type === 'Trailer' && v.site === 'YouTube' && v.iso_639_1 === 'es') ??
    videos.find((v) => v.type === 'Trailer' && v.site === 'YouTube') ??
    videos.find((v) => v.site === 'YouTube');
  const trailerId: string | null = trailer?.key ?? null;

  const { error } = await supabase
    .from('movies')
    .update({
      poster_url: poster,
      description,
      duration_minutes: duration,
      genres,
      trailer_youtube_id: trailerId,
      release_date,
    })
    .eq('id', id);

  if (error) {
    console.error(`   ❌ Error actualizando ${title}:`, error.message);
  } else {
    console.log(`   ✅ ${title} — poster: ${poster ? '✓' : '✗'}, trailer: ${trailerId ? '✓' : '✗'}`);
  }
}

export async function enrichWithTMDB() {
  console.log('\n🎬 Enriqueciendo películas con TMDB...');

  const { data: movies, error } = await supabase
    .from('movies')
    .select('id, title');

  if (error || !movies) {
    console.error('❌ Error leyendo películas:', error?.message);
    return;
  }

  console.log(`   ${movies.length} películas para enriquecer`);

  for (const movie of movies) {
    try {
      await enrichMovie(movie.id, movie.title);
      // Small delay to respect TMDB rate limit (40 req/10s)
      await new Promise((r) => setTimeout(r, 300));
    } catch (err) {
      console.error(`   ❌ Error en TMDB para "${movie.title}":`, err);
    }
  }

  console.log('✅ Enriquecimiento TMDB finalizado.');
}
