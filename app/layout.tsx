import type { Metadata } from 'next';
import { Analytics } from '@vercel/analytics/react';
import Script from 'next/script';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL('https://cinehoyap.app'),
  title: {
    default: 'CineHoy — Cartelera de Cine en Colombia Hoy',
    template: '%s | CineHoy',
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
    url: 'https://cinehoyap.app',
    siteName: 'CineHoy',
    title: 'CineHoy — Cartelera de Cine en Colombia',
    description:
      'Toda la cartelera de cine colombiana en un solo lugar. Horarios, trailers y cines cercanos.',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'CineHoy — Cartelera de Cine en Colombia',
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
        <Script
          async
          src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-3504512443308706"
          crossOrigin="anonymous"
          strategy="beforeInteractive"
        />
      </head>
      <body>
        {children}
        <Analytics />
      </body>
    </html>
  );
}
