"use client";

import { useEffect } from "react";

// Configurator mode doesn't auto-register the service worker the way the old
// @serwist/next webpack plugin did, so we register it here. Production only —
// `next dev` never builds public/sw.js (see serwist.config.mjs / package.json).
// The bundle is ESM (`serwist build` emits format: "esm"), hence type: "module".
export function RegisterSW() {
  useEffect(() => {
    if (
      process.env.NODE_ENV !== "production" ||
      !("serviceWorker" in navigator)
    ) {
      return;
    }
    navigator.serviceWorker.register("/sw.js", { type: "module" });
  }, []);

  return null;
}
