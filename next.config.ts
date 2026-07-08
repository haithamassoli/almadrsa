import type { NextConfig } from "next";

// The PWA service worker is built separately by `serwist build` (configurator
// mode, see serwist.config.mjs) so this config stays plain and `next build`
// runs Turbopack. Nothing to wrap here.
const nextConfig: NextConfig = {
  /* config options here */
};

export default nextConfig;
