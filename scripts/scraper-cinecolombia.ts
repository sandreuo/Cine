import { chromium } from 'playwright';
import { supabase } from '../lib/supabase';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(process.cwd(), '.env.local') });

const CITIES: Record<string, string> = {
  bogota: 'bogota',
  medellin: 'medellin',
  cali: 'cali',
  barranquilla: 'barranquilla',
  bucaramanga: 'bucaramanga',
  cartagena: 'cartagena',
};

function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

async function getOrCreateCity(citySlug: string): Promise<number | null> {
  const { data } = await supabase
    .from('cities')
    .select('id')
    .eq('slug', citySlug)
    .single();
  if (data) return data.id;

  const cityName = citySlug.charAt(0).toUpperCase() + citySlug.slice(1);
  const { data: created, error } = await supabase
    .from('cities')
    .insert({ slug: citySlug, name: cityName })
    .select('id')
    .single();

  if (error) {
    console.error(`Error creando ciudad ${citySlug}:`, error.message);
    return null;
  }
  return created?.id ?? null;
}

async function getOrCreateCinema(
  name: string,
  cityId: number,
  address?: string
): Promise<number | null> {
  const { data } = await supabase
    .from('cinemas')
    .select('id')
    .eq('name', name)
    .eq('city_id', cityId)
    .single();
  if (data) return data.id;

  const { data: created, error } = await supabase
    .from('cinemas')
    .insert({ name, city_id: cityId, chain: 'cinecolombia', address: address ?? null })
    .select('id')
    .single();

  if (error) {
    console.error(`Error creando cine ${name}:`, error.message);
    return null;
  }
  return created?.id ?? null;
}

