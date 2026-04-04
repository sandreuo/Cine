'use client';

import { useState } from 'react';
import type { Screening } from '@/lib/supabase';

const CHAIN_LABELS: Record<string, string> = {
  cinepolis: 'Cinépolis',
  cinecolombia: 'Cine Colombia',
  cinemark: 'Cinemark',
  procinal: 'Procinal',
};

function formatTime(isoStr: string) {
  return new Date(isoStr).toLocaleTimeString('es-CO', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

export default function ScreeningsClient({ screenings }: { screenings: Screening[] }) {
  // Derive available chains and cities from the data
  const chains = Array.from(
    new Set(screenings.map((s) => (s.cinemas as any)?.chain).filter(Boolean))
  ) as string[];
  const cities = Array.from(
    new Set(
      screenings
        .map((s) => (s.cinemas as any)?.cities?.slug)
        .filter(Boolean)
    )
  ) as string[];

  const [chainFilter, setChainFilter] = useState('');
  const [cityFilter, setCityFilter] = useState('');

  const filtered = screenings.filter((s) => {
    const cinema = s.cinemas as any;
    if (chainFilter && cinema?.chain !== chainFilter) return false;
    if (cityFilter && cinema?.cities?.slug !== cityFilter) return false;
    return true;
  });

  // Group: chain → sede → format|language → screenings
  const grouped: Record<string, Record<string, Record<string, Screening[]>>> = {};
  for (const s of filtered) {
    const cinema = s.cinemas as any;
    const chain: string = cinema?.chain ?? 'other';
    const sede: string = cinema?.name ?? 'Cine';
    const classification = `${s.format} | ${s.language}`;

    grouped[chain] ??= {};
    grouped[chain][sede] ??= {};
    grouped[chain][sede][classification] ??= [];
    grouped[chain][sede][classification].push(s);
  }

  if (screenings.length === 0) {
    return (
      <div
        className="empty-state"
        style={{ border: '1px solid var(--border)', borderRadius: '12px' }}
      >
        <div className="icon">😢</div>
        <h3>No hay funciones registradas hoy</h3>
        <p>Aún no tenemos los horarios de esta película para el día de hoy.</p>
      </div>
    );
  }

  return (
    <div>
      {/* Filters */}
      {(chains.length > 1 || cities.length > 1) && (
        <div className="filters-row" style={{ marginBottom: '24px', flexWrap: 'wrap' }}>
          {chains.length > 1 && (
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <button
                className={`filter-chip ${chainFilter === '' ? 'active' : ''}`}
                onClick={() => setChainFilter('')}
              >
                🎭 Todas las cadenas
              </button>
              {chains.map((c) => (
                <button
                  key={c}
                  className={`filter-chip ${chainFilter === c ? 'active' : ''}`}
                  onClick={() => setChainFilter(chainFilter === c ? '' : c)}
                >
                  {CHAIN_LABELS[c] ?? c}
                </button>
              ))}
            </div>
          )}
          {cities.length > 1 && (
            <select
              className="filter-select"
              value={cityFilter}
              onChange={(e) => setCityFilter(e.target.value)}
              aria-label="Filtrar por ciudad"
            >
              <option value="">🌎 Todas las ciudades</option>
              {cities.map((slug) => {
                const name = screenings.find(
                  (s) => (s.cinemas as any)?.cities?.slug === slug
                );
                return (
                  <option key={slug} value={slug}>
                    {(name?.cinemas as any)?.cities?.name ?? slug}
                  </option>
                );
              })}
            </select>
          )}
        </div>
      )}

      {/* Grouped list */}
      {Object.keys(grouped).length === 0 ? (
        <div
          className="empty-state"
          style={{ border: '1px solid var(--border)', borderRadius: '12px' }}
        >
          <div className="icon">🔍</div>
          <h3>Sin funciones con estos filtros</h3>
          <p>Prueba con otra cadena o ciudad.</p>
        </div>
      ) : (
        Object.entries(grouped).map(([chain, sedes]) => (
          <div key={chain} className="chain-group" style={{ marginBottom: '32px' }}>
            {/* Chain header */}
            <div
              className="chain-header"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                marginBottom: '16px',
                paddingBottom: '10px',
                borderBottom: '1px solid var(--border)',
              }}
            >
              <h3
                style={{
                  fontSize: '1rem',
                  fontWeight: 700,
                  color: 'var(--gold)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                  margin: 0,
                }}
              >
                {CHAIN_LABELS[chain] ?? chain}
              </h3>
              <span
                style={{
                  fontSize: '0.75rem',
                  color: 'var(--text-muted)',
                  background: 'rgba(255,255,255,0.06)',
                  borderRadius: '20px',
                  padding: '2px 10px',
                }}
              >
                {Object.keys(sedes).length} sede{Object.keys(sedes).length !== 1 ? 's' : ''}
              </span>
            </div>

            {/* Sedes */}
            <div className="cinema-group-list">
              {Object.entries(sedes).map(([sedeName, classifications]) => {
                const firstScreening = Object.values(classifications).flat()[0] as any;
                const cityName = firstScreening?.cinemas?.cities?.name;

                return (
                  <div key={sedeName} className="cinema-block">
                    <div className="cinema-block-header">
                      <h4
                        className="cinema-name"
                        style={{ fontSize: '0.95rem', fontWeight: 600 }}
                      >
                        {sedeName}
                      </h4>
                      {cityName && (
                        <span className="cinema-location">{cityName.toUpperCase()}</span>
                      )}
                    </div>

                    {Object.entries(classifications).map(([classification, times]) => (
                      <div key={classification} className="showtime-group">
                        <div className="showtime-classification">
                          {classification.split('|').map((tag) => (
                            <span key={tag} className="tag-pill">
                              {tag.trim().toUpperCase()}
                            </span>
                          ))}
                        </div>
                        <div className="showtime-grid">
                          {times.map((t) =>
                            t.buy_url ? (
                              <a
                                key={t.id}
                                href={t.buy_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="time-bubble"
                                style={{ textDecoration: 'none' }}
                              >
                                <span className="hour">{formatTime(t.start_time)}</span>
                              </a>
                            ) : (
                              <div key={t.id} className="time-bubble">
                                <span className="hour">{formatTime(t.start_time)}</span>
                              </div>
                            )
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
