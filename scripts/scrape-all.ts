import { scrapeCineColombia } from './scraper-cinecolombia';
import { scrapeCinemark } from './scraper-cinemark';
// import { scrapeCinepolis } from './scraper-cinepolis';
// import { scrapeProcinal } from './scraper-procinal';

async function main() {
  console.log('🎬 Iniciando Scraper Global de CineHoy...');
  
  await scrapeCineColombia();
  await scrapeCinemark();
  // await scrapeCinepolis();
  // await scrapeProcinal();

  console.log('✅ Scraping completado con éxito.');
}

main().catch(console.error);
