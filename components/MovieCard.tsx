'use client';

import Image from 'next/image';
import Link from 'next/link';
import { Movie } from '@/lib/supabase';

function buildWhatsAppMessage(movie: Movie) {
  const msg = `🎬 *${movie.title}*\n🍿 ¡Vamos al parche!\n\nVer horarios en: https://cinehoy.co/pelicula/${movie.slug}`;
  return `https://wa.me/?text=${encodeURIComponent(msg)}`;
}

export default function MovieCard({ movie }: { movie: Movie }) {
  return (
    <article className="movie-card">
      <Link href={`/pelicula/${movie.slug}`}>
        <div className="movie-poster-wrap">
          {movie.poster_url ? (
            <Image
              src={movie.poster_url}
              alt={`Póster de ${movie.title}`}
              fill
              unoptimized
              sizes="(max-width: 480px) 50vw, (max-width: 768px) 33vw, (max-width: 1024px) 25vw, 20vw"
              style={{ objectFit: 'cover' }}
            />
          ) : (
            <div className="movie-poster-placeholder">🎞</div>
          )}
          {movie.is_preventa && (
            <span className="movie-presale-badge">PREVENTA</span>
          )}
          {movie.is_estreno && (
            <span className="movie-new-badge">ESTRENO</span>
          )}
          {!movie.is_estreno && movie.release_date && (new Date().getTime() - new Date(movie.release_date).getTime() < 30 * 24 * 60 * 60 * 1000) && (new Date(movie.release_date) <= new Date()) && (
            <span className="movie-new-badge">ESTRENO</span>
          )}
          {movie.rating && (
            <span className="movie-rating-badge">{movie.rating}</span>
          )}
        </div>
      </Link>

      <div className="movie-card-body">
        <Link href={`/pelicula/${movie.slug}`}>
          <h2 className="movie-title">{movie.title}</h2>
        </Link>

        {movie.genres && movie.genres.length > 0 && (
          <div className="movie-genres">
            {movie.genres.slice(0, 2).map((g) => (
              <span key={g} className="genre-tag">
                {g}
              </span>
            ))}
          </div>
        )}

        <div className="movie-meta">
          {movie.duration_minutes && (
            <span className="movie-duration">{movie.duration_minutes} min</span>
          )}
          {movie.release_date && (
            <span className="movie-release-date">
              📅 {new Date(movie.release_date).toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' })}
            </span>
          )}
        </div>
      </div>

      <div className="movie-card-actions">
        <Link href={`/pelicula/${movie.slug}`} className="btn-primary">
          Ver horarios
        </Link>
        <a
          href={buildWhatsAppMessage(movie)}
          target="_blank"
          rel="noopener noreferrer"
          className="btn-share"
          title="Compartir por WhatsApp"
          aria-label="Compartir por WhatsApp"
        >
          📱
        </a>
      </div>
    </article>
  );
}
