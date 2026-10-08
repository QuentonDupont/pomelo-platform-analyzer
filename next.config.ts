import type { NextConfig } from "next";

const config: NextConfig = {
  // Separate build dir lets `next build` run while `next dev` is serving.
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  poweredByHeader: false,
};

export default config;
