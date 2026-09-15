/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Token-protected probe that enqueues a ping job to verify the web, queue and worker path.
 */

import { serverEnv } from "@/env";
import { enqueue } from "@/lib/jobs/queue";

/**
 * Phase 1 probe: enqueues a `ping` job so the full path web -> Redis -> worker
 * can be verified on production (Phase 1 acceptance criterion).
 *
 * It is guarded by a shared secret rather than left open, because an
 * unauthenticated endpoint that puts work on a queue is a denial-of-service
 * lever. With DEV_PING_TOKEN unset the route does not exist at all.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const expected = serverEnv().DEV_PING_TOKEN;

  if (expected === undefined) {
    return new Response("Not found", { status: 404 });
  }

  const provided = request.headers.get("x-vitrine-dev-token");
  if (provided !== expected) {
    return new Response("Not found", { status: 404 });
  }

  const jobId = await enqueue("ping", {
    requestedAt: new Date().toISOString(),
    note: "manual probe",
  });

  return Response.json({ enqueued: true, jobId }, { status: 202 });
}
