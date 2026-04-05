import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(process.cwd(), '.env.local') });

import { scrapeCineColombia } from './scraper-cinecolombia';
import { scrapeCinemark } from './scraper-cinemark';
import { scrapeCinepolis } from './scraper-cinepolis';
import { scrapeProcinal } from './scraper-procinal';
import { enrichWithTMDB } from './enricher-tmdb';
import { geocodeCinemas } from './geocoder';
import { execSync } from 'child_process';

async function main() {
  console.log('🎬 Iniciando Scraper Global de CineHoy...');
  console.log(`🔑 Supabase URL: ${process.env.NEXT_PUBLIC_SUPABASE_URL}`);
  
  // 1. CLEANUP first to keep DB slim and relevant
  console.log('\n🧹 Fase 1: Limpieza de datos obsoletos...');
  try {
    execSync('npx tsx scripts/cleanup.ts', { stdio: 'inherit' });
  } catch (e) {
    console.error('   ⚠️  Error en cleanup, continuando...');
  }

  // 2. SCRAPE all chains
  console.log('\n📡 Fase 2: Scraping de cadenas...');
  await scrapeCineColombia();
  await scrapeCinemark();
  await scrapeCinepolis();
  await scrapeProcinal();

  // 3. ENRICH metadata
  console.log('\n🧠 Fase 3: Enriquecimiento TMDB...');
  await enrichWithTMDB();

  // 4. GEOCODE new cinemas
  console.log('\n📍 Fase 4: Geocodificación...');
  await geocodeCinemas();

  console.log('\n✅ Scraping Global completado con éxito.');
}

main().catch(console.error);
