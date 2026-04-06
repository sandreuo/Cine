'use client';

import Link from 'next/link';

const CHAINS = [
  { key: 'cinepolis', label: 'Cinépolis' },
  { key: 'cinecolombia', label: 'Cine Colombia' },
  { key: 'cinemark', label: 'Cinemark' },
  { key: 'procinal', label: 'Procinal' },
];

export default function Footer() {
  return (
    <footer className="footer">
      <div className="container">
        <div className="footer-inner">
          <Link href="/" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: '1.4rem' }}>🎬</span>
            <span style={{ fontWeight: 800, fontSize: '1.2rem', color: 'var(--gold)' }}>
              CineHoy<span style={{ color: 'var(--text-secondary)', fontWeight: 400 }}>.co</span>
            </span>
          </Link>

          <p className="footer-love">
            Proyecto gratuito desarrollado con <span className="heart">♥</span> para los colombianos por{' '}
            <strong>Santiago Andreu</strong>.<br />
            Porque ir al cine no debería ser una odisea.
          </p>

          <div style={{ background: 'rgba(255,255,255,0.03)', padding: '24px', borderRadius: '16px', maxWidth: '500px', width: '100%', margin: '16px 0', border: '1px solid var(--border)' }}>
            <h3 style={{ fontSize: '1rem', marginBottom: '8px', color: 'var(--gold)' }}>☕ ¿Te sirvió la página? </h3>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '16px', lineHeight: 1.5 }}>
              CineHoy.co es 100% gratuito. Si te ahorramos tiempo buscando horarios y cartelera, y quieres apoyarnos a cubrir los costos de los servidores, puedes hacerlo aquí:
            </p>
            <a href="https://paypal.me/sandreu17" target="_blank" rel="noopener noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', background: '#0070ba', color: 'white', padding: '10px 24px', borderRadius: '40px', fontWeight: 600, fontSize: '0.9rem', marginBottom: '8px' }}>
              <span>Apoyar en PayPal</span>
            </a>
          </div>

          <div style={{ maxWidth: '400px', width: '100%', marginBottom: '24px' }}>
            <h4 style={{ fontSize: '0.9rem', marginBottom: '8px' }}>💬 Envíanos tus comentarios</h4>
            <form action="mailto:sandreuo@gmail.com" method="GET" encType="text/plain" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <input type="hidden" name="subject" value="Feedback CineHoy.co" />
              <textarea name="body" placeholder="¿Cómo podemos mejorar CineHoy.co?" rows={3} style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-primary)', fontFamily: 'inherit', fontSize: '0.875rem', outline: 'none', resize: 'vertical' }} required></textarea>
              <button type="submit" style={{ padding: '10px 16px', borderRadius: '8px', background: 'rgba(255,255,255,0.08)', color: 'var(--text-primary)', border: '1px solid var(--border)', fontWeight: 600, fontSize: '0.875rem', transition: 'all 0.2s', cursor: 'pointer' }} onMouseOver={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.12)'} onMouseOut={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.08)'}>
                Enviar Feedback
              </button>
            </form>
          </div>

          <div className="footer-chains">
            {CHAINS.map((c) => (
              <span key={c.key} className={`chain-badge ${c.key}`}>
                {c.label}
              </span>
            ))}
          </div>

          <div style={{ display: 'flex', gap: 24, marginBottom: 16, flexWrap: 'wrap' }}>
            <Link href="/nosotros" style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>Sobre CineHoy</Link>
            <Link href="/privacidad" style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>Política de privacidad</Link>
            <a href="mailto:sandreuo@gmail.com" style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>Contacto</a>
          </div>

          <p className="footer-disclaimer">
            CineHoy.co es un servicio independiente de información sobre cartelera cinematográfica en Colombia.
            No estamos afiliados con ninguna cadena de cines. Los horarios son actualizados automáticamente y
            pueden no reflejar cambios de última hora. Para comprar boletos visita el sitio oficial de cada cine.
          </p>
        </div>
      </div>
    </footer>
  );
}
