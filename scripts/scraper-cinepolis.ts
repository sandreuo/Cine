import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

// Load .env.local
dotenv.config({ path: path.join(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseAnonKey);

const CITY_SLUGS_CINEPOLIS: Record<string, string> = {
  'bogota-colombia': 'bogota',
  'cali-colombia': 'cali',
  'medellin-colombia': 'medellin',
};

async function scrapeCinepolis() {
  console.log('🎬 Iniciando scraper de Cinépolis Colombia...');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  
  try {
    for (const [cinepolisSlug, supabaseSlug] of Object.entries(CITY_SLUGS_CINEPOLIS)) {
      console.log(`\n📍 Scrapeando ciudad: ${supabaseSlug} (${cinepolisSlug})...`);
      
      const { data: city } = await supabase
        .from('cities')
        .select('id')
        .eq('slug', supabaseSlug)
        .single();
        
      if (!city) {
        console.error(`Ciudad no encontrada en BD: ${supabaseSlug}`);
        continue;
      }

      const page = await context.newPage();
      await page.goto(`https://cinepolis.com.co/cartelera/${cinepolisSlug}`, { waitUntil: 'load', timeout: 30000 });
      
      // Wait for at least one movie card or the empty state
      // We look for article elements which usually wrap movies
      await page.waitForTimeout(3000); // Wait for React to render

      const moviesData = await page.evaluate(() => {
        const results: any[] = [];
        
        // Find cinema locations (Complexes)
        const complexes = document.querySelectorAll('.cartelera-complejo'); // Adjust selector as needed, but Cinepolis usually groups by cinema
        
        // If they use a different structure (e.g. articles), we parse globally.
        // This is a generic heuristic selector since we don't have the exact DOM.
        // Cinepolis typically uses <article class="pelicula"> or similar.
        const movies = document.querySelectorAll('article.pelicula, .movie-card, .itemList');
        
        if (movies.length === 0) {
           // Fallback: Just grab headers and text to see what we found
           const headers = Array.from(document.querySelectorAll('h2, h3, a.title')).map(n => n.textContent?.trim() || '');
           const posters = Array.from(document.querySelectorAll('img')).map(n => n.src).filter(src => src.includes('poster') || src.includes('movie'));
           return { type: 'fallback', headers: headers.slice(0, 10), posters: posters.slice(0, 5) };
        }

        movies.forEach(movie => {
          const title = movie.querySelector('h2, h3, .tituloPelicula, .movie-title')?.textContent?.trim();
          const posterUrl = movie.querySelector('img')?.src;
          const rating = movie.querySelector('.clasificacion, .rating')?.textContent?.trim();
          
          results.push({
            title,
            posterUrl,
            rating,
            genres: [],
            duration_minutes: 120 // mock
          });
        });
        
        return { type: 'success', movies: results };
      });

      console.log('Resultados para la ciudad:', moviesData);

      // Si found actual movies, we insert them. For now we just log to prove it works
      // since the DOM selector is a guess.
      
      if (moviesData.type === 'success' && moviesData.movies && moviesData.movies.length > 0) {
        for (const m of moviesData.movies) {
          if (!m.title) continue;
          const slug = m.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
          
          const { error } = await supabase.from('movies').upsert({
            title: m.title,
            slug,
            poster_url: m.posterUrl,
            rating: m.rating,
          }, { onConflict: 'slug' });
          
          if (error) {
            console.error('Error insertando película:', error.message);
          } else {
             console.log(`✅ Película sincronizada: ${m.title}`);
          }
        }
      }

      await page.close();
    }
  } catch (err) {
    console.error('Error durante el scrape:', err);
  } finally {
    await browser.close();
    console.log('🏁 Scraper terminado.');
  }
}

scrapeCinepolis();
