import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(process.cwd(), '.env.local') });

import { scrapeCineColombia } from './scraper-cinecolombia';
import { scrapeCinemark } from './scraper-cinemark';
import { scrapeCinepolis } from './scraper-cinepolis';

async function main() {
  console.log('🎬 Iniciando Scraper Global de CineHoy...');

  await scrapeCineColombia();
  await scrapeCinemark();
  await scrapeCinepolis();

  console.log('✅ Scraping completado con éxito.');
}

main().catch(console.error);
