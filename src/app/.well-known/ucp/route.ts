/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * /.well-known/ucp: how a shopping agent discovers the shop (Universal Commerce Protocol business profile).
 */

import { serverEnv } from "@/env";
import { ucpProfile } from "@/lib/ai/surfaces/ucp/profile";

/** UCP asks for at least a minute's public caching and no redirects. */
export function GET(): Response {
  return Response.json(ucpProfile(serverEnv().APP_URL), { headers: { "cache-control": "public, max-age=300" } });
}
