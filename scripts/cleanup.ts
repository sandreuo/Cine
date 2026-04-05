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

  // 2. Identify movies with no future screenings
  // We do this by getting all movie IDs that HAVE future screenings and then deleting the rest
  const { data: activeMovies } = await supabase
    .from('screenings')
    .select('movie_id');
  
  const activeIds = Array.from(new Set((activeMovies || []).map(s => s.movie_id)));
  
  // Delete movies not in activeIds and NOT in a "presale/upcoming" status 
  // (though currently we identify them by them having no screenings)
  const { count: mCount, error: mErr } = await supabase
    .from('movies')
    .delete({ count: 'exact' })
    .not('id', 'in', `(${activeIds.join(',')})`);

  if (mErr) {
    // If activeIds is empty, the 'in' clause might fail. Handle that.
    if (activeIds.length === 0) {
       const { count: allCount } = await supabase.from('movies').delete({ count: 'exact' });
       console.log(`   ✅ ${allCount ?? 0} películas sin funciones eliminadas (limpieza total).`);
    } else {
       console.error('❌ Error limpiando películas:', mErr.message);
    }
  } else {
    console.log(`   ✅ ${mCount ?? 0} películas sin funciones eliminadas.`);
  }

  console.log('✨ Limpieza completada.');
}

cleanup().catch(console.error);
