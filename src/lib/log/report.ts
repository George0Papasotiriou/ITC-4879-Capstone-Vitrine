/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Writes one structured log line per server error.
 */

import { logger } from "@/lib/log";
import { REQUEST_ID_HEADER } from "@/lib/log/request-id";

type RequestInfo = { path: string; method: string; headers: Record<string, string | string[] | undefined> };
type ContextInfo = { routePath: string; routeType: string; renderSource?: string };

/**
 * One structured log line per server error.
 *
 * React replaces errors thrown while rendering Server Components with a generic
 * one carrying a `digest`; the same digest is shown to the visitor in
 * production, so logging it is what connects "I saw an error" to the real cause.
 *
 * The path is logged without its query string, because query strings are where
 * search terms, emails and tokens end up.
 */
export async function reportServerError(
  error: unknown,
  request: RequestInfo,
  context: ContextInfo,
): Promise<void> {
  const requestId = request.headers[REQUEST_ID_HEADER];
  const digest =
    typeof error === "object" && error !== null && "digest" in error
      ? String((error as { digest: unknown }).digest)
      : undefined;

  logger.error(
    {
      requestId: Array.isArray(requestId) ? requestId[0] : requestId,
      method: request.method,
      path: request.path.split("?")[0],
      route: context.routePath,
      routeType: context.routeType,
      renderSource: context.renderSource,
      digest,
      err: error instanceof Error ? error : new Error(String(error)),
    },
    "server error",
  );
}
