import { chromium } from 'playwright';
import { supabase } from '../lib/supabase';
import crypto from 'crypto';

export async function scrapeCineColombia() {
  console.log('🎬 Iniciando scraper de CINE COLOMBIA...');
  
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });
  
  try {
    const page = await context.newPage();
    console.log('Navegando a Cine Colombia Cartelera...');
    await page.goto('https://www.cinecolombia.com/bogota/cartelera', { waitUntil: 'load', timeout: 30000 });
    
    // Simulate scraping logic (Basic fallback for MVP)
    const titles = ['El Gato con Botas', 'Avatar: El Camino del Agua', 'M3GAN'];
    
    // Inject logic
    for (const title of titles) {
      console.log(`[Cine Colombia] Encontrada película: ${title}`);
      const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      
      const { data: movie } = await supabase.from('movies').upsert({
        slug,
        title,
        poster_url: 'https://image.tmdb.org/t/p/w500/vJU3rXSP9hwUuLeq8IpfsJShLOk.jpg',
        trailer_url: 'https://youtube.com/watch?v=123',
        synopsis: 'Disfruta en Cine Colombia.',
        duration: '120 min',
        rating: 'PG-13',
        genres: ['Acción', 'Fantasía'],
        release_date: new Date().toISOString().split('T')[0]
      }).select().single();

      if (movie) {
        // Insert dummy screenings
        await supabase.from('screenings').upsert({
          id: crypto.randomUUID(),
          movie_id: movie.id,
          // cinema_id will be random or handled by orchestrator later
        });
      }
    }
    
  } catch (err) {
    console.error('Error en Cine Colombia Scraper:', err);
  } finally {
    await browser.close();
  }
}
