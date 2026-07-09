import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { NetworkOnly, Serwist } from "serwist";
import { defaultCache } from "@serwist/next/worker";

// `@serwist/next` injects the precache manifest (build assets + public files +
// the additionalPrecacheEntries from serwist.config.mjs) into `self.__SW_MANIFEST`
// at build time.
declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [
    // The app's data is live over Convex (WebSocket + HTTP to *.convex.cloud /
    // *.convex.site). The service worker caches the app SHELL only — Convex
    // requests are always network-only and never cached. (WebSocket upgrades
    // bypass the fetch handler anyway; this guards the HTTP endpoints.)
    {
      matcher: ({ url }) =>
        url.hostname.endsWith(".convex.cloud") ||
        url.hostname.endsWith(".convex.site"),
      handler: new NetworkOnly(),
    },
    ...defaultCache,
  ],
  fallbacks: {
    // Offline navigation fallback for a client-rendered app: serve the
    // precached /portal HTML shell (see additionalPrecacheEntries in
    // serwist.config.mjs) when a document request can't be satisfied — the client
    // bundle then boots from the precache and renders its own loading states.
    entries: [
      {
        url: "/portal",
        matcher({ request }) {
          return request.destination === "document";
        },
      },
    ],
  },
});

// --- Web Push (fixed M12 contract shared with the notifications half) -------

self.addEventListener("push", (event) => {
  if (!event.data) return;
  const d = JSON.parse(event.data.text()) as {
    title: string;
    body: string;
    url: string;
  };
  event.waitUntil(
    self.registration.showNotification(d.title, {
      body: d.body,
      icon: "/icons/icon-192.png",
      dir: "rtl",
      lang: "ar",
      data: { url: d.url },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data as { url?: string } | undefined;
  const target = new URL(data?.url ?? "/portal", self.location.origin).href;
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if (client.url === target && "focus" in client) {
            return client.focus();
          }
        }
        return self.clients.openWindow(target);
      }),
  );
});

serwist.addEventListeners();
