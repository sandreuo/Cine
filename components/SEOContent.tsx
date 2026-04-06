export default function SEOContent() {
  const faqs = [
    {
      question: '¿Qué es CineHoy y qué cadenas de cine incluye?',
      answer: 'CineHoy es un agregador gratuito de cartelera cinematográfica para Colombia. Reúne en un solo lugar los horarios de Cinépolis, Cine Colombia, Cinemark y Procinal, actualizados automáticamente varias veces al día para que siempre veas la cartelera en tiempo real.',
    },
    {
      question: '¿En qué ciudades de Colombia está disponible CineHoy?',
      answer: 'CineHoy cubre las principales ciudades de Colombia: Bogotá, Medellín, Cali, Barranquilla, Bucaramanga, Cartagena, Pereira, Manizales, Cúcuta, Villavicencio, Ibagué, Montería, Armenia y muchas más. Si hay cines de las cadenas principales en tu ciudad, los encontrarás aquí.',
    },
    {
      question: '¿Con qué frecuencia se actualizan los horarios?',
      answer: 'Los horarios se actualizan automáticamente varias veces al día directamente desde las APIs oficiales de cada cadena. Mostramos funciones para hoy y los próximos 4 días, así puedes planear con anticipación.',
    },
    {
      question: '¿Cómo saber qué cines están cerca de mí?',
      answer: 'Contamos con un filtro inteligente de geolocalización. Al presionar el botón "Cines cerca de mí", calculamos cuáles son los cines de tu ciudad más próximos a tu ubicación actual. Solo necesitas permitir el acceso a tu ubicación en el navegador.',
    },
    {
      question: '¿CineHoy cobra o está afiliado a las cadenas de cine?',
      answer: 'No. Somos un proyecto 100% independiente y gratuito. Los enlaces de compra de boletas te dirigen directamente al sitio oficial de cada cadena. No cobramos comisiones ni tenemos afiliación con ninguna cadena cinematográfica.',
    },
    {
      question: '¿Cómo compartir una película para ir en grupo?',
      answer: 'Cada película en CineHoy tiene un botón "Compartir por WhatsApp" que genera automáticamente un mensaje con el título, horarios y enlace directo. Perfecto para mandar al grupo de amigos, a la familia o a tu pareja.',
    },
    {
      question: '¿Puedo filtrar por formato como IMAX, 4DX o 3D?',
      answer: 'Sí. CineHoy muestra el formato de cada función (2D, 3D, IMAX, 4DX, XD) y si es subtitulada o doblada, para que elijas exactamente la experiencia que quieres.',
    },
    {
      question: '¿Dónde puedo comprar las boletas?',
      answer: 'CineHoy no vende boletas directamente. Al hacer clic en un horario, te llevamos al sitio oficial de la cadena (Cinépolis, Cine Colombia, Cinemark o Procinal) donde puedes comprar tus entradas de forma segura.',
    },
  ];

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map((faq) => ({
      '@type': 'Question',
      name: faq.question,
      acceptedAnswer: { '@type': 'Answer', text: faq.answer },
    })),
  };

  const CITIES = [
    'Bogotá', 'Medellín', 'Cali', 'Barranquilla', 'Bucaramanga',
    'Cartagena', 'Pereira', 'Manizales', 'Cúcuta', 'Villavicencio',
  ];

  return (
    <section className="seo-content" style={{ marginTop: '64px', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '48px', paddingBottom: '48px' }}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <div style={{ maxWidth: '860px', margin: '0 auto', padding: '0 20px' }}>

        {/* Main pitch */}
        <h2 style={{ fontSize: '1.8rem', color: 'var(--gold)', marginBottom: '16px' }}>
          Toda la cartelera de cine en Colombia, en un solo lugar
        </h2>
        <p style={{ color: 'var(--text-secondary)', lineHeight: 1.7, marginBottom: '24px' }}>
          CineHoy nació de una frustración muy colombiana: para saber qué hay en cine hoy toca abrir cuatro páginas diferentes,
          esperar que carguen, y al final tomar pantallazos para mandar al grupo de WhatsApp.
          Nosotros centralizamos la cartelera de <strong>Cinépolis, Cine Colombia, Cinemark y Procinal</strong> en una sola
          vista rápida, con horarios actualizados automáticamente varias veces al día.
        </p>

        {/* Cities grid */}
        <h3 style={{ fontSize: '1.1rem', color: 'var(--text-primary)', marginBottom: '16px' }}>
          Cartelera disponible en estas ciudades
        </h3>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', marginBottom: '40px' }}>
          {CITIES.map((city) => (
            <a
              key={city}
              href={`/${city.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '-')}`}
              style={{
                padding: '6px 16px',
                borderRadius: '20px',
                border: '1px solid var(--border)',
                color: 'var(--text-secondary)',
                fontSize: '0.875rem',
                background: 'rgba(255,255,255,0.03)',
              }}
            >
              Cine en {city}
            </a>
          ))}
        </div>

        {/* FAQs */}
        <h3 style={{ fontSize: '1.4rem', color: 'var(--text-primary)', marginBottom: '24px' }}>
          Preguntas frecuentes sobre CineHoy
        </h3>
        <div style={{ display: 'grid', gap: '16px', marginBottom: '40px' }}>
          {faqs.map((faq, index) => (
            <div key={index} style={{ background: 'rgba(255,255,255,0.02)', padding: '20px 24px', borderRadius: '12px', borderLeft: '3px solid var(--accent)' }}>
              <h4 style={{ color: 'var(--text-primary)', fontSize: '1rem', marginBottom: '8px', fontWeight: 600 }}>
                {faq.question}
              </h4>
              <p style={{ color: 'var(--text-secondary)', lineHeight: 1.6, fontSize: '0.9rem', margin: 0 }}>
                {faq.answer}
              </p>
            </div>
          ))}
        </div>

        {/* Footer note */}
        <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', lineHeight: 1.6 }}>
          CineHoy es un servicio independiente de información sobre cartelera cinematográfica en Colombia.
          No estamos afiliados con Cinépolis, Cine Colombia, Cinemark ni Procinal.
          Los horarios se obtienen automáticamente y se actualizan varias veces al día.
        </p>
      </div>
    </section>
  );
}
