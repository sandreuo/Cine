import type { Metadata } from 'next';
import { Analytics } from '@vercel/analytics/react';
import Script from 'next/script';
import './globals.css';

const BASE_URL = 'https://cinehoyap.app';

export const metadata: Metadata = {
  metadataBase: new URL(BASE_URL),
  title: {
    default: 'CineHoy — Cartelera de Cine en Colombia Hoy',
    template: '%s | CineHoy',
  },
  description:
    'Consulta la cartelera de cine en Colombia hoy: Cinépolis, Cine Colombia, Cinemark y Procinal. Horarios actualizados, trailers y cines cercanos en Bogotá, Medellín, Cali y más ciudades.',
  keywords: [
    'cartelera de cine Colombia',
    'cartelera cine hoy Colombia',
    'cine hoy Colombia',
    'horarios cine Colombia',
    'películas en cartelera Colombia',
    'cartelera cine Bogotá hoy',
    'cartelera cine Medellín hoy',
    'cartelera cine Cali hoy',
    'Cinépolis Colombia horarios',
    'Cine Colombia horarios',
    'Cinemark Colombia horarios',
    'Procinal horarios',
    'funciones de cine Colombia',
    'qué hay en cine hoy Colombia',
  ],
  openGraph: {
    type: 'website',
    locale: 'es_CO',
    url: BASE_URL,
    siteName: 'CineHoy',
    title: 'CineHoy — Cartelera de Cine en Colombia Hoy',
    description:
      'Toda la cartelera de cine colombiana en un solo lugar. Horarios de Cinépolis, Cine Colombia, Cinemark y Procinal actualizados cada hora.',
    images: [{ url: `${BASE_URL}/og-image.png`, width: 1200, height: 630, alt: 'CineHoy — Cartelera de cine en Colombia' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'CineHoy — Cartelera de Cine en Colombia Hoy',
    description: 'Todos los horarios de cine en Colombia en un solo lugar. Actualizado cada hora.',
    images: [`${BASE_URL}/og-image.png`],
  },
  robots: { index: true, follow: true, googleBot: { index: true, follow: true, 'max-image-preview': 'large' } },
  other: { 'google-adsense-account': 'ca-pub-3504512443308706' },
};

const websiteSchema = {
  '@context': 'https://schema.org',
  '@type': 'WebSite',
  name: 'CineHoy',
  alternateName: 'CineHoy.co',
  url: BASE_URL,
  description: 'Cartelera de cine en Colombia — todos los horarios de Cinépolis, Cine Colombia, Cinemark y Procinal en un solo lugar.',
  potentialAction: {
    '@type': 'SearchAction',
    target: { '@type': 'EntryPoint', urlTemplate: `${BASE_URL}/?q={search_term_string}` },
    'query-input': 'required name=search_term_string',
  },
};

const organizationSchema = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  name: 'CineHoy',
  url: BASE_URL,
  logo: `${BASE_URL}/icon.png`,
  description: 'Agregador gratuito de cartelera cinematográfica para Colombia. Horarios de Cinépolis, Cine Colombia, Cinemark y Procinal.',
  contactPoint: { '@type': 'ContactPoint', email: 'sandreuo@gmail.com', contactType: 'customer support', areaServed: 'CO' },
  areaServed: { '@type': 'Country', name: 'Colombia' },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es-CO">
      <body>
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(websiteSchema) }} />
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationSchema) }} />
        {children}
        <Analytics />
        <Script
          async
          src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-3504512443308706"
          crossOrigin="anonymous"
          strategy="afterInteractive"
        />
      </body>
    </html>
  );
}
