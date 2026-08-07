import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Static export so the Electron shell can serve it locally
  output: "export",
  images: { unoptimized: true },
  trailingSlash: true,
  poweredByHeader: false,
};

export default nextConfig;
