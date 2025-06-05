
/** @type {import('next').NextConfig} */
const nextConfig = {
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'placehold.co',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'firebasestorage.googleapis.com', 
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'doctornerves.firebasestorage.app', 
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'storage.googleapis.com', 
        port: '',
        pathname: '/**', 
      },
      {
        protocol: 'http', 
        hostname: 'c5ca8427-cd2b-4dd8-a4b4-f2d181791ac5-00-q34w2hbrdndv.spock.replit.dev',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'i.ytimg.com', 
        port: '',
        pathname: '/**',
      },
    ],
  },
  webpack: (config, { isServer }) => {
    // If you have other webpack customizations, keep them.
    // FFmpeg externals removed as FFmpeg is no longer used.
    return config;
  },
};

module.exports = nextConfig;
