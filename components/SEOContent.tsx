export default function SEOContent() {
  const faqs = [
    {
      question: "¿Qué es CineHoy.co y por qué lo creamos?",
      answer: "CineHoy nace de la frustración de tener que abrir múltiples páginas web lentas para saber qué películas hay disponibles. Nuestra misión es centralizar la cartelera de Cinemark, Cine Colombia, Cinépolis y Procinal en un solo lugar, súper rápido y sin publicidad invasiva, para agilizar tus planes con amigos."
    },
    {
      question: "¿Cómo saber qué cines están cerca de mí?",
      answer: "Contamos con un filtro inteligente de geolocalización. Al presionar el botón 'Cines cerca de mí', calculamos cuáles son los cines de tu ciudad que quedan más próximos a tu ubicación actual basándonos en coordenadas."
    },
    {
      question: "¿CineHoy cobra o está afiliado a las cadenas de cine?",
      answer: "No. Somos una herramienta 100% independiente y gratuita desarrollada para los colombianos. Los enlaces de compra te dirigen directamente a la página oficial de la cadena de cines responsable sin comisiones de nuestra parte."
    },
    {
      question: "¿Cómo compartir una película para ir en grupo?",
      answer: "Cada película en CineHoy cuenta con un botón especial de 'Invitar por WhatsApp' que automáticamente genera un mensaje claro con los horarios y el tráiler, ideal para mandar al grupo de amigos o a tu pareja."
    }
  ];

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "mainEntity": faqs.map(faq => ({
      "@type": "Question",
      "name": faq.question,
      "acceptedAnswer": {
        "@type": "Answer",
        "text": faq.answer
      }
    }))
  };

  return (
    <section className="seo-content" style={{ marginTop: '64px', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '48px', paddingBottom: '32px' }}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      
      <div style={{ maxWidth: '800px', margin: '0 auto', padding: '0 20px' }}>
        <h2 style={{ fontSize: '1.8rem', color: 'var(--gold)', marginBottom: '16px' }}>
          La historia detrás de CineHoy 🍿
        </h2>
        <p style={{ color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: '40px' }}>
          Nos dimos cuenta de que organizar un plan de cine era más difícil de lo que debería. 
          Entrar a la página de cada cine en Colombia por separado y tomar pantallazos para compartir en WhatsApp 
          es un proceso del pasado. CineHoy agrupa toda la cartelera nacional para que con un par de toques encuentres 
          esa película, escojas horario en tu cine favorito o el más cercano, y compartas el plan en un instante.
        </p>

        <h3 style={{ fontSize: '1.4rem', color: 'var(--text-primary)', marginBottom: '24px' }}>
          Preguntas Frecuentes
        </h3>
        <div style={{ display: 'grid', gap: '24px' }}>
          {faqs.map((faq, index) => (
            <div key={index} style={{ background: 'rgba(255,255,255,0.02)', padding: '24px', borderRadius: '12px' }}>
              <h4 style={{ color: 'var(--accent)', fontSize: '1.1rem', marginBottom: '8px' }}>
                {faq.question}
              </h4>
              <p style={{ color: 'var(--text-secondary)', lineHeight: 1.5, fontSize: '0.95rem' }}>
                {faq.answer}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
