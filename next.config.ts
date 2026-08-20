import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  basePath: "/reta-daily",
  assetPrefix: "/reta-daily/",
  images: {
    unoptimized: true,
  },
};

export default nextConfig;