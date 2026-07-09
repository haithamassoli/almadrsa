// @ts-check
import crypto from "node:crypto";
import { serwist } from "@serwist/next/config";

// Configurator mode: `serwist build` bundles the SW with esbuild (ESM output)
// AFTER `next build` finishes, which frees the main build to run Turbopack
// (`next build`, no --webpack). See package.json.
export default serwist({
  swSrc: "app/sw.ts",
  swDest: "public/sw.js",
  // App-shell-only precache, matching the pre-Turbopack webpack setup: don't
  // auto-cache every prerendered route (some are authed). Offline navigation
  // falls back to the precached /portal shell (see app/sw.ts). The /portal
  // revision is per-build so every deploy re-fetches it. The PWA icons in
  // public/icons are precached automatically by the configurator's public/**
  // glob (with content-hash revisions), so only /portal is listed here.
  precachePrerendered: false,
  additionalPrecacheEntries: [{ url: "/portal", revision: crypto.randomUUID() }],
});
