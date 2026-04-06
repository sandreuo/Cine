import { ResolvingMetadata } from 'next';
import { supabase } from '@/lib/supabase';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import Image from 'next/image';
import ScreeningsClient from '@/components/ScreeningsClient';

export const revalidate = 60;

const BASE_URL = 'https://cinehoyap.app';

export async function generateMetadata(
  { params }: { params: { slug: string } },
  _parent: ResolvingMetadata
) {
  const { data } = await supabase
    .from('movies')
    .select('title, description, poster_url, genres, duration_minutes, release_date')
    .eq('slug', params.slug)
    .single();

  if (!data) return { title: 'No encontrada | CineHoy' };

  const title = `${data.title} — Horarios y Cartelera en Colombia`;
  const description = data.description
    || `Encuentra funciones, horarios y cines para ver ${data.title} en Colombia. Entradas en Cine Colombia, Cinemark, Cinépolis y Procinal.`;

  return {
    title,
    description,
    alternates: { canonical: `${BASE_URL}/pelicula/${params.slug}` },
    keywords: [
      `${data.title} horarios Colombia`,
      `${data.title} cartelera`,
      `${data.title} cine Colombia`,
      `ver ${data.title} en cine`,
      `${data.title} funciones`,
    ],
    openGraph: {
      type: 'video.movie',
      title,
      description,
      url: `${BASE_URL}/pelicula/${params.slug}`,
      images: data.poster_url ? [{ url: data.poster_url, width: 500, height: 750, alt: data.title }] : [],
      locale: 'es_CO',
      siteName: 'CineHoy',
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: data.poster_url ? [data.poster_url] : [],
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

  const { data: screenings } = await supabase
    .from('screenings')
    .select('*, cinemas(*, cities(name, slug))')
    .eq('movie_id', movie.id)
    .order('start_time', { ascending: true });

  const shareMsg = `🎬 *${movie.title}*\n📅 Hoy | 📍 En cartelera en Colombia\n\n¿Vamos al parche? 🍿\nHorarios y trailers en: ${BASE_URL}/pelicula/${movie.slug}`;
  const shareUrl = `https://wa.me/?text=${encodeURIComponent(shareMsg)}`;

  const movieSchema: Record<string, any> = {
    '@context': 'https://schema.org',
    '@type': 'Movie',
    name: movie.title,
    url: `${BASE_URL}/pelicula/${movie.slug}`,
    image: movie.poster_url,
    description: movie.description,
    duration: movie.duration_minutes ? `PT${movie.duration_minutes}M` : undefined,
    genre: movie.genres,
    datePublished: movie.release_date || undefined,
    countryOfOrigin: { '@type': 'Country', name: 'Colombia' },
  };

  if (movie.trailer_youtube_id) {
    movieSchema.trailer = {
      '@type': 'VideoObject',
      name: `Trailer oficial de ${movie.title}`,
      embedUrl: `https://www.youtube.com/embed/${movie.trailer_youtube_id}`,
      thumbnailUrl: `https://img.youtube.com/vi/${movie.trailer_youtube_id}/hqdefault.jpg`,
    };
  }

  const breadcrumbSchema = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'CineHoy', item: BASE_URL },
      { '@type': 'ListItem', position: 2, name: movie.title, item: `${BASE_URL}/pelicula/${movie.slug}` },
    ],
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(movieSchema) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbSchema) }} />
      <Header />
      <main>
        {/* HERO */}
        <section className="movie-hero">
          {movie.poster_url && (
            <div className="movie-hero-bg" style={{ backgroundImage: `url(${movie.poster_url})` }} />
          )}
          <div className="movie-hero-overlay" />
          <div className="container movie-hero-content">
            <a href="/" className="back-link">← Volver a cartelera</a>
            <div className="movie-hero-inner">
              <div className="movie-detail-poster">
                {movie.poster_url ? (
                  <Image src={movie.poster_url} alt={movie.title} width={400} height={600} unoptimized style={{ width: '100%', height: 'auto' }} />
                ) : (
                  <div className="movie-poster-placeholder">🎞</div>
                )}
              </div>
              <div className="movie-detail-info">
                <h1>{movie.title}</h1>
                <div className="movie-detail-meta">
                  {movie.rating && <span className="movie-rating-badge" style={{ position: 'static' }}>{movie.rating}</span>}
                  {movie.duration_minutes && <span className="text-secondary">{movie.duration_minutes} min</span>}
                  {movie.release_date && (
                    <span className="text-secondary">
                      • Estreno: {new Date(movie.release_date).toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' })}
                    </span>
                  )}
                  {movie.genres && <span className="text-secondary">• {movie.genres.join(', ')}</span>}
                </div>
                <p className="detail-desc">{movie.description}</p>
                <div className="share-section" style={{ padding: '0', background: 'none', border: 'none', marginTop: '16px' }}>
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

          <section className="screenings-section">
            <h2 className="section-title">Horarios y Funciones en Colombia</h2>
            <div style={{ marginTop: '24px' }}>
              <ScreeningsClient
                screenings={screenings || []}
                movieTitle={movie.title}
                movieSlug={movie.slug}
                releaseDate={movie.release_date}
              />
            </div>
          </section>
        </div>
      </main>
      <Footer />
    </>
  );
}
