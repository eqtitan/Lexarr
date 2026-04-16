import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // instrumentationHook + eslint config moved out of NextConfig in Next.js 16
  typescript: { ignoreBuildErrors: true },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "image.tmdb.org" },
      { protocol: "https", hostname: "covers.openlibrary.org" },
      { protocol: "https", hostname: "coverartarchive.org" },
    ],
  },
};

export default nextConfig;
