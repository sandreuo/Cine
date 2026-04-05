/**
 * Cleanup Script: Removes past screenings and orphans movies with no functions.
 */
import { supabaseAdmin as supabase } from '../lib/supabase-admin';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(process.cwd(), '.env.local') });

async function cleanup() {
  console.log('🧹 Iniciando limpieza de base de datos...');
  const today = new Date().toISOString().split('T')[0];
  const now = new Date().toISOString();

  // 1. Delete past screenings
  const { count: sCount, error: sErr } = await supabase
    .from('screenings')
    .delete({ count: 'exact' })
    .lt('start_time', today + 'T00:00:00');

  if (sErr) {
    console.error('❌ Error limpiando screenings:', sErr.message);
  } else {
    console.log(`   ✅ ${sCount ?? 0} funciones pasadas eliminadas.`);
  }

  // 2. Identify movies with no future screenings — paginate to avoid 1000-row Supabase limit
  const activeIds = new Set<number>();
  let from = 0;
  const PAGE = 1000;
  while (true) {
    const { data: page } = await supabase
      .from('screenings')
      .select('movie_id')
      .range(from, from + PAGE - 1);
    if (!page?.length) break;
    page.forEach(s => activeIds.add(s.movie_id));
    if (page.length < PAGE) break;
    from += PAGE;
  }

  if (activeIds.size === 0) {
    console.log('   ⚠️  Sin funciones en DB, omitiendo limpieza de películas.');
  } else {
    const { count: mCount, error: mErr } = await supabase
      .from('movies')
      .delete({ count: 'exact' })
      .not('id', 'in', `(${Array.from(activeIds).join(',')})`);
    if (mErr) {
      console.error('❌ Error limpiando películas:', mErr.message);
    } else {
      console.log(`   ✅ ${mCount ?? 0} películas sin funciones eliminadas.`);
    }
  }

  console.log('✨ Limpieza completada.');
}

cleanup().catch(console.error);
