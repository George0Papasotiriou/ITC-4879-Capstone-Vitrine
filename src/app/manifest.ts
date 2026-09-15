/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Progressive web app manifest.
 */

import type { MetadataRoute } from "next";

/**
 * Web app manifest (docs/PLAN.md Phase 2, step 7).
 *
 * Served at /manifest.webmanifest by Next's metadata route. The store installs
 * as a PWA rather than shipping native apps (1.8, non-goals), because the
 * signature features need the camera, the microphone and WebXR — all of which
 * the web platform provides — and a capstone cannot maintain three codebases.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Vitrine",
    short_name: "Vitrine",
    description:
      "An e-shop you can browse, type to, speak to or show a photo.",
    start_url: "/en",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#F2F3F1",
    theme_color: "#F2F3F1",
    categories: ["shopping", "lifestyle"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/icons/maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
