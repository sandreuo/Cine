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

// Titles that are clearly not movies (UI/CMS garbage from scrapers)
const GARBAGE_PATTERNS = [
  /^(top[\s-]+)?banner/i,
  /^horario[\s-]+apertura/i,
  /\bmembership\b/i,
  /\bactivated\b/i,
  /\bworld[\s-]+tour\b/i,
  /\blive[\s-]+viewing\b/i,
  /arirang/i,
  /^bts\b/i,
  /^standar(d)?$/i,
  /^cine[\s-]club/i,
];

function isGarbageTitle(title: string): boolean {
  return GARBAGE_PATTERNS.some(p => p.test(title.trim()));
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

async function searchTMDB(query: string, region?: string): Promise<any | null> {
  if (!query || query.trim().length < 2) return null;
  const params: Record<string, string> = { query: query.trim() };
  if (region) params.region = region;
  const search = await tmdbFetch('/search/movie', params);
  return search.results?.[0] ?? null;
}

// Spanish title → English/original title for known hard cases
const TITLE_OVERRIDES: Record<string, string> = {
  'goat: como cabras': 'goat',
  'como cabras': 'goat',
  'hoppers: operacion castor': 'hoppers',
  'esa cosa con alas': 'that thing with feathers',
  'noche de miedo': 'fear street',
  'proyecto fin del mundo': 'project hail mary',
  'project hail mary': 'project hail mary',
};

// Multiple search strategies to maximize TMDB hit rate
async function findOnTMDB(title: string, slug: string): Promise<any | null> {
  const titleLower = title.toLowerCase().trim();

  // Build candidate queries in priority order
  const candidates: string[] = [title];

  // Without leading Spanish articles
  const noArticle = title.replace(/^(El|La|Los|Las|Un|Una|The|A)\s+/i, '').trim();
  if (noArticle && noArticle !== title) candidates.push(noArticle);

  // Slug as words — sometimes the slug is closer to original English title
  if (slug) {
    const fromSlug = slug.replace(/-/g, ' ').replace(/^reestreno\s*/i, '').trim();
    if (fromSlug && fromSlug !== titleLower) candidates.push(fromSlug);
  }

  // Strip subtitle after colon (broad match)
  const noSubtitle = title.replace(/\s*:.*$/, '').trim();
  if (noSubtitle && noSubtitle !== title && noSubtitle.length >= 3) candidates.push(noSubtitle);

  // Strip "REESTRENO" prefix if present
  const noReestreno = title.replace(/^REESTRENO\s*[-–]?\s*/i, '').trim();
  if (noReestreno !== title) candidates.push(noReestreno);

  // Known overrides
  const override = TITLE_OVERRIDES[titleLower];
  if (override) candidates.unshift(override); // try first

  // Uppercase acronym as-is (e.g. "GOAT", "F1")
  if (/^[A-Z0-9.]{2,8}$/.test(title.trim())) candidates.push(title.trim());

  // Deduplicate
  const unique = Array.from(new Set(candidates));

  for (const query of unique) {
    // Try with Colombia region first (gets Colombian release dates), then global
    let result = await searchTMDB(query, 'CO');
    if (!result) {
      await new Promise(r => setTimeout(r, 150));
      result = await searchTMDB(query);
    }
    if (result) return result;
    await new Promise(r => setTimeout(r, 150));
  }

  return null;
}

async function enrichMovie(id: number, title: string, slug: string): Promise<number | null> {
  const result = await findOnTMDB(title, slug);

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

  // Prefer Colombia theatrical release date, fall back to global
  const releaseResults: any[] = details.release_dates?.results ?? [];
  const coRelease = releaseResults.find((r: any) => r.iso_3166_1 === 'CO');
  const coDate =
    coRelease?.release_dates?.find((d: any) => d.type === 3)?.release_date ??
    coRelease?.release_dates?.[0]?.release_date;
  const release_date: string | null = coDate
    ? coDate.split('T')[0]
    : (details.release_date || null);

  // Check if this is an upcoming movie
  const today = new Date().toISOString().split('T')[0];
  const isUpcoming = release_date && release_date > today;

  const videos: any[] = details.videos?.results ?? [];
  // Trailer priority: Spanish Latin (es-419), then Spanish, then any Trailer, then any Teaser, then any YouTube
  const trailer =
    videos.find((v: any) => v.type === 'Trailer' && v.site === 'YouTube' && v.iso_639_1 === 'es' && v.iso_3166_1 === '419') ??
    videos.find((v: any) => v.type === 'Trailer' && v.site === 'YouTube' && v.iso_639_1 === 'es') ??
    videos.find((v: any) => v.type === 'Trailer' && v.site === 'YouTube') ??
    videos.find((v: any) => v.type === 'Teaser' && v.site === 'YouTube' && v.iso_639_1 === 'es') ??
    videos.find((v: any) => v.type === 'Teaser' && v.site === 'YouTube') ??
    videos.find((v: any) => v.site === 'YouTube');
  const trailerId: string | null = trailer?.key ?? null;

  // Use TMDB's canonical title in Spanish (details.title is in the requested language es-419)
  const tmdbTitle: string = details.title ?? title;

  // Build update object — only overwrite poster/trailer/description if TMDB actually has them
  // (avoids nuking the scraper's data when TMDB is missing assets)
  const updateData: Record<string, any> = {
    tmdb_id: tmdbId,
    title: tmdbTitle,
    release_date,
  };
  if (poster) updateData.poster_url = poster;
  if (description) updateData.description = description;
  if (duration) updateData.duration_minutes = duration;
  if (genres.length > 0) updateData.genres = genres;
  if (trailerId) updateData.trailer_youtube_id = trailerId;

  const { error } = await supabase.from('movies').update(updateData).eq('id', id);

  if (error) {
    console.error(`   ❌ Error actualizando ${title}:`, error.message);
    return null;
  }

  const flags = [
    poster ? '🖼️ poster' : '✗poster(kept scraper)',
    trailerId ? '🎬 trailer' : '✗trailer(kept scraper)',
    isUpcoming ? `📅 estreno ${release_date}` : '',
  ].filter(Boolean).join(' · ');

  const titleChanged = tmdbTitle !== title ? ` → "${tmdbTitle}"` : '';
  console.log(`   ✅ ${title}${titleChanged} (tmdb:${tmdbId}) — ${flags}`);
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

  const groups: Record<number, typeof all> = {};
  for (const m of all) {
    const tid = m.tmdb_id as number;
    groups[tid] ??= [];
    groups[tid].push(m);
  }

  let merged = 0;
  for (const [tmdbId, movies] of Object.entries(groups)) {
    if (movies.length <= 1) continue;

    const [canonical, ...duplicates] = movies;
    console.log(`   🔗 tmdb:${tmdbId} — manteniendo "${canonical.title}" (id:${canonical.id}), eliminando ${duplicates.length} duplicado(s):`);

    for (const dup of duplicates) {
      console.log(`      - "${dup.title}" (id:${dup.id})`);

      // Reassign screenings one by one to handle conflicts
      const { data: dupScreenings } = await supabase.from('screenings').select('id, cinema_id, start_time').eq('movie_id', dup.id);
      if (dupScreenings) {
        for (const s of dupScreenings) {
          const { error: updErr } = await supabase
            .from('screenings')
            .update({ movie_id: canonical.id })
            .eq('id', s.id);
          
          if (updErr && updErr.code === '23505') { // Unique violation
            // Screening already exists for canonical, so just delete this duplicate
            await supabase.from('screenings').delete().eq('id', s.id);
          }
        }
      }

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

// Only remove movies that are confirmed garbage (UI/CMS noise from scrapers).
// We do NOT remove valid-looking titles just because TMDB couldn't match them —
// they may be Colombian exclusives, upcoming films, or title mismatches.
async function removeGarbageMovies() {
  console.log('\n🧹 Eliminando entradas basura...');

  const { data: all } = await supabase
    .from('movies')
    .select('id, title, tmdb_id')
    .is('tmdb_id', null);

  let deleted = 0;
  for (const m of all ?? []) {
    if (!isGarbageTitle(m.title)) continue;

    // Double-check: also verify no screenings (safety net)
    const { count } = await supabase
      .from('screenings')
      .select('id', { count: 'exact', head: true })
      .eq('movie_id', m.id);

    if ((count ?? 0) > 0) {
      console.log(`   ⚠️  "${m.title}" tiene ${count} función(es), no se elimina`);
      continue;
    }

    const { error } = await supabase.from('movies').delete().eq('id', m.id);
    if (!error) {
      console.log(`   🗑️  "${m.title}" (id:${m.id}) — eliminada (basura)`);
      deleted++;
    }
  }
  console.log(`   ✅ ${deleted} entrada(s) basura eliminada(s).`);
}

export async function enrichWithTMDB() {
  console.log('\n🎬 Enriqueciendo películas con TMDB...');

  const { data: movies, error } = await supabase
    .from('movies')
    .select('id, title, slug, tmdb_id, release_date, poster_url, trailer_youtube_id');

  if (error || !movies) {
    console.error('❌ Error leyendo películas:', error?.message);
    return;
  }

  console.log(`   ${movies.length} películas en base de datos`);

  for (const movie of movies) {
    const m = movie as any;
    // Skip only if fully enriched: tmdb_id + release_date + poster + trailer
    if (m.tmdb_id && m.release_date && m.poster_url && m.trailer_youtube_id) {
      console.log(`   ⏭️  ${movie.title} — ya enriquecida`);
      continue;
    }
    // Skip garbage titles entirely
    if (isGarbageTitle(movie.title)) {
      console.log(`   🚫 "${movie.title}" — título basura, saltando`);
      continue;
    }
    try {
      await enrichMovie(movie.id, movie.title, (movie as any).slug ?? '');
      await new Promise((r) => setTimeout(r, 300));
    } catch (err) {
      console.error(`   ❌ Error TMDB "${movie.title}":`, err);
    }
  }

  await deduplicateByTmdbId();
  await removeGarbageMovies();

  console.log('✅ Enriquecimiento TMDB finalizado.');
}
