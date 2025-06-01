
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
      },
      {
        protocol: 'http', // Added for Replit dev server
        hostname: 'c5ca8427-cd2b-4dd8-a4b4-f2d181791ac5-00-q34w2hbrdndv.spock.replit.dev',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'i.ytimg.com', // Added for YouTube thumbnails
        port: '',
        pathname: '/**',
      },
    ],
  },
};

export default nextConfig;
