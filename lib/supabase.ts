import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export type Movie = {
  id: number;
  title: string;
  slug: string;
  description: string | null;
  poster_url: string | null;
  trailer_youtube_id: string | null;
  duration_minutes: number | null;
  rating: string | null;
  genres: string[] | null;
  release_date: string | null;
};

export type Cinema = {
  id: number;
  name: string;
  chain: 'cinepolis' | 'cinecolombia' | 'cinemark' | 'procinal';
  city_id: number;
  address: string | null;
  lat: number | null;
  lng: number | null;
  cities?: { name: string; slug: string };
};

export type Screening = {
  id: number;
  movie_id: number;
  cinema_id: number;
  start_time: string;
  format: '2D' | '3D' | 'IMAX' | 'XD' | '4DX' | 'PREMIUM';
  language: 'subtitulada' | 'doblada' | 'original';
  buy_url: string | null;
  movies?: Movie;
  cinemas?: Cinema & { cities?: { name: string; slug: string } };
};

export type City = {
  id: number;
  name: string;
  slug: string;
  lat: number | null;
  lng: number | null;
};
