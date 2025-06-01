
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
        hostname: 'doctornerves.firebasestorage.app', // As per a previous error message
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'storage.googleapis.com', // Added for URLs like the one in the current error
        port: '',
        pathname: '/**', // Allows any path on this host, including /<bucket_name>/**
      }
    ],
  },
};

export default nextConfig;
