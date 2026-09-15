/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Service worker: network-first navigations, cache-first static assets and the offline fallback page.
 */

/**
 * Vitrine service worker.
 *
 * Hand-written rather than generated (ADR-006). Serwist injects through a
 * webpack plugin and Next.js 16 builds with Turbopack, so the plan's documented
 * fallback applies — and sixty lines that George can explain in a viva are
 * worth more here than a dependency that generates a thousand he cannot.
 *
 * The strategy is deliberately conservative for a shop:
 *
 * - Navigations are network-first. Prices and stock must never be served stale
 *   from a cache (CLAUDE.md golden rule 5: truth comes from the database).
 *   The offline page is shown only when the network genuinely fails.
 * - Static build output is cache-first. It is content-hashed, so a cached copy
 *   is either current or unreachable.
 * - API responses are never cached.
 */

const VERSION = "v1";
const STATIC_CACHE = `vitrine-static-${VERSION}`;

/**
 * Both storefronts get their own offline page. Losing signal should not also
 * lose your language.
 */
const OFFLINE_URLS = { en: "/en/offline", el: "/el/offline" };
const DEFAULT_LOCALE = "en";

function offlineUrlFor(pathname) {
  const locale = pathname.split("/")[1];
  return OFFLINE_URLS[locale] ?? OFFLINE_URLS[DEFAULT_LOCALE];
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(STATIC_CACHE);
      await cache.addAll([...Object.values(OFFLINE_URLS), "/icons/icon-192.png"]);
      // Take over as soon as the new worker is ready rather than waiting for
      // every tab to close; there is no cross-version state to protect.
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith("vitrine-") && !name.endsWith(VERSION))
          .map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Never cache API responses: health, cart, orders and the Concierge are all
  // live by definition.
  if (url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          return await fetch(request);
        } catch {
          const cache = await caches.open(STATIC_CACHE);
          const offline = await cache.match(offlineUrlFor(url.pathname));
          return (
            offline ??
            new Response("You are offline.", {
              status: 503,
              headers: { "content-type": "text/plain; charset=utf-8" },
            })
          );
        }
      })(),
    );
    return;
  }

  // Content-hashed build output and images.
  const isStatic =
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/icons/") ||
    url.pathname.startsWith("/products/");

  if (!isStatic) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(STATIC_CACHE);
      const cached = await cache.match(request);
      if (cached !== undefined) return cached;

      const response = await fetch(request);
      if (response.ok) cache.put(request, response.clone());
      return response;
    })(),
  );
});
