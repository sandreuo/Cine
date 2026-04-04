'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { supabase, Movie, City } from '@/lib/supabase';
import MovieCard from '@/components/MovieCard';

const CITIES_MAIN = [
  { slug: 'bogota', name: 'Bogotá' },
  { slug: 'medellin', name: 'Medellín' },
  { slug: 'cali', name: 'Cali' },
  { slug: 'barranquilla', name: 'Barranquilla' },
  { slug: 'bucaramanga', name: 'Bucaramanga' },
  { slug: 'pereira', name: 'Pereira' },
  { slug: 'cartagena', name: 'Cartagena' },
  { slug: 'manizales', name: 'Manizales' },
];

const CHAIN_LABELS: Record<string, string> = {
  cinepolis: 'Cinépolis',
  cinecolombia: 'Cine Colombia',
  cinemark: 'Cinemark',
  procinal: 'Procinal',
};

function getDistance(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export default function HomeClient({
  initialMovies,
  cities,
  searchQuery,
}: {
  initialMovies: Movie[];
  cities: City[];
  searchQuery: string;
}) {
  const [movies, setMovies] = useState<Movie[]>(initialMovies);
  const [loading, setLoading] = useState(false);
  const [cityFilter, setCityFilter] = useState('');
  const [chain, setChain] = useState('');
  const [dateFilter, setDateFilter] = useState('hoy');
  const [geoActive, setGeoActive] = useState(false);
  const [geoLoading, setGeoLoading] = useState(false);
  const [nearestCity, setNearestCity] = useState<City | null>(null);
  const [q, setQ] = useState(searchQuery);
  const debounceRef = useRef<NodeJS.Timeout>();

  const fetchMovies = useCallback(async (search: string, citySlug: string, chainFilter: string) => {
    setLoading(true);
    try {
      // In production, filter by screenings for the given city/date
      // For now, fetch all movies with optional search
      let query = supabase.from('movies').select('*').order('title');

      if (search.trim()) {
        query = query.ilike('title', `%${search.trim()}%`);
      }

      const { data } = await query;
      if (data) setMovies(data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      fetchMovies(q, cityFilter, chain);
    }, 350);
  }, [q, cityFilter, chain, fetchMovies]);

  function handleGeo() {
    if (geoActive) {
      setGeoActive(false);
      setNearestCity(null);
      setCityFilter('');
      return;
    }
    if (!navigator.geolocation) return;
    setGeoLoading(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        // Find nearest city
        let nearest: City | null = null;
        let minDist = Infinity;
        for (const city of cities) {
          if (city.lat && city.lng) {
            const d = getDistance(latitude, longitude, city.lat, city.lng);
            if (d < minDist) {
              minDist = d;
              nearest = city;
            }
          }
        }
        if (nearest) {
          setNearestCity(nearest);
          setCityFilter(nearest.slug);
        }
        setGeoActive(true);
        setGeoLoading(false);
      },
      () => setGeoLoading(false)
    );
  }

  const displayMovies = movies.filter((m) => {
    if (q.trim() && !m.title.toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  });

  return (
    <>
      {/* HERO */}
      <section className="hero">
        <div className="container">
          <span className="hero-eyebrow">
            🇨🇴 Colombia · {new Date().toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' })}
          </span>
          <h1>
            Toda la cartelera,<br />
            <span>en un solo lugar</span>
          </h1>
          <p className="hero-desc">
            Cinépolis, Cine Colombia, Cinemark y Procinal. Horarios, trailers y
            comparte el plan al parche por WhatsApp.
          </p>
        </div>
      </section>

      {/* FILTERS */}
      <section className="filters">
        <div className="container">
          <div className="filters-row">
            <button
              className={`filter-chip ${dateFilter === 'hoy' ? 'active' : ''}`}
              onClick={() => setDateFilter('hoy')}
            >
              📅 Hoy
            </button>
            <button
              className={`filter-chip ${dateFilter === 'manana' ? 'active' : ''}`}
              onClick={() => setDateFilter('manana')}
            >
              Mañana
            </button>
            <button
              className={`filter-chip ${dateFilter === 'semana' ? 'active' : ''}`}
              onClick={() => setDateFilter('semana')}
            >
              Esta semana
            </button>

            <select
              className="filter-select"
              value={cityFilter}
              onChange={(e) => {
                setCityFilter(e.target.value);
                setGeoActive(false);
                setNearestCity(null);
              }}
              aria-label="Filtrar por ciudad"
            >
              <option value="">🌎 Todas las ciudades</option>
              {cities.map((c) => (
                <option key={c.slug} value={c.slug}>
                  {c.name}
                </option>
              ))}
            </select>

            <select
              className="filter-select"
              value={chain}
              onChange={(e) => setChain(e.target.value)}
              aria-label="Filtrar por cadena"
            >
              <option value="">🎭 Todas las cadenas</option>
              {Object.entries(CHAIN_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>

            <button
              className={`geo-btn ${geoActive ? 'active' : ''}`}
              onClick={handleGeo}
              disabled={geoLoading}
            >
              {geoLoading ? '⏳' : '📍'}{' '}
              {geoActive && nearestCity
                ? `Cines en ${nearestCity.name}`
                : 'Cines cerca de mí'}
            </button>
          </div>
        </div>
      </section>

      {/* AD SLOT */}
      <div className="container">
        <div className="ad-slot ad-slot-banner" aria-label="Publicidad" />
      </div>

      {/* HOW TO USE / DESCRIPTION */}
      <section style={{ padding: '0 0 24px', textAlign: 'center' }}>
        <div className="container">
          <div style={{ background: 'rgba(255,255,255,0.03)', padding: '16px', borderRadius: 'var(--radius)', border: '1px solid var(--border)', maxWidth: '600px', margin: '0 auto' }}>
            <h2 style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--gold)', marginBottom: '4px' }}>
              ⚡️ Arma tu plan de cine en segundos
            </h2>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
              Filtra por ciudad o ubicación, elige tu película, compara horarios entre cines y envíale la invitación armada a tus amigos por WhatsApp al instante.
            </p>
          </div>
        </div>
      </section>

      {/* MOVIES */}
      <section style={{ paddingBottom: '32px' }}>
        <div className="container">
          <div className="section-header">
            <h2 className="section-title">
              <span className="dot" />
              {cityFilter
                ? `Cartelera en ${cities.find((c) => c.slug === cityFilter)?.name}`
                : 'En cartelera'}
            </h2>
            <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
              {displayMovies.length} película{displayMovies.length !== 1 ? 's' : ''}
            </span>
          </div>

          {loading ? (
            <div className="loading-grid">
              {Array.from({ length: 10 }).map((_, i) => (
                <div key={i} className="skeleton">
                  <div className="skeleton-poster" />
                  <div className="skeleton-body">
                    <div className="skeleton-line" />
                    <div className="skeleton-line w-70" />
                    <div className="skeleton-line w-50" />
                  </div>
                </div>
              ))}
            </div>
          ) : displayMovies.length === 0 ? (
            <div className="empty-state">
              <div className="icon">🎞</div>
              <h3>No encontramos películas</h3>
              <p>Intenta con otro filtro o vuelve más tarde.</p>
            </div>
          ) : (
            <div className="movies-grid">
              {displayMovies.map((m) => (
                <MovieCard key={m.id} movie={m} />
              ))}
            </div>
          )}
        </div>
      </section>

      {/* CITIES SECTION */}
      <section className="cities-section">
        <div className="container">
          <div className="section-header">
            <h2 className="section-title">
              Cartelera por ciudad
            </h2>
          </div>
          <div className="cities-grid">
            {CITIES_MAIN.map((c) => (
              <a key={c.slug} href={`/${c.slug}`} className="city-card">
                <span className="flag">🇨🇴</span>
                <span>{c.name}</span>
              </a>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
