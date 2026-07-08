// @ts-check
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { serwist } from "@serwist/next/config";

// Content-hash the PWA icons so a changed icon busts its precache entry. Listing
// them explicitly (instead of globbing public/) keeps create-next-app leftovers
// out of the precache.
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

// Configurator mode: `serwist build` bundles the SW with esbuild (ESM output)
// AFTER `next build` finishes, which frees the main build to run Turbopack
// (`next build`, no --webpack). See package.json.
export default serwist({
  swSrc: "app/sw.ts",
  swDest: "public/sw.js",
  // App-shell-only precache, matching the pre-Turbopack webpack setup: don't
  // auto-cache every prerendered route (some are authed). Offline navigation
  // falls back to the precached /portal shell (see app/sw.ts). The /portal
  // revision is per-build so every deploy re-fetches it.
  precachePrerendered: false,
  additionalPrecacheEntries: [
    { url: "/portal", revision: crypto.randomUUID() },
    ...iconPrecacheEntries,
  ],
});
