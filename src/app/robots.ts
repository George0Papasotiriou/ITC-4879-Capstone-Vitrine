/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Generates robots.txt.
 */

import type { MetadataRoute } from "next";

import { serverEnv } from "@/env";

/**
 * robots.txt. Built per request, because the site's address comes from the
 * environment and a build must not need one.
 */
export const dynamic = "force-dynamic";

export default function robots(): MetadataRoute.Robots {
  const origin = serverEnv().APP_URL;
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // Search results and the API are endless and personal to a query.
      disallow: ["/api/", "/en/search", "/el/search", "/media/", "/en/design", "/el/design"],
    },
    sitemap: new URL("/sitemap.xml", origin).toString(),
  };
}
