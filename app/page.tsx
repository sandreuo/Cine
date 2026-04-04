import type { Metadata } from 'next';
import { supabase } from '@/lib/supabase';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import HomeClient from './HomeClient';
import SEOContent from '@/components/SEOContent';

export const revalidate = 3600; // Revalidate every hour

export const metadata: Metadata = {
  title: 'CineHoy.co — Cartelera de Cine en Colombia Hoy',
  description:
    'Consulta la cartelera de cine en Colombia: Cinépolis, Cine Colombia, Cinemark y Procinal. Horarios, trailers, cines cercanos y comparte con tus amigos por WhatsApp.',
  alternates: { canonical: 'https://cinehoy.co' },
};

export default async function HomePage({
  searchParams,
}: {
  searchParams: { q?: string };
}) {
  const [{ data: movies }, { data: cities }] = await Promise.all([
    supabase.from('movies').select('*').order('title'),
    supabase.from('cities').select('*').order('name'),
  ]);

  return (
    <>
      <Header />
      <main>
        <HomeClient
          initialMovies={movies || []}
          cities={cities || []}
          searchQuery={searchParams.q || ''}
        />
        <SEOContent />
      </main>
      <Footer />
    </>
  );
}
