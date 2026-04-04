import { ResolvingMetadata } from 'next';
import { supabase } from '@/lib/supabase';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import HomeClient from '@/app/HomeClient';

export const revalidate = 3600; // Revalidate every hour

export async function generateMetadata(
  { params }: { params: { ciudad: string } },
  parent: ResolvingMetadata
) {
  const { data: city } = await supabase
    .from('cities')
    .select('name')
    .eq('slug', params.ciudad)
    .single();

  if (!city) return { title: 'No encontrada | CineHoy.co' };

  return {
    title: `Cartelera de Cine en ${city.name} Hoy | CineHoy.co`,
    description: `Consulta la cartelera y horarios de cine en ${city.name}. Funciones en Cinépolis, Cine Colombia, Cinemark y Procinal de tu ciudad.`,
    alternates: { canonical: `https://cinehoy.co/${params.ciudad}` },
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

  const [{ data: movies }, { data: cities }] = await Promise.all([
    supabase.from('movies').select('*').order('title'),
    supabase.from('cities').select('*').order('name'),
  ]);

  return (
    <>
      <Header />
      <main>
        {/* We use HomeClient but pre-select the city locally */}
        {/* Realistically, pre-filtering on the server is better but we use HomeClient for interactivity */}
        <section className="hero" style={{ padding: '32px 0 24px' }}>
          <div className="container">
             <span className="hero-eyebrow">
              📍 {city.name}, Colombia
            </span>
            <h1 style={{ fontSize: 'clamp(1.5rem, 4vw, 2.2rem)' }}>
              Cine en <span>{city.name}</span>
            </h1>
          </div>
        </section>
        
        {/* We use HomeClient which displays the movies interactively */}
        <HomeClient
          initialMovies={movies || []}
          cities={cities || []}
          searchQuery={searchParams.q || ''}
        />

        <HomeClient
          initialMovies={movies || []}
          cities={cities || []}
          searchQuery={searchParams.q || ''}
        />
      </main>
      <Footer />
    </>
  );
}
