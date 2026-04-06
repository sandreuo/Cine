import type { Metadata } from 'next';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Política de Privacidad | CineHoy',
  description: 'Política de privacidad de CineHoy.co — cómo usamos tus datos y cookies.',
  alternates: { canonical: 'https://cinehoyap.app/privacidad' },
};

export default function PrivacidadPage() {
  return (
    <>
      <Header />
      <main style={{ maxWidth: 760, margin: '0 auto', padding: '48px 24px 80px' }}>
        <Link href="/" style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 32 }}>
          ← Volver al inicio
        </Link>

        <h1 style={{ fontSize: '2rem', fontWeight: 800, marginBottom: 8, color: 'var(--text-primary)' }}>
          Política de Privacidad
        </h1>
        <p style={{ color: 'var(--text-secondary)', marginBottom: 40, fontSize: '0.9rem' }}>
          Última actualización: abril 2025
        </p>

        <Section title="1. Quiénes somos">
          <p>CineHoy.co es un servicio independiente de información sobre cartelera cinematográfica en Colombia, desarrollado y operado por Santiago Andreu. No estamos afiliados con ninguna cadena de cines.</p>
        </Section>

        <Section title="2. Datos que recopilamos">
          <p>CineHoy.co <strong>no requiere registro</strong> ni recopila datos personales como nombre, correo electrónico o contraseñas.</p>
          <p style={{ marginTop: 12 }}>Recopilamos datos de uso anónimos a través de:</p>
          <ul style={{ marginTop: 8, paddingLeft: 20, lineHeight: 2 }}>
            <li><strong>Vercel Analytics:</strong> páginas visitadas, país de origen y tipo de dispositivo, de forma completamente anónima.</li>
            <li><strong>Google AdSense:</strong> muestra anuncios personalizados usando cookies. Puedes consultar la política de privacidad de Google en <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--gold)' }}>policies.google.com/privacy</a>.</li>
          </ul>
        </Section>

        <Section title="3. Cookies">
          <p>Usamos cookies de terceros para los anuncios mostrados por Google AdSense. Estas cookies permiten a Google mostrar anuncios relevantes basados en tus visitas anteriores a este y otros sitios.</p>
          <p style={{ marginTop: 12 }}>Puedes desactivar el uso de cookies en tu navegador o en <a href="https://adssettings.google.com" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--gold)' }}>adssettings.google.com</a>.</p>
        </Section>

        <Section title="4. Información de cartelera">
          <p>Los horarios y datos de películas se obtienen automáticamente de los sitios oficiales de las cadenas de cines (Cinépolis, Cine Colombia, Cinemark, Procinal). No almacenamos datos personales de los usuarios de dichas cadenas.</p>
        </Section>

        <Section title="5. Enlaces a terceros">
          <p>CineHoy.co incluye enlaces a los sitios oficiales de las cadenas de cines para la compra de boletos. No nos responsabilizamos por las prácticas de privacidad de esos sitios.</p>
        </Section>

        <Section title="6. Cambios a esta política">
          <p>Podemos actualizar esta política ocasionalmente. La fecha de última actualización aparece al inicio de esta página.</p>
        </Section>

        <Section title="7. Contacto">
          <p>Si tienes preguntas sobre esta política escríbenos a: <a href="mailto:sandreuo@gmail.com" style={{ color: 'var(--gold)' }}>sandreuo@gmail.com</a></p>
        </Section>
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
