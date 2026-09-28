import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  basePath: "/reta",
  assetPrefix: "/reta/",
  images: {
    unoptimized: true,
  },
};

export default nextConfig;