/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Next.js configuration.
 */

import createNextIntlPlugin from "next-intl/plugin";
import type { NextConfig } from "next";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  // Fail the production build on type errors. Linting runs as its own CI step
  // (Next 16 removed the `eslint` config key). A broken build must never
  // reach Railway (CLAUDE.md golden rule 1: deployed or it didn't happen).
  typescript: { ignoreBuildErrors: false },

  // Product media is served from the S3-compatible bucket through presigned or
  // public URLs. Hosts are added in Phase 3 once the bucket domain is known.
  // Specimen photography currently lives in `public/`, which needs no pattern.
  images: {
    remotePatterns: [],
    formats: ["image/avif", "image/webp"],
  },

  experimental: {
    // Server Actions are used for every mutation; bodies stay small because
    // uploads go straight to the bucket with presigned URLs (Phase 9).
    serverActions: { bodySizeLimit: "2mb" },
  },

  /**
   * Cross-origin isolation for the pages that run the depth model (ADR-014).
   * It lets WebAssembly share memory between threads, so the model runs on
   * several cores instead of one. Only these pages: isolation refuses any
   * cross-origin resource that has not opted in, which the payment form's
   * frames (Stripe) will need to be. Links to the room page load it as a new
   * document, since isolation only applies from a document's first load.
   */
  async headers() {
    const isolated = [
      { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
      { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
    ];
    return [
      { source: "/:locale(en|el)/room", headers: isolated },
      { source: "/:locale(en|el)/lab/:path*", headers: isolated },
      // The model's runtime starts workers from these files. A worker started by
      // an isolated page must be isolated itself, or the browser refuses to run
      // it: without this, threads hang and the background worker never starts.
      {
        source: "/models/:path*",
        headers: [...isolated, { key: "Cross-Origin-Resource-Policy", value: "same-origin" }],
      },
    ];
  },
};

export default withNextIntl(nextConfig);
