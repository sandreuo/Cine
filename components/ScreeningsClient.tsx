'use client';

import { useState } from 'react';
import type { Screening } from '@/lib/supabase';

const CHAIN_LABELS: Record<string, string> = {
  cinepolis: 'Cinépolis',
  cinecolombia: 'Cine Colombia',
  cinemark: 'Cinemark',
  procinal: 'Procinal',
};

const LANG_LABELS: Record<string, string> = {
  subtitulada: 'Subtitulada',
  doblada: 'Doblada',
  original: 'Original',
};

function formatTime(isoStr: string) {
  return new Date(isoStr).toLocaleTimeString('es-CO', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

function formatDate(isoStr: string) {
  return new Date(isoStr).toLocaleDateString('es-CO', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
}

interface SelectedScreening {
  id: number;
  start_time: string;
  format: string;
  language: string;
  buy_url: string | null;
  sedeName: string;
  cityName: string;
}

interface Props {
  screenings: Screening[];
  movieTitle: string;
  movieSlug: string;
}

export default function ScreeningsClient({ screenings, movieTitle, movieSlug }: Props) {
  const chains = Array.from(
    new Set(screenings.map((s) => (s.cinemas as any)?.chain).filter(Boolean))
  ) as string[];
  const cities = Array.from(
    new Set(screenings.map((s) => (s.cinemas as any)?.cities?.slug).filter(Boolean))
  ) as string[];

  const [chainFilter, setChainFilter] = useState('');
  const [cityFilter, setCityFilter] = useState('');
  const [selected, setSelected] = useState<SelectedScreening | null>(null);

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
    const classification = `${s.format}|${s.language}`;
    grouped[chain] ??= {};
    grouped[chain][sede] ??= {};
    grouped[chain][sede][classification] ??= [];
    grouped[chain][sede][classification].push(s);
  }

  function handleSelect(t: Screening, sedeName: string, cityName: string) {
    if (selected?.id === t.id) {
      setSelected(null);
      return;
    }
    setSelected({
      id: t.id,
      start_time: t.start_time,
      format: t.format,
      language: t.language,
      buy_url: t.buy_url,
      sedeName,
      cityName,
    });
  }

  function buildWhatsAppUrl(s: SelectedScreening) {
    const time = formatTime(s.start_time);
    const date = formatDate(s.start_time);
    const lang = LANG_LABELS[s.language] ?? s.language;
    const url = `https://cinehoy.co/pelicula/${movieSlug}`;

    const msg =
      `🎬 *${movieTitle}*\n\n` +
      `📍 *${s.sedeName}*\n` +
      `📅 ${date} · ${time}\n` +
      `🎥 ${s.format} · ${lang}\n\n` +
      `¿Nos vamos? 🍿\n` +
      `👉 ${url}`;

    return `https://wa.me/?text=${encodeURIComponent(msg)}`;
  }

  if (screenings.length === 0) {
    return (
      <div className="empty-state" style={{ border: '1px solid var(--border)', borderRadius: '12px' }}>
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
                const match = screenings.find((s) => (s.cinemas as any)?.cities?.slug === slug);
                return (
                  <option key={slug} value={slug}>
                    {(match?.cinemas as any)?.cities?.name ?? slug}
                  </option>
                );
              })}
            </select>
          )}
        </div>
      )}

      {/* Grouped list */}
      {Object.keys(grouped).length === 0 ? (
        <div className="empty-state" style={{ border: '1px solid var(--border)', borderRadius: '12px' }}>
          <div className="icon">🔍</div>
          <h3>Sin funciones con estos filtros</h3>
          <p>Prueba con otra cadena o ciudad.</p>
        </div>
      ) : (
        Object.entries(grouped).map(([chain, sedes]) => (
          <div key={chain} className="chain-group" style={{ marginBottom: '32px' }}>
            {/* Chain header */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: '10px',
              marginBottom: '16px', paddingBottom: '10px', borderBottom: '1px solid var(--border)',
            }}>
              <h3 style={{
                fontSize: '1rem', fontWeight: 700, color: 'var(--gold)',
                textTransform: 'uppercase', letterSpacing: '0.06em', margin: 0,
              }}>
                {CHAIN_LABELS[chain] ?? chain}
              </h3>
              <span style={{
                fontSize: '0.75rem', color: 'var(--text-muted)',
                background: 'rgba(255,255,255,0.06)', borderRadius: '20px', padding: '2px 10px',
              }}>
                {Object.keys(sedes).length} sede{Object.keys(sedes).length !== 1 ? 's' : ''}
              </span>
            </div>

            {/* Sedes */}
            <div className="cinema-group-list">
              {Object.entries(sedes).map(([sedeName, classifications]) => {
                const firstScreening = Object.values(classifications).flat()[0] as any;
                const cityName = firstScreening?.cinemas?.cities?.name ?? '';

                return (
                  <div key={sedeName} className="cinema-block">
                    <div className="cinema-block-header">
                      <h4 className="cinema-name" style={{ fontSize: '0.95rem', fontWeight: 600 }}>
                        {sedeName}
                      </h4>
                      {cityName && (
                        <span className="cinema-location">{cityName.toUpperCase()}</span>
                      )}
                    </div>

                    {Object.entries(classifications).map(([classification, times]) => {
                      const [fmt, lang] = classification.split('|');
                      return (
                        <div key={classification} className="showtime-group">
                          <div className="showtime-classification">
                            <span className="tag-pill">{fmt.trim().toUpperCase()}</span>
                            <span className="tag-pill">{(LANG_LABELS[lang.trim()] ?? lang.trim()).toUpperCase()}</span>
                          </div>
                          <div className="showtime-grid">
                            {times.map((t) => {
                              const isSelected = selected?.id === t.id;
                              return (
                                <button
                                  key={t.id}
                                  className="time-bubble"
                                  onClick={() => handleSelect(t, sedeName, cityName)}
                                  style={{
                                    cursor: 'pointer',
                                    border: isSelected ? '2px solid var(--gold)' : undefined,
                                    background: isSelected ? 'rgba(212,175,55,0.12)' : undefined,
                                    outline: 'none',
                                  }}
                                  aria-pressed={isSelected}
                                >
                                  <span className="hour">{formatTime(t.start_time)}</span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        ))
      )}

      {/* Share panel — sticky bottom */}
      {selected && (
        <div style={{
          position: 'fixed',
          bottom: 0, left: 0, right: 0,
          background: 'var(--bg-card)',
          borderTop: '1px solid var(--border)',
          padding: '20px 24px 28px',
          zIndex: 100,
          boxShadow: '0 -8px 32px rgba(0,0,0,0.5)',
        }}>
          <div style={{ maxWidth: '640px', margin: '0 auto' }}>
            {/* Summary */}
            <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '6px' }}>
              Función seleccionada
            </p>
            <p style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--text-primary)', marginBottom: '2px' }}>
              {selected.sedeName}
            </p>
            <p style={{ fontSize: '0.88rem', color: 'var(--text-secondary)', marginBottom: '16px' }}>
              {formatDate(selected.start_time)} · {formatTime(selected.start_time)} · {selected.format} · {LANG_LABELS[selected.language] ?? selected.language}
            </p>

            {/* Actions */}
            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
              <a
                href={buildWhatsAppUrl(selected)}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-whatsapp"
                style={{ flex: 1, minWidth: '180px', textAlign: 'center' }}
              >
                📱 Compartir por WhatsApp
              </a>
              <button
                onClick={() => setSelected(null)}
                style={{
                  padding: '12px 20px', borderRadius: 'var(--radius)',
                  background: 'transparent', border: '1px solid var(--border)',
                  color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.9rem',
                }}
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Spacer so last items aren't hidden behind the panel */}
      {selected && <div style={{ height: '160px' }} />}
    </div>
  );
}