export async function scrapeCineColombia() {
  console.log('🎬 Iniciando scraper REAL de CINE COLOMBIA...');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });

  try {
    for (const [ccSlug, dbSlug] of Object.entries(CITIES)) {
      console.log(`\n📍 Scrapeando ciudad: ${dbSlug}`);
      const cityId = await getOrCreateCity(dbSlug);
      if (!cityId) continue;

      // ── 1. Cartelera page: get movie list ──────────────────────────────
      const cartelera = await context.newPage();
      const billboardUrl = `https://www.cinecolombia.com/${ccSlug}/cartelera`;
      console.log(`   Navegando a ${billboardUrl}`);
      await cartelera.goto(billboardUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

      await cartelera.waitForTimeout(3000);

      const nextDataStr = await cartelera.evaluate(() => {
        const el = document.getElementById('__NEXT_DATA__');
        return el?.textContent ?? null;
      });

      if (!nextDataStr) {
        console.error(`   ❌ No __NEXT_DATA__ en cartelera de ${dbSlug}`);
        await cartelera.close();
        continue;
      }

      const nextData = JSON.parse(nextDataStr);
      const pageProps = nextData?.props?.pageProps ?? {};

      // Log top-level keys so we can debug if paths change
      console.log(`   __NEXT_DATA__ pageProps keys: ${Object.keys(pageProps).join(', ')}`);

      // Try every common path CineColombia might use
      const movieList: any[] =
        pageProps.movies ??
        pageProps.billboard?.movies ??
        pageProps.data?.movies ??
        pageProps.content?.movies ??
        pageProps.initialData?.movies ??
        [];

      console.log(`   Encontradas ${movieList.length} películas`);
      await cartelera.close();

      for (const m of movieList) {
        const title: string = m.title ?? m.nombre ?? m.name ?? '';
        if (!title) continue;

        const slug = m.slug ?? slugify(title);
        const poster = m.poster_url ?? m.poster ?? m.image ?? m.img ?? null;
        const description = m.synopsis ?? m.description ?? m.sinopsis ?? null;
        const duration = parseInt(m.duration ?? m.duracion ?? '0') || null;
        const rating = m.rating ?? m.clasificacion ?? null;
        const genres: string[] = (m.genres ?? m.generos ?? []).map(
          (g: any) => g?.name ?? g?.nombre ?? g ?? ''
        );
        const trailer = m.trailer_url ?? m.trailer ?? null;
        const trailerId = trailer?.includes('v=')
          ? trailer.split('v=')[1]?.split('&')[0]
          : trailer?.split('/').pop() ?? null;

        console.log(`   🎥 Procesando: ${title}`);

        const { data: movie, error: movieErr } = await supabase
          .from('movies')
          .upsert(
            {
              slug,
              title,
              poster_url: poster,
              trailer_youtube_id: trailerId,
              description,
              duration_minutes: duration,
              rating,
              genres,
            },
            { onConflict: 'slug' }
          )
          .select('id')
          .single();

        if (movieErr || !movie) {
          console.error(`   ❌ Error guardando película ${title}:`, movieErr?.message);
          continue;
        }

        // ── 2. Movie page: get showtimes per cinema ────────────────────
        const moviePage = await context.newPage();
        const movieUrl = `https://www.cinecolombia.com/${ccSlug}/pelicula/${slug}`;
        try {
          await moviePage.goto(movieUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
          await moviePage.waitForTimeout(3000);

          const movieNextDataStr = await moviePage.evaluate(() => {
            const el = document.getElementById('__NEXT_DATA__');
            return el?.textContent ?? null;
          });

          if (movieNextDataStr) {
            const movieNextData = JSON.parse(movieNextDataStr);
            const moviePageProps = movieNextData?.props?.pageProps ?? {};

            // Showtimes may be nested in various structures
            const showings: any[] =
              moviePageProps.showings ??
              moviePageProps.screenings ??
              moviePageProps.functions ??
              moviePageProps.showtimes ??
              moviePageProps.data?.showings ??
              moviePageProps.movie?.showings ??
              moviePageProps.movie?.screenings ??
              [];

            if (showings.length > 0) {
              console.log(`      ✅ ${showings.length} funciones encontradas vía __NEXT_DATA__`);
            }

            for (const showing of showings) {
              // CineColombia typically groups by cinema then by schedule
              const cinemaName: string =
                showing.cinema?.name ??
                showing.cinema?.nombre ??
                showing.theater?.name ??
                showing.sala?.nombre ??
                showing.name ??
                '';
              const cinemaAddress: string =
                showing.cinema?.address ??
                showing.cinema?.direccion ??
                showing.theater?.address ??
                '';

              if (!cinemaName) continue;
              const cinemaId = await getOrCreateCinema(cinemaName, cityId, cinemaAddress);
              if (!cinemaId) continue;

              const schedules: any[] =
                showing.schedules ??
                showing.horarios ??
                showing.functions ??
                showing.times ??
                (showing.time ? [showing] : []);

              for (const sched of schedules) {
                const rawTime: string =
                  sched.time ?? sched.hora ?? sched.start_time ?? sched.datetime ?? '';
                if (!rawTime) continue;

                // Normalize to ISO: if it's just "HH:MM", use today's date
                let startTime: string;
                if (/^\d{2}:\d{2}$/.test(rawTime)) {
                  const today = new Date().toISOString().split('T')[0];
                  startTime = `${today}T${rawTime}:00`;
                } else {
                  startTime = rawTime;
                }

                const format =
                  sched.format ?? sched.formato ?? sched.type ?? sched.sala ?? '2D';
                const language =
                  sched.language ??
                  sched.idioma ??
                  (sched.dubbed ? 'doblada' : 'subtitulada');
                const buyUrl = sched.buy_url ?? sched.url ?? sched.link ?? null;

                const { error: screenErr } = await supabase.from('screenings').upsert(
                  {
                    movie_id: movie.id,
                    cinema_id: cinemaId,
                    start_time: startTime,
                    format,
                    language,
                    buy_url: buyUrl,
                  },
                  { onConflict: 'movie_id,cinema_id,start_time' }
                );

                if (screenErr) {
                  console.error(`      ❌ Error insertando función:`, screenErr.message);
                }
              }
            }
          }

          // ── Fallback: DOM scraping for showtimes ────────────────────
          const domShowtimes = await moviePage.evaluate(() => {
            const results: any[] = [];

            // CineColombia groups showtimes by cinema
            // Look for cinema sections: they usually have a heading + time buttons
            const cinemaSections = document.querySelectorAll(
              '[class*="cinema"], [class*="theater"], [class*="cine"], .venue, .complex'
            );

            cinemaSections.forEach((section) => {
              const cinemaEl = section.querySelector('h2, h3, h4, [class*="name"], [class*="nombre"]');
              const cinemaName = cinemaEl?.textContent?.trim() ?? '';
              if (!cinemaName) return;

              const timeButtons = section.querySelectorAll(
                'button, a[class*="hour"], a[class*="hora"], [class*="time"], [class*="schedule"]'
              );

              const times: any[] = [];
              timeButtons.forEach((btn) => {
                const text = btn.textContent?.trim() ?? '';
                if (/\d{1,2}:\d{2}/.test(text)) {
                  times.push({
                    time: text.match(/\d{1,2}:\d{2}/)?.[0] ?? text,
                    url: (btn as HTMLAnchorElement).href ?? null,
                    format: btn.getAttribute('data-format') ?? '2D',
                  });
                }
              });

              if (times.length > 0) {
                results.push({ cinemaName, times });
              }
            });

            return results;
          });

          if (domShowtimes.length > 0) {
            console.log(`      ✅ ${domShowtimes.length} cines encontrados vía DOM`);
            for (const { cinemaName, times } of domShowtimes) {
              const cinemaId = await getOrCreateCinema(cinemaName, cityId);
              if (!cinemaId) continue;

              const today = new Date().toISOString().split('T')[0];
              for (const sched of times) {
                const startTime = `${today}T${sched.time}:00`;
                await supabase.from('screenings').upsert(
                  {
                    movie_id: movie.id,
                    cinema_id: cinemaId,
                    start_time: startTime,
                    format: sched.format ?? '2D',
                    language: 'subtitulada',
                    buy_url: sched.url ?? null,
                  },
                  { onConflict: 'movie_id,cinema_id,start_time' }
                );
              }
            }
          }
        } catch (pageErr) {
          console.error(`      ❌ Error en página de película ${title}:`, pageErr);
        } finally {
          await moviePage.close();
        }
      }
    }

    console.log('\n✅ Cine Colombia Scraper finalizado.');
  } catch (err) {
    console.error('❌ Error fatal en Cine Colombia Scraper:', err);
  } finally {
    await browser.close();
  }
}
