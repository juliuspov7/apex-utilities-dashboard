import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "/api/data": ["./data/seed.xlsx"],
  },
};

export default nextConfig;
