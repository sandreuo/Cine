/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'image.tmdb.org' },
      { protocol: 'https', hostname: 'media.themoviedb.org' },
      { protocol: 'https', hostname: 'cinepolis.com.co' },
      { protocol: 'https', hostname: 'www.cinecolombia.com' },
      { protocol: 'https', hostname: 'www.cinemark.com.co' },
      { protocol: 'https', hostname: 'procinal.com.co' }
    ],
  },
};

module.exports = nextConfig;
