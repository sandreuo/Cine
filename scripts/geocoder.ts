/**
 * Geocoder: enriches cinemas table with lat/lng using Nominatim (OpenStreetMap).
 * No API key required. Rate limit: 1 req/sec max.
 * Run after scrapers: npx tsx scripts/geocoder.ts
 */

import { supabaseAdmin as supabase } from '../lib/supabase-admin';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(process.cwd(), '.env.local') });

const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const USER_AGENT = 'CineHoy/1.0 (cinehoyap.app)';

// City name normalization for Nominatim queries
const CITY_DISPLAY: Record<string, string> = {
  bogota: 'Bogotá',
  medellin: 'Medellín',
  cali: 'Cali',
  barranquilla: 'Barranquilla',
  bucaramanga: 'Bucaramanga',
  cartagena: 'Cartagena',
  pereira: 'Pereira',
  manizales: 'Manizales',
  ibague: 'Ibagué',
  cucuta: 'Cúcuta',
  villavicencio: 'Villavicencio',
  'santa-marta': 'Santa Marta',
  monteria: 'Montería',
};

async function nominatimSearch(query: string): Promise<{ lat: number; lng: number } | null> {
  const url = new URL(NOMINATIM);
  url.searchParams.set('q', query);
  url.searchParams.set('format', 'json');
  url.searchParams.set('limit', '1');
  url.searchParams.set('countrycodes', 'co');

  const res = await fetch(url.toString(), {
    headers: { 'User-Agent': USER_AGENT },
  });
  if (!res.ok) {
    console.error(`   Nominatim error ${res.status} for: ${query}`);
    return null;
  }
  const data = await res.json();
  if (!data?.[0]) return null;
  return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
}

async function geocodeCinema(
  name: string,
  address: string | null,
  citySlug: string,
): Promise<{ lat: number; lng: number } | null> {
  const cityDisplay = CITY_DISPLAY[citySlug] ?? citySlug;

  // Strategy 1: name + address + city
  if (address) {
    const result = await nominatimSearch(`${name}, ${address}, ${cityDisplay}, Colombia`);
    if (result) return result;
    await sleep(1100);
  }

  // Strategy 2: name + city
  const result2 = await nominatimSearch(`${name}, ${cityDisplay}, Colombia`);
  if (result2) return result2;
  await sleep(1100);

  // Strategy 3: cinema name simplified + city (strip chain prefix if present)
  const simplified = name
    .replace(/^(Cinépolis|Cinemark|Cine Colombia|Cinecolombia|Procinal)\s*/i, '')
    .trim();
  if (simplified && simplified !== name) {
    await sleep(1100);
    const result3 = await nominatimSearch(`${simplified}, ${cityDisplay}, Colombia`);
    if (result3) return result3;
  }

  return null;
}

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

// Extract plain name from Vista Cinema JSON format {"text":"ANDINO","translations":[]}
function extractCinemaName(raw: string): string {
  if (!raw) return '';
  if (raw.startsWith('{')) {
    try { return JSON.parse(raw)?.text ?? raw; } catch { return raw; }
  }
  return raw;
}

export async function geocodeCinemas() {
  console.log('\n📍 Geocodificando cinemas sin coordenadas...');

  // First: fix any remaining JSON-named cinemas in DB before geocoding
  const { data: jsonCinemas } = await supabase
    .from('cinemas').select('id, name').like('name', '{%');
  for (const c of jsonCinemas ?? []) {
    const fixed = extractCinemaName(c.name);
    if (fixed && fixed !== c.name) {
      await supabase.from('cinemas').update({ name: fixed }).eq('id', c.id);
      console.log(`   🔧 Nombre corregido: "${c.name}" → "${fixed}"`);
    }
  }

  const { data: cinemas, error } = await supabase
    .from('cinemas')
    .select('id, name, address, chain, city_id, lat, lng, cities(slug)')
    .is('lat', null)
    .limit(40); // max 40 per run to stay within timeout (40 × ~3s = ~2min)

  if (error || !cinemas) {
    console.error('❌ Error leyendo cinemas:', error?.message);
    return;
  }

  // Skip cinemas that still have JSON names (shouldn't happen after fix above)
  const toGeocode = cinemas.filter(c => c.name && !c.name.startsWith('{'));
  console.log(`   ${toGeocode.length} cinemas a geocodificar (de ${cinemas.length} sin coordenadas)`);

  let found = 0;
  let notFound = 0;

  for (const cinema of toGeocode) {
    const citySlug = (cinema as any).cities?.slug ?? '';
    console.log(`   🔍 ${cinema.name} (${citySlug})`);

    const coords = await geocodeCinema(cinema.name, cinema.address, citySlug);
    if (coords) {
      const { error: upErr } = await supabase
        .from('cinemas')
        .update({ lat: coords.lat, lng: coords.lng })
        .eq('id', cinema.id);

      if (upErr) {
        console.error(`      ❌ Error guardando coords: ${upErr.message}`);
      } else {
        console.log(`      ✅ ${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}`);
        found++;
      }
    } else {
      console.log(`      ⚠️  No encontrado`);
      notFound++;
    }

    // Nominatim requires max 1 req/sec
    await sleep(1100);
  }

  console.log(`\n   ✅ ${found} geocodificados, ⚠️  ${notFound} sin coordenadas.`);
}

// Run standalone
if (require.main === module) {
  geocodeCinemas().catch(console.error);
}
