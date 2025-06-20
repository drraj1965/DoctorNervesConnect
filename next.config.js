/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  experimental: {
    // Remove the error: Must be object, not boolean
    serverActions: {},
    allowedDevOrigins: [
      "http://localhost:9003",
      "https://9003-firebase-studio-*.cloudworkstations.dev"
    ]
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "placehold.co",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "firebasestorage.googleapis.com",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "doctornerves.firebasestorage.app",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "storage.googleapis.com",
        pathname: "/**",
      },
      {
        protocol: "http",
        hostname: "*.replit.dev",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "i.ytimg.com",
        pathname: "/**",
      },
    ],
  },
  webpack: (config) => config,
};

// next.config.js
module.exports = {
  experimental: {
    allowedDevOrigins: [
      "https://localhost:9002",
      "https://musical-succotash-x59q546jr9qx39x4v-9002.app.github.dev" // Add your Codespace URL here
    ]
  },
};
