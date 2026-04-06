import type { Metadata } from 'next';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Sobre CineHoy | CineHoy',
  description: 'Conoce qué es CineHoy.co, cómo funciona y quién está detrás del proyecto.',
  alternates: { canonical: 'https://cinehoyap.app/nosotros' },
};

export default function NosotrosPage() {
  return (
    <>
      <Header />
      <main style={{ maxWidth: 760, margin: '0 auto', padding: '48px 24px 80px' }}>
        <Link href="/" style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 32 }}>
          ← Volver al inicio
        </Link>

        <h1 style={{ fontSize: '2rem', fontWeight: 800, marginBottom: 16, color: 'var(--text-primary)' }}>
          Sobre CineHoy
        </h1>

        <p style={{ color: 'var(--text-secondary)', lineHeight: 1.8, fontSize: '1rem', marginBottom: 40 }}>
          CineHoy.co nació de una frustración muy colombiana: buscar la cartelera del cine y tener que entrar a 4 sitios diferentes para saber qué están pasando y a qué hora.
        </p>

        <Section title="¿Qué es CineHoy?">
          <p>CineHoy.co es un agregador gratuito de cartelera cinematográfica para Colombia. Reunimos en un solo lugar los horarios de las principales cadenas del país: <strong>Cinépolis, Cine Colombia, Cinemark y Procinal</strong>.</p>
          <p style={{ marginTop: 12 }}>Puedes buscar por película, por ciudad o por cine — y ver todos los horarios disponibles de los próximos 4 días sin tener que saltar entre sitios.</p>
        </Section>

        <Section title="¿Cómo funciona?">
          <p>Varias veces al día, CineHoy actualiza automáticamente los horarios directamente desde las APIs y sitios oficiales de cada cadena. Los datos se procesan y almacenan para que puedas consultarlos de forma rápida y sin anuncios intrusivos.</p>
          <p style={{ marginTop: 12 }}>También usamos <strong>TMDB</strong> (The Movie Database) para enriquecer la información de cada película con poster, trailer y fecha de estreno oficial.</p>
        </Section>

        <Section title="¿Quién lo hace?">
          <p>CineHoy es un proyecto personal desarrollado por <strong>Santiago Andreu</strong>, un colombiano que ama el cine y odia los sitios lentos.</p>
          <p style={{ marginTop: 12 }}>Es un proyecto 100% independiente, sin afiliación con ninguna cadena de cines. Si te ha sido útil y quieres apoyar los costos del servidor, puedes hacerlo desde el footer de la página.</p>
        </Section>

        <Section title="Contacto">
          <p>¿Encontraste un error en los horarios? ¿Tienes una sugerencia? Escríbenos a <a href="mailto:sandreuo@gmail.com" style={{ color: 'var(--gold)' }}>sandreuo@gmail.com</a> o usa el formulario en el pie de página.</p>
        </Section>

        <div style={{ marginTop: 48, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          <Link href="/" style={{ padding: '12px 24px', background: 'var(--gold)', color: '#000', borderRadius: 40, fontWeight: 700, fontSize: '0.9rem' }}>
            Ver cartelera
          </Link>
          <Link href="/privacidad" style={{ padding: '12px 24px', background: 'rgba(255,255,255,0.06)', color: 'var(--text-primary)', borderRadius: 40, fontWeight: 600, fontSize: '0.9rem', border: '1px solid var(--border)' }}>
            Política de privacidad
          </Link>
        </div>
      </main>
      <Footer />
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 36 }}>
      <h2 style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--gold)', marginBottom: 12 }}>{title}</h2>
      <div style={{ color: 'var(--text-secondary)', lineHeight: 1.7, fontSize: '0.95rem' }}>
        {children}
      </div>
    </section>
  );
}
