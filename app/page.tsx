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
  const today = new Date().toISOString().split('T')[0];

  const [{ data: movies }, { data: cities }] = await Promise.all([
    // Only fetch movies that have at least one screening today or in the future
    supabase.from('movies')
      .select('*, screenings!inner(id)')
      .gte('screenings.start_time', today + 'T00:00:00')
      .order('title'),
    supabase.from('cities').select('*').order('name'),
  ]);

  // Handle duplication from !inner join
  const uniqueMovies = Array.from(new Map((movies || []).map(m => [m.id, m])).values());

  return (
    <>
      <Header />
      <main>
        <HomeClient
          initialMovies={uniqueMovies || []}
          cities={cities || []}
          searchQuery={searchParams.q || ''}
        />
        <SEOContent />
      </main>
      <Footer />
    </>
  );
}
