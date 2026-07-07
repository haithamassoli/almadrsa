import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { NextConfig } from "next";
import withSerwistInit from "@serwist/next";

const nextConfig: NextConfig = {
  /* config options here */
};

// Extra entries for the service worker's precache (the app shell):
// - /portal — the portal HTML shell, used as the offline navigation fallback
//   (see app/sw.ts). Revision is per-build so every deploy re-fetches it.
// - PWA icons, content-hashed. Passing `additionalPrecacheEntries` replaces
//   @serwist/next's default public/ scan, so the icons are listed explicitly
//   (the other public/ files are create-next-app leftovers not worth caching).
const iconsDir = path.join(process.cwd(), "public", "icons");
const iconPrecacheEntries = fs.existsSync(iconsDir)
  ? fs
      .readdirSync(iconsDir)
      .filter((file) => file.endsWith(".png"))
      .map((file) => ({
        url: `/icons/${file}`,
        revision: crypto
          .createHash("md5")
          .update(fs.readFileSync(path.join(iconsDir, file)))
          .digest("hex"),
      }))
  : [];

const withSerwist = withSerwistInit({
  swSrc: "app/sw.ts",
  swDest: "public/sw.js",
  // Serwist's webpack plugin doesn't support Turbopack, so the service worker
  // is only built in production builds — which run webpack (`next build
  // --webpack`, see package.json). `next dev` (Turbopack) neither builds nor
  // registers it; test the PWA with `npm run build && npm run start`.
  disable: process.env.NODE_ENV !== "production",
  additionalPrecacheEntries: [
    { url: "/portal", revision: crypto.randomUUID() },
    ...iconPrecacheEntries,
  ],
});

// Only wrap for production so `next dev` (Turbopack) never sees a webpack()
// hook in the config (avoids the webpack/Turbopack config warning).
export default process.env.NODE_ENV === "production"
  ? withSerwist(nextConfig)
  : nextConfig;
