'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { supabase, Movie, City, Cinema } from '@/lib/supabase';
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
  initialCity = '',
}: {
  initialMovies: Movie[];
  cities: City[];
  searchQuery: string;
  initialCity?: string;
}) {
  const [movies, setMovies] = useState<Movie[]>(initialMovies);
  const [loading, setLoading] = useState(false);
  const [cityFilter, setCityFilter] = useState(initialCity);
  const [chain, setChain] = useState('');
  const [dateFilter, setDateFilter] = useState('hoy');
  const [geoActive, setGeoActive] = useState(false);
  const [geoLoading, setGeoLoading] = useState(false);
  const [nearestCity, setNearestCity] = useState<City | null>(null);
  const [userLocation, setUserLocation] = useState<{lat: number; lng: number} | null>(null);
  const [q, setQ] = useState(searchQuery);
  const [cinemas, setCinemas] = useState<Cinema[]>([]);
  const [cinemaFilter, setCinemaFilter] = useState<number | null>(null);
  const [cinemaSearchResults, setCinemaSearchResults] = useState<Cinema[]>([]);
  const debounceRef = useRef<NodeJS.Timeout>();
  const cinemaSearchRef = useRef<NodeJS.Timeout>();

  // Fetch cinemas for selected city
  useEffect(() => {
    setCinemaFilter(null);
    if (!cityFilter) { setCinemas([]); return; }
    supabase
      .from('cinemas')
      .select('id, name, chain, cities!inner(slug, name)')
      .eq('cities.slug', cityFilter)
      .order('name')
      .then(({ data }) => { if (data) setCinemas(data as any[]); });
  }, [cityFilter]);

  // Search cinemas by name when user types
  useEffect(() => {
    clearTimeout(cinemaSearchRef.current);
    if (!q.trim() || q.trim().length < 2) { setCinemaSearchResults([]); return; }
    cinemaSearchRef.current = setTimeout(() => {
      supabase
        .from('cinemas')
        .select('id, name, chain, cities!inner(slug, name)')
        .ilike('name', `%${q.trim()}%`)
        .limit(5)
        .then(({ data }) => { setCinemaSearchResults(data ? data as any[] : []); });
    }, 350);
  }, [q]);

  const fetchMovies = useCallback(async (search: string, citySlug: string, chainFilter: string, dFilter: string, cinemaId: number | null) => {
    setLoading(true);
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    
    // Calculate date ranges
    let startDate = today + 'T00:00:00';
    let endDate: string | null = null;

    if (dFilter === 'manana') {
      const tomorrow = new Date(now);
      tomorrow.setDate(now.getDate() + 1);
      startDate = tomorrow.toISOString().split('T')[0] + 'T00:00:00';
      
      const dayAfter = new Date(now);
      dayAfter.setDate(now.getDate() + 2);
      endDate = dayAfter.toISOString().split('T')[0] + 'T00:00:00';
    } else if (dFilter === 'semana') {
      const in7Days = new Date(now);
      in7Days.setDate(now.getDate() + 7);
      endDate = in7Days.toISOString().split('T')[0] + 'T00:00:00';
    }

    try {
      // Build complex query to filter movies based on city/chain screenings
      let query = supabase.from('movies').select('*, screenings!inner(id, start_time, cinemas!inner(chain, cities!inner(slug)))');

      if (search.trim()) {
        query = query.ilike('title', `%${search.trim()}%`);
      }
      if (citySlug) {
        query = query.eq('screenings.cinemas.cities.slug', citySlug);
      }
      if (chainFilter) {
        query = query.eq('screenings.cinemas.chain', chainFilter);
      }
      if (cinemaId) {
        query = query.eq('screenings.cinema_id', cinemaId);
      }

      // Time range filtering
      query = query.gte('screenings.start_time', startDate);
      if (endDate) {
        query = query.lt('screenings.start_time', endDate);
      }

      const { data } = await query.order('title');
      if (data) {
        // Deduplicate movies from inner join
        const unique = Array.from(new Map((data as any[]).map(m => [m.id, m])).values()) as Movie[];
        setMovies(unique);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      fetchMovies(q, cityFilter, chain, dateFilter, cinemaFilter);
    }, 350);
  }, [q, cityFilter, chain, dateFilter, cinemaFilter, fetchMovies]);

  function handleGeo() {
    if (geoActive) {
      setGeoActive(false);
      setNearestCity(null);
      setUserLocation(null);
      setCityFilter('');
      return;
    }
    if (!navigator.geolocation) return;
    setGeoLoading(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        setUserLocation({ lat: latitude, lng: longitude });
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

  // Sort cinemas by distance when user location is known
  const sortedCinemas = userLocation
    ? [...cinemas].sort((a, b) => {
        const da = a.lat && a.lng ? getDistance(userLocation.lat, userLocation.lng, a.lat, a.lng) : Infinity;
        const db = b.lat && b.lng ? getDistance(userLocation.lat, userLocation.lng, b.lat, b.lng) : Infinity;
        return da - db;
      })
    : cinemas;

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
            Toda la{' '}
            <a
              href="#cartelera"
              style={{ color: 'inherit', textDecoration: 'none', borderBottom: '3px solid var(--gold)', cursor: 'pointer' }}
            >
              cartelera
            </a>
            ,<br />
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

          {/* Cinema search suggestions — shown when search matches cinema names */}
          {cinemaSearchResults.length > 0 && (
            <div className="filters-row" style={{ marginTop: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginRight: '4px' }}>Sedes:</span>
              {cinemaSearchResults.map((c) => (
                <button
                  key={c.id}
                  className={`filter-chip${cinemaFilter === c.id ? ' active' : ''}`}
                  onClick={() => {
                    const city = (c as any).cities;
                    if (city?.slug) { setCityFilter(city.slug); setGeoActive(false); setNearestCity(null); }
                    setCinemaFilter(cinemaFilter === c.id ? null : c.id);
                    setQ('');
                    setCinemaSearchResults([]);
                  }}
                >
                  {c.name}
                  {(c as any).cities?.name && (
                    <span style={{ marginLeft: '4px', opacity: 0.6, fontSize: '0.75em' }}>
                      · {(c as any).cities.name}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}

          {/* Cinema/venue chips — shown only when a city is selected and has cinemas */}
          {sortedCinemas.length > 0 && (
            <div className="filters-row" style={{ marginTop: '8px', flexWrap: 'wrap' }}>
              <button
                className={`filter-chip${!cinemaFilter ? ' active' : ''}`}
                onClick={() => setCinemaFilter(null)}
              >
                🎭 Todos los cines
              </button>
              {sortedCinemas.map((c) => {
                const dist = userLocation && c.lat && c.lng
                  ? getDistance(userLocation.lat, userLocation.lng, c.lat, c.lng)
                  : null;
                return (
                  <button
                    key={c.id}
                    className={`filter-chip${cinemaFilter === c.id ? ' active' : ''}`}
                    onClick={() => setCinemaFilter(cinemaFilter === c.id ? null : c.id)}
                  >
                    {c.name}
                    {dist !== null && (
                      <span style={{ marginLeft: '4px', opacity: 0.6, fontSize: '0.75em' }}>
                        · {dist < 1 ? `${Math.round(dist * 1000)}m` : `${dist.toFixed(1)}km`}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </section>


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
      <section id="cartelera" style={{ paddingBottom: '32px' }}>
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
