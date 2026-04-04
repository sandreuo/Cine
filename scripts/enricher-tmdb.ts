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
  url.searchParams.set('language', 'es-419');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`TMDB ${res.status}: ${url}`);
  return res.json();
}

async function enrichMovie(id: number, title: string): Promise<number | null> {
  const search = await tmdbFetch('/search/movie', { query: title, region: 'CO' });
  const result = search.results?.[0];
  if (!result) {
    console.log(`   ⚠️  No encontrada en TMDB: ${title}`);
    return null;
  }

  const tmdbId: number = result.id;
  const details = await tmdbFetch(`/movie/${tmdbId}`, { append_to_response: 'videos,release_dates' });

  const poster = details.poster_path ? `${POSTER_BASE}${details.poster_path}` : null;
  const description: string = details.overview || null;
  const duration: number | null = details.runtime || null;
  const genres: string[] = details.genres?.map((g: any) => g.name) ?? [];
  
  // Prioritize Colombia (CO) release date
  const releaseResults = details.release_dates?.results ?? [];
  const coRelease = releaseResults.find((r: any) => r.iso_3166_1 === 'CO');
  // Type 3 is Theatrical release, try to find it first, otherwise any CO release
  const coDate = coRelease?.release_dates?.find((d: any) => d.type === 3)?.release_date 
    ?? coRelease?.release_dates?.[0]?.release_date;
    
  const release_date: string | null = coDate ? coDate.split('T')[0] : (details.release_date || null);

  const videos: any[] = details.videos?.results ?? [];
  const trailer =
    videos.find((v: any) => v.type === 'Trailer' && v.site === 'YouTube' && v.iso_639_1 === 'es') ??
    videos.find((v: any) => v.type === 'Trailer' && v.site === 'YouTube') ??
    videos.find((v: any) => v.site === 'YouTube');
  const trailerId: string | null = trailer?.key ?? null;

  const { error } = await supabase.from('movies').update({
    tmdb_id: tmdbId,
    poster_url: poster,
    description,
    duration_minutes: duration,
    genres,
    trailer_youtube_id: trailerId,
    release_date,
  }).eq('id', id);

  if (error) {
    console.error(`   ❌ Error actualizando ${title}:`, error.message);
    return null;
  }

  console.log(`   ✅ ${title} (tmdb:${tmdbId}) — poster: ${poster ? '✓' : '✗'}, trailer: ${trailerId ? '✓' : '✗'}`);
  return tmdbId;
}

// Merge duplicate movies that share the same tmdb_id.
// Keeps the one with the lowest id, reassigns screenings, deletes duplicates.
async function deduplicateByTmdbId() {
  console.log('\n🔍 Deduplicando por TMDB ID...');

  const { data: all } = await supabase
    .from('movies')
    .select('id, title, tmdb_id')
    .not('tmdb_id', 'is', null)
    .order('id', { ascending: true });

  if (!all || all.length === 0) {
    console.log('   Nada que deduplicar.');
    return;
  }

  // Group by tmdb_id
  const groups: Record<number, typeof all> = {};
  for (const m of all) {
    const tid = m.tmdb_id as number;
    groups[tid] ??= [];
    groups[tid].push(m);
  }

  let merged = 0;
  for (const [tmdbId, movies] of Object.entries(groups)) {
    if (movies.length <= 1) continue;

    // Keep lowest id (first scraper to find it), merge rest into it
    const [canonical, ...duplicates] = movies;
    console.log(`   🔗 tmdb:${tmdbId} — manteniendo "${canonical.title}" (id:${canonical.id}), eliminando ${duplicates.length} duplicado(s):`);

    for (const dup of duplicates) {
      console.log(`      - "${dup.title}" (id:${dup.id})`);

      // Reassign screenings
      const { error: scErr } = await supabase
        .from('screenings')
        .update({ movie_id: canonical.id })
        .eq('movie_id', dup.id);

      if (scErr) {
        console.error(`      ❌ Error reasignando screenings de ${dup.id}:`, scErr.message);
        continue;
      }

      // Delete duplicate movie
      const { error: delErr } = await supabase
        .from('movies')
        .delete()
        .eq('id', dup.id);

      if (delErr) {
        console.error(`      ❌ Error eliminando película ${dup.id}:`, delErr.message);
      } else {
        merged++;
      }
    }
  }

  console.log(`   ✅ ${merged} duplicado(s) eliminado(s).`);
}

export async function enrichWithTMDB() {
  console.log('\n🎬 Enriqueciendo películas con TMDB...');

  const { data: movies, error } = await supabase
    .from('movies')
    .select('id, title, tmdb_id, release_date');

  if (error || !movies) {
    console.error('❌ Error leyendo películas:', error?.message);
    return;
  }

  console.log(`   ${movies.length} películas para enriquecer`);

  for (const movie of movies) {
    // Skip only if already has tmdb_id AND release_date
    if ((movie as any).tmdb_id && (movie as any).release_date) {
      console.log(`   ⏭️  ${movie.title} — ya está enriquecido, saltando`);
      continue;
    }
    try {
      await enrichMovie(movie.id, movie.title);
      await new Promise((r) => setTimeout(r, 300));
    } catch (err) {
      console.error(`   ❌ Error TMDB "${movie.title}":`, err);
    }
  }

  // Deduplicate after enrichment
  await deduplicateByTmdbId();

  console.log('✅ Enriquecimiento TMDB finalizado.');
}
