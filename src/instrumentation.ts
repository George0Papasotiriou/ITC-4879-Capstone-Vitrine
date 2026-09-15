/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Server error reporting hook that logs every captured request error.
 */

import type { Instrumentation } from "next";

/**
 * Server error reporting (docs/PLAN.md 2.9).
 *
 * Next calls `onRequestError` for every error it captures while handling a
 * request — in a Server Component, a route handler, a server action or the
 * proxy. Each one becomes a single structured log line with the request id,
 * the route and where it failed, so an error a visitor saw can be found from the
 * id in the response header.
 *
 * Sentry is added at deployment (it needs an account and a DSN); this hook is
 * where it plugs in, and nothing else in the app needs to change when it does.
 */
export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  // pino is Node-only; the proxy may run elsewhere, and the report should never
  // be the thing that throws.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { reportServerError } = await import("@/lib/log/report");
  await reportServerError(error, request, context);
};
