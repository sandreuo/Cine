/**
 * One-time fix: clean up bad CineColombia data saved as [object Object]
 * Run: npx tsx scripts/fix-cinecolombia-data.ts
 */
import { supabaseAdmin as supabase } from '../lib/supabase-admin';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(process.cwd(), '.env.local') });

async function main() {
  console.log('🔧 Limpiando datos incorrectos de CineColombia...');

  // 1. Delete movies with [object Object] title or object-object slug
  const { data: badMovies } = await supabase
    .from('movies')
    .select('id, title, slug')
    .or('title.eq.[object Object],slug.eq.object-object,title.ilike.%[object%');

  console.log(`   🎬 ${badMovies?.length ?? 0} películas con título inválido`);
  for (const m of badMovies ?? []) {
    console.log(`      - "${m.title}" (slug: ${m.slug}, id: ${m.id})`);
    await supabase.from('screenings').delete().eq('movie_id', m.id);
    await supabase.from('movies').delete().eq('id', m.id);
  }

  // 2. Fix cinema names saved as JSON strings: {"text":"ANDINO","translations":[]}
  const { data: badCinemas } = await supabase
    .from('cinemas')
    .select('id, name')
    .like('name', '{%"text"%');

  console.log(`   🏛️  ${badCinemas?.length ?? 0} cines con nombre en formato JSON`);
  for (const c of badCinemas ?? []) {
    try {
      const parsed = JSON.parse(c.name);
      const realName: string = parsed.text ?? parsed.Text ?? c.name;
      if (realName && realName !== c.name) {
        await supabase.from('cinemas').update({ name: realName }).eq('id', c.id);
        console.log(`      ✅ "${c.name}" → "${realName}"`);
      }
    } catch {
      console.log(`      ⚠️  No se pudo parsear: ${c.name}`);
    }
  }

  // 3. Also fix cinemas named literally [object Object]
  const { data: objCinemas } = await supabase
    .from('cinemas')
    .select('id, name')
    .like('name', '%object Object%');

  for (const c of objCinemas ?? []) {
    await supabase.from('screenings').delete().eq('cinema_id', c.id);
    await supabase.from('cinemas').delete().eq('id', c.id);
    console.log(`      🗑️  Eliminado cine inválido: "${c.name}"`);
  }

  console.log('✅ Limpieza completada.');
}

main().catch(console.error);
