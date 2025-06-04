
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
    // For FFmpeg to work, we need to ensure that @ffmpeg/core is not bundled by the server.
    // It's used client-side and loads WASM.
    if (isServer) {
      if (!config.externals) {
        config.externals = [];
      }
      config.externals.push('@ffmpeg/core');
    }
    
    // Important for resolving WASM and worker files correctly with FFmpeg,
    // especially when corePath points to public directory.
    // This ensures that files referenced by FFmpeg from public are served as static assets.
    config.output.publicPath = '/_next/';


    // This rule is sometimes needed for libraries that emit their own worker files.
    // It ensures that '.worker.js' files are handled as assets.
    // config.module.rules.push({
    //   test: /\.worker\.js$/,
    //   loader: 'worker-loader',
    //   options: {
    //     filename: 'static/chunks/[name].[contenthash].js',
    //     publicPath: '/_next/',
    //   },
    // });


    return config;
  },
};

export default nextConfig;
