/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Better Auth's endpoints: sign-up, sign-in, verification links, passkeys, two-factor, sessions.
 */

import { auth } from "@/lib/auth/server";

/**
 * Every /api/auth/* request goes to Better Auth, which validates its own input,
 * applies the rate limits and sets the session cookie (src/lib/auth/config.ts).
 * The instance is created on the first request, not at import, so the build
 * does not need the secret.
 */
export async function GET(request: Request): Promise<Response> {
  return auth().handler(request);
}

export async function POST(request: Request): Promise<Response> {
  return auth().handler(request);
}
