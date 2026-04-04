import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(process.cwd(), '.env.local') });

import { scrapeCineColombia } from './scraper-cinecolombia';
import { scrapeCinemark } from './scraper-cinemark';
import { scrapeCinepolis } from './scraper-cinepolis';
import { scrapeProcinal } from './scraper-procinal';

async function main() {
  console.log('🎬 Iniciando Scraper Global de CineHoy...');
  console.log(`🔑 Supabase URL: ${process.env.NEXT_PUBLIC_SUPABASE_URL}`);
  console.log(`🔑 Service Role Key: ${process.env.SUPABASE_SERVICE_ROLE_KEY ? '✅ presente' : '❌ FALTANTE — writes pueden fallar'}`);

  await scrapeCineColombia();
  await scrapeCinemark();
  await scrapeCinepolis();
  await scrapeProcinal();

  console.log('✅ Scraping completado con éxito.');
}

main().catch(console.error);
