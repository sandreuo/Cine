import { ResolvingMetadata } from 'next';
import { supabase } from '@/lib/supabase';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import HomeClient from '@/app/HomeClient';

export const revalidate = 3600;

const BASE_URL = 'https://cinehoyap.app';

export async function generateMetadata(
  { params }: { params: { ciudad: string } },
  _parent: ResolvingMetadata
) {
  const { data: city } = await supabase
    .from('cities')
    .select('name')
    .eq('slug', params.ciudad)
    .single();

  if (!city) return { title: 'No encontrada | CineHoy' };

  return {
    title: `Cartelera de Cine en ${city.name} Hoy — Horarios y Funciones`,
    description: `Consulta la cartelera y horarios de cine en ${city.name} hoy. Todas las funciones de Cinépolis, Cine Colombia, Cinemark y Procinal en ${city.name} actualizadas cada hora.`,
    alternates: { canonical: `${BASE_URL}/${params.ciudad}` },
    keywords: [
      `cartelera cine ${city.name}`,
      `cine hoy ${city.name}`,
      `horarios cine ${city.name}`,
      `funciones cine ${city.name} hoy`,
      `películas en ${city.name}`,
      `Cinépolis ${city.name}`,
      `Cine Colombia ${city.name}`,
      `Cinemark ${city.name}`,
    ],
    openGraph: {
      title: `Cartelera de Cine en ${city.name} Hoy — CineHoy`,
      description: `Todas las funciones de cine en ${city.name} hoy. Horarios de Cinépolis, Cine Colombia, Cinemark y Procinal.`,
      url: `${BASE_URL}/${params.ciudad}`,
    },
  };
}

export default async function CityPage({
  params,
  searchParams,
}: {
  params: { ciudad: string };
  searchParams: { q?: string };
}) {
  const { data: city } = await supabase
    .from('cities')
    .select('*')
    .eq('slug', params.ciudad)
    .single();

  if (!city) {
    return (
      <>
        <Header />
        <div className="empty-state" style={{ marginTop: '48px' }}>
          <div className="icon">❓</div>
          <h3>Ciudad no encontrada</h3>
          <p>No encontramos resultados para esta ciudad.</p>
        </div>
        <Footer />
      </>
    );
  }

  const today = new Date().toISOString().split('T')[0];

  const [{ data: movies }, { data: cities }] = await Promise.all([
    supabase.from('movies')
      .select('*, screenings!inner(id, cinemas!inner(cities!inner(slug)))')
      .eq('screenings.cinemas.cities.slug', params.ciudad)
      .gte('screenings.start_time', today + 'T00:00:00')
      .order('title'),
    supabase.from('cities').select('*').order('name'),
  ]);

  const uniqueMovies = Array.from(new Map((movies || []).map(m => [m.id, m])).values());

  const breadcrumbSchema = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'CineHoy', item: BASE_URL },
      { '@type': 'ListItem', position: 2, name: `Cine en ${city.name}`, item: `${BASE_URL}/${params.ciudad}` },
    ],
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbSchema) }} />
      <Header />
      <main>
        <section className="hero" style={{ padding: '32px 0 24px' }}>
          <div className="container">
            <span className="hero-eyebrow">📍 {city.name}, Colombia</span>
            <h1 style={{ fontSize: 'clamp(1.5rem, 4vw, 2.2rem)' }}>
              Cartelera de Cine en <span>{city.name}</span> Hoy
            </h1>
          </div>
        </section>

        <HomeClient
          initialMovies={uniqueMovies || []}
          cities={cities || []}
          searchQuery={searchParams.q || ''}
          initialCity={params.ciudad}
        />
      </main>
      <Footer />
    </>
  );
}
