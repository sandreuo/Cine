import type { Metadata } from 'next';
import { Analytics } from '@vercel/analytics/react';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL('https://cinehoy.co'),
  title: {
    default: 'CineHoy.co — Cartelera de Cine en Colombia Hoy',
    template: '%s | CineHoy.co',
  },
  description:
    'Consulta la cartelera de cine en Colombia: Cinépolis, Cine Colombia, Cinemark y Procinal. Horarios, trailers, cines cercanos y comparte con tus amigos por WhatsApp.',
  keywords: [
    'cartelera de cine Colombia',
    'cine hoy Colombia',
    'cartelera cine Bogotá',
    'horarios cine Colombia',
    'películas en cartelera Colombia',
    'Cinépolis Colombia',
    'Cine Colombia horarios',
    'Cinemark Colombia',
    'Procinal horarios',
  ],
  openGraph: {
    type: 'website',
    locale: 'es_CO',
    url: 'https://cinehoy.co',
    siteName: 'CineHoy.co',
    title: 'CineHoy.co — Cartelera de Cine en Colombia',
    description:
      'Toda la cartelera de cine colombiana en un solo lugar. Horarios, trailers y cines cercanos.',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'CineHoy.co — Cartelera de Cine en Colombia',
    description: 'Toda la cartelera de cine colombiana en un solo lugar.',
  },
  robots: { index: true, follow: true },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es-CO">
      <head>
        <link rel="icon" href="/favicon.ico" />
        {/* Google AdSense - descomentar cuando tengas el ID */}
        {/* <script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-XXXXXXXXXXXXXXXX" crossOrigin="anonymous" /> */}
      </head>
      <body>
        {children}
        <Analytics />
      </body>
    </html>
  );
}
