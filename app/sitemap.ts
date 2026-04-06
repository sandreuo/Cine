import { MetadataRoute } from 'next';
import { supabase } from '@/lib/supabase';

const BASE_URL = 'https://cinehoyap.app';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const { data: movies } = await supabase
    .from('movies')
    .select('slug, updated_at')
    .order('title');

  const { data: cities } = await supabase
    .from('cities')
    .select('slug');

  const movieUrls: MetadataRoute.Sitemap = (movies || []).map((m) => ({
    url: `${BASE_URL}/pelicula/${m.slug}`,
    lastModified: m.updated_at || new Date(),
    changeFrequency: 'daily',
    priority: 0.9,
  }));

  const cityUrls: MetadataRoute.Sitemap = (cities || []).map((c) => ({
    url: `${BASE_URL}/${c.slug}`,
    lastModified: new Date(),
    changeFrequency: 'hourly',
    priority: 0.8,
  }));

  return [
    { url: BASE_URL, lastModified: new Date(), changeFrequency: 'hourly', priority: 1 },
    { url: `${BASE_URL}/nosotros`, lastModified: new Date(), changeFrequency: 'monthly', priority: 0.4 },
    { url: `${BASE_URL}/privacidad`, lastModified: new Date(), changeFrequency: 'monthly', priority: 0.3 },
    ...cityUrls,
    ...movieUrls,
  ];
}
