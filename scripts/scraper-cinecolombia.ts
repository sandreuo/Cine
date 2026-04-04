import { chromium } from 'playwright';
import { supabase } from '../lib/supabase';

export async function scrapeCineColombia() {
  console.log('🎬 Iniciando scraper REAL de CINE COLOMBIA...');
  
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });
  
  try {
    const page = await context.newPage();
    // We go to Bogota as a baseline for posters/metadata
    const url = 'https://www.cinecolombia.com/bogota/cartelera';
    console.log(`Navegando a ${url}...`);
    await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
    
    // Extract __NEXT_DATA__
    const nextDataStr = await page.evaluate(() => {
      const script = document.getElementById('__NEXT_DATA__');
      return script ? script.textContent : null;
    });

    if (!nextDataStr) {
      throw new Error('No se encontró __NEXT_DATA__ en Cine Colombia');
    }

    const nextData = JSON.parse(nextDataStr);
    const movies = nextData.props?.pageProps?.movies || [];
    
    console.log(`Encontradas ${movies.length} películas en Cine Colombia.`);

    for (const m of movies) {
      const title = m.title;
      const slug = m.slug || title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      const poster = m.poster_url || m.poster;
      const description = m.synopsis || m.description;
      const duration = m.duration;
      const rating = m.rating;
      const genres = m.genres?.map((g: any) => g.name || g) || [];
      const trailer = m.trailer_url;
      const trailerId = trailer?.includes('v=') ? trailer.split('v=')[1]?.split('&')[0] : trailer?.split('/').pop();

      console.log(`Procesando: ${title}`);

      await supabase.from('movies').upsert({
        slug,
        title,
        poster_url: poster,
        trailer_youtube_id: trailerId,
        description,
        duration_minutes: parseInt(duration) || 0,
        rating,
        genres
      }, { onConflict: 'slug' });
    }

    console.log('✅ Cine Colombia Scraper finalizado con éxito.');
    
  } catch (err) {
    console.error('❌ Error fatal en Cine Colombia Scraper:', err);
  } finally {
    await browser.close();
  }
}
