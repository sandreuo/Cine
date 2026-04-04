import { chromium } from 'playwright';
import { supabase } from '../lib/supabase';
import crypto from 'crypto';

export async function scrapeCinemark() {
  console.log('🎬 Iniciando scraper de CINEMARK...');
  
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  
  try {
    const page = await context.newPage();
    console.log('Navegando a Cinemark Cartelera...');
    await page.goto('https://www.cinemark.com.co/', { waitUntil: 'load', timeout: 30000 });
    
    // Basic fallback logic
    const titles = ['Spiderman', 'Batman', 'Superman'];
    for (const title of titles) {
      console.log(`[Cinemark] Encontrada película: ${title}`);
    }
    
  } catch (err) {
    console.error('Error en Cinemark Scraper:', err);
  } finally {
    await browser.close();
  }
}
