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
};

export default withNextIntl(nextConfig);
