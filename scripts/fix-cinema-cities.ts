/**
 * One-time fix: corregir city_id de cines CineColombia mal asignados.
 * Los cines en municipios del área metropolitana quedaron en ciudades incorrectas
 * (ej. CHIPICHAPE en bogota en vez de cali).
 *
 * Run: npx tsx scripts/fix-cinema-cities.ts
 */
import { supabaseAdmin as supabase } from '../lib/supabase-admin';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(process.cwd(), '.env.local') });

// Map: parte del nombre del cine → slug de ciudad correcto
const CINEMA_CITY_FIXES: Array<{ nameContains: string; correctCitySlug: string }> = [
  // Cali
  { nameContains: 'CHIPICHAPE', correctCitySlug: 'cali' },
  { nameContains: 'TERRA PLAZA', correctCitySlug: 'cali' },
  { nameContains: 'COSMOCENTRO', correctCitySlug: 'cali' },
  { nameContains: 'UNICALI', correctCitySlug: 'cali' },
  { nameContains: 'UNICO BUEN', correctCitySlug: 'cali' },
  // Medellín
  { nameContains: 'VIVA ENVIGADO', correctCitySlug: 'medellin' },
  { nameContains: 'SANTAFE MEDELLIN', correctCitySlug: 'medellin' },
  { nameContains: 'UNICENTRO MEDELLIN', correctCitySlug: 'medellin' },
  { nameContains: 'VIVA LAURELES', correctCitySlug: 'medellin' },
  { nameContains: 'PREMIUM PLAZA', correctCitySlug: 'medellin' },
  { nameContains: 'OVIEDO', correctCitySlug: 'medellin' },
  { nameContains: 'BELLO', correctCitySlug: 'medellin' },
  // Bucaramanga
  { nameContains: 'CABECERA', correctCitySlug: 'bucaramanga' },
  { nameContains: 'CACIQUE', correctCitySlug: 'bucaramanga' },
  // Cartagena
  { nameContains: 'BOCAGRANDE', correctCitySlug: 'cartagena' },
  { nameContains: 'CARIBE PLAZA', correctCitySlug: 'cartagena' },
  // Armenia
  { nameContains: 'PORTAL DEL QUINDIO', correctCitySlug: 'armenia' },
  { nameContains: 'QUINDIO', correctCitySlug: 'armenia' },
  // Barranquilla
  { nameContains: 'BUENAVISTA', correctCitySlug: 'barranquilla' },
];

async function main() {
  console.log('🔧 Corrigiendo ciudades de cines CineColombia...\n');

  // Cargar mapa slug → id de ciudades
  const { data: allCities } = await supabase.from('cities').select('id, slug, name');
  const cityIdBySlug: Record<string, number> = {};
  for (const c of allCities ?? []) cityIdBySlug[c.slug] = c.id;

  // Cargar todos los cines de cinecolombia con su ciudad actual
  const { data: cinemas } = await supabase
    .from('cinemas')
    .select('id, name, city_id, cities(slug, name)')
    .eq('chain', 'cinecolombia');

  let fixed = 0;
  let skipped = 0;

  for (const cinema of cinemas ?? []) {
    const currentCitySlug = (cinema.cities as any)?.slug ?? '';

    for (const rule of CINEMA_CITY_FIXES) {
      if (cinema.name.toUpperCase().includes(rule.nameContains.toUpperCase())) {
        if (currentCitySlug === rule.correctCitySlug) {
          console.log(`  ✅ Ya correcto: ${cinema.name} → ${rule.correctCitySlug}`);
          skipped++;
        } else {
          const newCityId = cityIdBySlug[rule.correctCitySlug];
          if (!newCityId) {
            console.warn(`  ⚠️  Ciudad "${rule.correctCitySlug}" no existe en DB — skipping ${cinema.name}`);
            continue;
          }
          const { error } = await supabase
            .from('cinemas')
            .update({ city_id: newCityId })
            .eq('id', cinema.id);
          if (error) {
            console.error(`  ❌ Error actualizando ${cinema.name}:`, error.message);
          } else {
            console.log(`  🔄 ${cinema.name}: ${currentCitySlug} → ${rule.correctCitySlug}`);
            fixed++;
          }
        }
        break; // una regla por cine
      }
    }
  }

  console.log(`\n✅ Completado: ${fixed} corregidos, ${skipped} ya correctos.`);
  console.log('💡 Ejecuta el scraper de CineColombia para que los futuros runs usen el mapa actualizado.');
}

main().catch(console.error);
