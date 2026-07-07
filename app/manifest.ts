import type { MetadataRoute } from "next";
import { t } from "@/lib/i18n";

/**
 * PWA web app manifest. Served at /manifest.webmanifest and linked
 * automatically by Next.js on every page.
 *
 * Colors are the light-theme tokens from app/globals.css converted to hex:
 * --background oklch(0.984 0.004 85) ≈ #fbfaf7 (sand),
 * --primary oklch(0.46 0.085 195) ≈ #006667 (Madrasa Teal — matches
 * docs/logo.svg exactly).
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${t("common.appName")} — ${t("common.tagline")}`,
    short_name: t("common.appName"),
    description: t("common.tagline"),
    dir: "rtl",
    lang: "ar",
    id: "/portal",
    scope: "/",
    start_url: "/portal",
    display: "standalone",
    background_color: "#fbfaf7",
    theme_color: "#006667",
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
      },
      {
        src: "/icons/icon-512-maskable.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icons/apple-touch-icon.png",
        sizes: "180x180",
        type: "image/png",
      },
    ],
  };
}
