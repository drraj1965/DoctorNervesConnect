
import type {NextConfig} from 'next';

const nextConfig: NextConfig = {
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
        hostname: 'firebasestorage.googleapis.com', // Standard Firebase Storage host
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'doctornerves.firebasestorage.app', // As per error message, to be safe
        port: '',
        pathname: '/**',
      }
    ],
  },
};

export default nextConfig;
