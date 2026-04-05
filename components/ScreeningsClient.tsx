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
    hour: '2-digit', minute: '2-digit', hour12: true,
  });
}

function formatDate(isoStr: string) {
  return new Date(isoStr).toLocaleDateString('es-CO', {
    weekday: 'long', day: 'numeric', month: 'long',
  });
}

interface SelectedScreening {
  id: number;
  start_time: string;
  format: string;
  language: string;
  sedeName: string;
  cityName: string;
}

interface Props {
  screenings: Screening[];
  movieTitle: string;
  movieSlug: string;
  releaseDate?: string | null;
}

export default function ScreeningsClient({ screenings, movieTitle, movieSlug, releaseDate }: Props) {
  const chains = Array.from(
    new Set(screenings.map((s) => (s.cinemas as any)?.chain).filter(Boolean))
  ) as string[];
  const cities = Array.from(
    new Set(screenings.map((s) => (s.cinemas as any)?.cities?.slug).filter(Boolean))
  ) as string[];

  const [chainFilter, setChainFilter] = useState('');
  const [cityFilter, setCityFilter] = useState('');
  const [selected, setSelected] = useState<SelectedScreening | null>(null);

  // Collapsible state: chain → expanded; sede → expanded
  const [collapsedChains, setCollapsedChains] = useState<Record<string, boolean>>({});
  const [collapsedSedes, setCollapsedSedes] = useState<Record<string, boolean>>({});

  const toggleChain = (chain: string) =>
    setCollapsedChains((prev) => ({ ...prev, [chain]: !prev[chain] }));
  const toggleSede = (key: string) =>
    setCollapsedSedes((prev) => ({ ...prev, [key]: !prev[key] }));

  const filtered = screenings.filter((s) => {
    const c = s.cinemas as any;
    if (chainFilter && c?.chain !== chainFilter) return false;
    if (cityFilter && c?.cities?.slug !== cityFilter) return false;
    return true;
  });

  const grouped: Record<string, Record<string, Record<string, Screening[]>>> = {};
  for (const s of filtered) {
    const c = s.cinemas as any;
    const chain: string = c?.chain ?? 'other';
    const sede: string = c?.name ?? 'Cine';
    const cls = `${s.format}|${s.language}`;
    grouped[chain] ??= {};
    grouped[chain][sede] ??= {};
    grouped[chain][sede][cls] ??= [];
    grouped[chain][sede][cls].push(s);
  }

  function handleSelect(t: Screening, sedeName: string, cityName: string) {
    if (selected?.id === t.id) { setSelected(null); return; }
    setSelected({ id: t.id, start_time: t.start_time, format: t.format, language: t.language, sedeName, cityName });
  }

  function buildWaUrl(s: SelectedScreening) {
    const lang = LANG_LABELS[s.language] ?? s.language;
    const msg =
      `🎬 *${movieTitle}*\n\n` +
      `📍 *${s.sedeName}*\n` +
      `📅 ${formatDate(s.start_time)} · ${formatTime(s.start_time)}\n` +
      `🎥 ${s.format} · ${lang}\n\n` +
      `¿Nos vamos? 🍿\n` +
      `👉 https://cinehoy.co/pelicula/${movieSlug}`;
    return `https://wa.me/?text=${encodeURIComponent(msg)}`;
  }

  if (screenings.length === 0) {
    const isPresale = releaseDate && new Date(releaseDate) > new Date();
    
    return (
      <div className="empty-state" style={{ border: '1px solid var(--border)', borderRadius: '12px' }}>
        <div className="icon">{isPresale ? '🎫' : '😢'}</div>
        <h3>{isPresale ? '¡Próximamente en Preventa!' : 'No hay funciones registradas hoy'}</h3>
        <p>
          {isPresale 
            ? `Esta película se estrenará el ${new Date(releaseDate!).toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' })}. ¡Pronto tendremos funciones!` 
            : 'Aún no tenemos los horarios de esta película para el día de hoy.'}
        </p>
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
              <button className={`filter-chip ${chainFilter === '' ? 'active' : ''}`} onClick={() => setChainFilter('')}>
                🎭 Todas las cadenas
              </button>
              {chains.map((c) => (
                <button key={c} className={`filter-chip ${chainFilter === c ? 'active' : ''}`}
                  onClick={() => setChainFilter(chainFilter === c ? '' : c)}>
                  {CHAIN_LABELS[c] ?? c}
                </button>
              ))}
            </div>
          )}
          {cities.length > 1 && (
            <select className="filter-select" value={cityFilter}
              onChange={(e) => setCityFilter(e.target.value)} aria-label="Filtrar por ciudad">
              <option value="">🌎 Todas las ciudades</option>
              {cities.map((slug) => {
                const match = screenings.find((s) => (s.cinemas as any)?.cities?.slug === slug);
                return <option key={slug} value={slug}>{(match?.cinemas as any)?.cities?.name ?? slug}</option>;
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
        Object.entries(grouped).map(([chain, sedes]) => {
          const chainCollapsed = collapsedChains[chain] ?? false;
          const sedeCount = Object.keys(sedes).length;
          const totalFunctions = Object.values(sedes)
            .flatMap((cls) => Object.values(cls))
            .flat().length;

          return (
            <div key={chain} style={{ marginBottom: '24px' }}>
              {/* Chain header — clickable */}
              <button
                onClick={() => toggleChain(chain)}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: '10px',
                  marginBottom: chainCollapsed ? 0 : '16px',
                  paddingBottom: '10px',
                  background: 'none', border: 'none', borderBottom: '1px solid var(--border)',
                  cursor: 'pointer', textAlign: 'left',
                }}
              >
                <span style={{
                  fontSize: '0.95rem', fontWeight: 700, color: 'var(--gold)',
                  textTransform: 'uppercase', letterSpacing: '0.06em', flex: 1,
                }}>
                  {CHAIN_LABELS[chain] ?? chain}
                </span>
                <span style={{
                  fontSize: '0.72rem', color: 'var(--text-muted)',
                  background: 'rgba(255,255,255,0.06)', borderRadius: '20px', padding: '2px 10px',
                }}>
                  {sedeCount} sede{sedeCount !== 1 ? 's' : ''} · {totalFunctions} funciones
                </span>
                <span style={{ color: 'var(--gold)', fontSize: '0.8rem', marginLeft: '4px' }}>
                  {chainCollapsed ? '▶' : '▼'}
                </span>
              </button>

              {/* Sedes */}
              {!chainCollapsed && (
                <div className="cinema-group-list">
                  {Object.entries(sedes).map(([sedeName, classifications]) => {
                    const sedeKey = `${chain}::${sedeName}`;
                    const sedeCollapsed = collapsedSedes[sedeKey] ?? false;
                    const firstScreening = Object.values(classifications).flat()[0] as any;
                    const cityName = firstScreening?.cinemas?.cities?.name ?? '';
                    const sedeTotal = Object.values(classifications).flat().length;

                    return (
                      <div key={sedeName} className="cinema-block" style={{ overflow: 'hidden' }}>
                        {/* Sede header — clickable */}
                        <button
                          onClick={() => toggleSede(sedeKey)}
                          className="cinema-block-header"
                          style={{
                            width: '100%', background: 'none', border: 'none',
                            cursor: 'pointer', textAlign: 'left', display: 'flex',
                            alignItems: 'center',
                          }}
                        >
                          <h4 className="cinema-name" style={{ fontSize: '0.95rem', fontWeight: 600, flex: 1, margin: 0, color: 'var(--gold)' }}>
                            {sedeName}
                          </h4>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            {cityName && <span className="cinema-location" style={{ color: 'var(--text-secondary)' }}>{cityName.toUpperCase()}</span>}
                            <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
                              {sedeTotal} func.
                            </span>
                            <span style={{ color: 'var(--gold)', fontSize: '0.75rem' }}>
                              {sedeCollapsed ? '▶' : '▼'}
                            </span>
                          </div>
                        </button>

                        {/* Showtimes */}
                        {!sedeCollapsed && Object.entries(classifications).map(([cls, times]) => {
                          const [fmt, lang] = cls.split('|');
                          return (
                            <div key={cls} className="showtime-group">
                              <div className="showtime-classification">
                                <span className="tag-pill">{fmt.trim().toUpperCase()}</span>
                                <span className="tag-pill">{(LANG_LABELS[lang.trim()] ?? lang.trim()).toUpperCase()}</span>
                              </div>
                              <div className="showtime-grid">
                                {times.map((t) => {
                                  const isSel = selected?.id === t.id;
                                  return (
                                    <button key={t.id} className="time-bubble"
                                      onClick={() => handleSelect(t, sedeName, cityName)}
                                      style={{
                                        cursor: 'pointer', outline: 'none',
                                        border: isSel ? '2px solid var(--gold)' : undefined,
                                        background: isSel ? 'rgba(212,175,55,0.12)' : undefined,
                                      }}
                                      aria-pressed={isSel}>
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
              )}
            </div>
          );
        })
      )}

      {/* Share panel */}
      {selected && (
        <div style={{
          position: 'fixed', bottom: 0, left: 0, right: 0,
          background: 'var(--bg-card)', borderTop: '1px solid var(--border)',
          padding: '20px 24px 28px', zIndex: 100,
          boxShadow: '0 -8px 32px rgba(0,0,0,0.5)',
        }}>
          <div style={{ maxWidth: '640px', margin: '0 auto' }}>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '4px' }}>
              Función seleccionada
            </p>
            <p style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--text-primary)', marginBottom: '2px' }}>
              {selected.sedeName}
            </p>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '16px' }}>
              {formatDate(selected.start_time)} · {formatTime(selected.start_time)} · {selected.format} · {LANG_LABELS[selected.language] ?? selected.language}
            </p>
            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
              <a href={buildWaUrl(selected)} target="_blank" rel="noopener noreferrer"
                className="btn-whatsapp"
                style={{ flex: 1, minWidth: '180px', textAlign: 'center' }}>
                📱 Compartir por WhatsApp
              </a>
              <button onClick={() => setSelected(null)} style={{
                padding: '12px 20px', borderRadius: 'var(--radius)',
                background: 'transparent', border: '1px solid var(--border)',
                color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.9rem',
              }}>
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
      {selected && <div style={{ height: '160px' }} />}
    </div>
  );
}
