/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Request proxy: request ids, security headers and locale routing.
 */

import createMiddleware from "next-intl/middleware";
import { NextRequest, NextResponse } from "next/server";

import { routing } from "@/i18n/routing";
import { REQUEST_ID_HEADER, resolveRequestId } from "@/lib/log/request-id";
import { baseSecurityHeaders, bucketOrigins, contentSecurityPolicy, cspHeaderName, cspMode, newNonce } from "@/lib/security/headers";

/**
 * Next.js 16 renamed `middleware.ts` to `proxy.ts` (CLAUDE.md, known gotchas).
 *
 * Two jobs, in order:
 *
 * 1. **Request id.** Every request gets an `x-request-id`, forwarded to the app
 *    so logs written while handling it can be correlated, and echoed on the
 *    response so a bug report can quote it.
 * 2. **Security headers** (docs/adr/046). Every response gets the base set;
 *    every page also gets a Content Security Policy with a nonce made for this
 *    one view, passed to the render in the request's own CSP header, where
 *    Next.js reads it and puts it on its scripts (and `x-nonce` for the
 *    layout's own inline script). CSP_MODE=report switches it to report-only,
 *    CSP_MODE=off removes it: a way back without a code change.
 * 3. **Locale.** Pages are redirected to a locale prefix. API routes are not
 *    localised and pass straight through.
 *
 * Any authentication check added here later is optimistic only: every server
 * action and route handler re-checks the session and role itself (2.8).
 *
 * The matcher below is a regex inside a string, so its escaping is doubled:
 * the file must contain `\\.` for the regex to receive `\.` (a literal dot). A
 * single backslash is silently swallowed by the string and the regex becomes
 * `.*..*`, which excludes every path except `/` — the proxy then appears to
 * work, because `/` redirects, while `/cart` falls through to `/[locale]` with
 * the locale "cart". That exact bug shipped once (ADR-006), and
 * `src/proxy.matcher.test.ts` now checks the compiled pattern.
 */
const handleI18n = createMiddleware(routing);

export default function proxy(request: NextRequest) {
  const requestId = resolveRequestId(request.headers.get(REQUEST_ID_HEADER));

  const headers = new Headers(request.headers);
  headers.set(REQUEST_ID_HEADER, requestId);
  const api = request.nextUrl.pathname.startsWith("/api/");
  const https = (process.env.APP_URL ?? "").startsWith("https://");

  // A page's policy and its nonce, made fresh for this request.
  const csp = api ? null : cspHeaderName(cspMode(process.env.CSP_MODE));
  let policy: string | null = null;
  if (csp !== null) {
    const nonce = newNonce();
    const bucket =
      process.env.STORAGE_DRIVER === "local"
        ? []
        : bucketOrigins({ endpoint: process.env.S3_ENDPOINT, bucket: process.env.S3_BUCKET, forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "1" });
    policy = contentSecurityPolicy({ nonce, dev: process.env.NODE_ENV === "development", https, bucket });
    headers.set("x-nonce", nonce);
    headers.set("content-security-policy", policy);
  }

  const response = api
    ? NextResponse.next({ request: { headers } })
    : // next-intl copies the incoming request's headers into the request it
      // forwards, so the id and the nonce set here reach the page.
      handleI18n(new NextRequest(request, { headers }));

  response.headers.set(REQUEST_ID_HEADER, requestId);
  for (const [name, value] of baseSecurityHeaders({ https })) response.headers.set(name, value);
  if (csp !== null && policy !== null) response.headers.set(csp, policy);
  return response;
}

export const config = {
  // Everything except Next internals and files with an extension. API routes
  // are included now, so they get request ids too; they skip localisation above.
  matcher: ["/((?!_next|_vercel|.*\\..*).*)"],
};
