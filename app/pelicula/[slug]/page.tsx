import { ResolvingMetadata } from 'next';
import { supabase } from '@/lib/supabase';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import Image from 'next/image';
import ScreeningsClient from '@/components/ScreeningsClient';

export const revalidate = 60; // Revalidate every minute

export async function generateMetadata(
  { params }: { params: { slug: string } },
  parent: ResolvingMetadata
) {
  const { data } = await supabase
    .from('movies')
    .select('title, description, poster_url')
    .eq('slug', params.slug)
    .single();

  if (!data) return { title: 'No encontrada | CineHoy.co' };

  return {
    title: `${data.title} | Cartelera en Colombia y Horarios`,
    description: data.description || `Encuentra funciones, horarios y cines para ${data.title} en Colombia. Cine Colombia, Cinemark, Cinépolis y Procinal.`,
    openGraph: {
      images: data.poster_url ? [{ url: data.poster_url }] : [],
    },
  };
}

export default async function MoviePage({ params }: { params: { slug: string } }) {
  const { data: movie } = await supabase
    .from('movies')
    .select('*')
    .eq('slug', params.slug)
    .single();

  if (!movie) {
    return (
      <>
        <Header />
        <div className="empty-state">
          <div className="icon">❓</div>
          <h3>Película no encontrada</h3>
          <p>No encontramos resultados para esta película.</p>
        </div>
        <Footer />
      </>
    );
  }

  // Fetch screenings grouped by city and cinema
  // Given we don't have scraped data yet, we just show a mockup of how it works
  const { data: screenings } = await supabase
    .from('screenings')
    .select('*, cinemas(*, cities(name, slug))')
    .eq('movie_id', movie.id)
    .order('start_time', { ascending: true });

  const shareMsg = `🎬 *${movie.title}*\n📅 Hoy | 📍 En cartelera en Colombia\n\n¿Vamos al parche? 🍿\nHorarios y trailers en: https://cinehoy.co/pelicula/${movie.slug}`;
  const shareUrl = `https://wa.me/?text=${encodeURIComponent(shareMsg)}`;

  // JSON-LD Schema
  const schema = {
    '@context': 'https://schema.org',
    '@type': 'Movie',
    name: movie.title,
    image: movie.poster_url,
    description: movie.description,
    duration: movie.duration_minutes ? `PT${movie.duration_minutes}M` : undefined,
    genre: movie.genres,
  };

  return (
    <>
      <Header />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }} />
      <main>
        {/* HERO */}
        <section className="movie-hero">
          {movie.poster_url && (
            <div
              className="movie-hero-bg"
              style={{ backgroundImage: `url(${movie.poster_url})` }}
            />
          )}
          <div className="movie-hero-overlay" />
          <div className="container movie-hero-content">
            <a href="/" className="back-link">
              ← Volver a cartelera
            </a>
            <div className="movie-hero-inner">
              <div className="movie-detail-poster">
                {movie.poster_url ? (
                  <Image src={movie.poster_url} alt={movie.title} width={300} height={450} />
                ) : (
                  <div className="movie-poster-placeholder">🎞</div>
                )}
              </div>
              <div className="movie-detail-info">
                <h1>{movie.title}</h1>
                <div className="movie-detail-meta">
                  {movie.rating && <span className="movie-rating-badge" style={{ position: 'static' }}>{movie.rating}</span>}
                  {movie.duration_minutes && <span className="text-secondary">{movie.duration_minutes} min</span>}
                  {movie.genres && (
                    <span className="text-secondary">
                      • {movie.genres.join(', ')}
                    </span>
                  )}
                </div>
                <p className="detail-desc">{movie.description}</p>
                
                <div className="share-section" style={{ padding: '0', background: 'none', border: 'none', marginTop: '16px', alignContent: 'center' }}>
                  <a href={shareUrl} target="_blank" rel="noopener noreferrer" className="btn-whatsapp">
                    📱 Compartir el plan por WhatsApp
                  </a>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* CONTENT */}
        <div className="container">
          {/* Ad Slot */}
          <div className="ad-slot ad-slot-banner" aria-label="Publicidad" />

          {/* Trailer */}
          {movie.trailer_youtube_id && movie.trailer_youtube_id.length > 5 && (
            <section className="trailer-section">
              <h2 className="section-title" style={{ marginBottom: '16px' }}>Trailer Oficial</h2>
              <div className="trailer-wrap">
                <iframe
                  src={`https://www.youtube.com/embed/${movie.trailer_youtube_id}`}
                  title={`Trailer de ${movie.title}`}
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                />
              </div>
            </section>
          )}

          {/* Screenings */}
          <section className="screenings-section">
            <h2 className="section-title">Horarios y Funciones</h2>
            <div style={{ marginTop: '24px' }}>
              <ScreeningsClient screenings={screenings || []} />
            </div>
          </section>
        </div>
      </main>
      <Footer />
    </>
  );
}
