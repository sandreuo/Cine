import { MetadataRoute } from 'next';
import { supabase } from '@/lib/supabase';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = 'https://cinehoy.co';

  const { data: movies } = await supabase
    .from('movies')
    .select('slug, updated_at')
    .order('title');

  const { data: cities } = await supabase
    .from('cities')
    .select('slug');

  const movieUrls: MetadataRoute.Sitemap = (movies || []).map((m) => ({
    url: `${baseUrl}/pelicula/${m.slug}`,
    lastModified: m.updated_at || new Date(),
    changeFrequency: 'daily',
    priority: 0.9,
  }));

  const cityUrls: MetadataRoute.Sitemap = (cities || []).map((c) => ({
    url: `${baseUrl}/${c.slug}`,
    lastModified: new Date(),
    changeFrequency: 'hourly',
    priority: 0.8,
  }));

  return [
    {
      url: baseUrl,
      lastModified: new Date(),
      changeFrequency: 'hourly',
      priority: 1,
    },
    ...cityUrls,
    ...movieUrls,
  ];
}
