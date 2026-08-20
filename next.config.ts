import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  basePath: "/reta",
  assetPrefix: "/reta/",
  images: {
    unoptimized: true,
  },
};

export default nextConfig;