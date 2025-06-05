
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
    // For FFmpeg to work, we need to ensure that @ffmpeg/core and @ffmpeg/ffmpeg are not bundled by the server.
    // They are used client-side and load WASM.
    if (isServer) {
      if (!config.externals) {
        config.externals = [];
      }
      // Ensure these are not already present before pushing to avoid duplicates
      if (!config.externals.includes('@ffmpeg/core')) {
        config.externals.push('@ffmpeg/core');
      }
      if (!config.externals.includes('@ffmpeg/ffmpeg')) {
        config.externals.push('@ffmpeg/ffmpeg');
      }
    }
    
    // The config.output.publicPath modification is removed as we are loading FFmpeg assets from CDN,
    // and this particular setting might not be relevant or could conflict.
    // The primary issue is server-side module resolution which 'externals' aims to address.

    return config;
  },
};

module.exports = nextConfig;
