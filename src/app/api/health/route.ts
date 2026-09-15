/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Health check reporting database, jobs, worker and storage status separately.
 */

import { serverEnv } from "@/env";
import { sql as rawSql } from "@/lib/db/client";
import { readHeartbeat } from "@/lib/jobs/heartbeat";
import { inlineJobStats } from "@/lib/jobs/inline";
import { WORKER_HEARTBEAT_KEY, WORKER_HEARTBEAT_TTL_SECONDS } from "@/lib/jobs/types";
import { storage } from "@/lib/storage";

/**
 * Health check.
 *
 * The healthcheck path for any host, and the first thing to open when something
 * is wrong. It reports each component separately — "the site is up but the
 * worker died" is a different problem from "the database is gone" — and says
 * which driver each one is using, so a local stand-in is never mistaken for the
 * real thing (ADR-008).
 *
 * A component the selected drivers do not use is reported as `skipped`, not
 * `ok`: with inline jobs there is no Redis to be healthy, and pretending
 * otherwise would make this page lie in exactly the situation it exists for.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Status = "ok" | "error" | "skipped";

type ComponentResult = {
  status: Status;
  latencyMs?: number;
  detail?: string;
} & Record<string, unknown>;

/** Extensions the application depends on; a missing one breaks search. */
const REQUIRED_EXTENSIONS = ["vector", "pg_trgm", "unaccent"] as const;

async function timed(run: () => Promise<Record<string, unknown> | void>): Promise<ComponentResult> {
  const startedAt = performance.now();
  try {
    const extra = (await run()) ?? {};
    return { status: "ok", latencyMs: Math.round(performance.now() - startedAt), ...extra };
  } catch (error) {
    return {
      status: "error",
      latencyMs: Math.round(performance.now() - startedAt),
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

function checkDatabase(): Promise<ComponentResult> {
  return timed(async () => {
    // A plain array with an explicit cast, never an untyped sql.array(): that
    // form errors on PGlite, and with a cast it silently matches nothing
    // (ADR-008). The lint rule in eslint.config.mjs forbids it.
    const rows = await rawSql<{ extname: string }[]>`
      SELECT extname FROM pg_extension WHERE extname = ANY(${[...REQUIRED_EXTENSIONS]}::text[])
    `;
    const present = rows.map((row) => row.extname);
    const missing = REQUIRED_EXTENSIONS.filter((name) => !present.includes(name));
    if (missing.length > 0) {
      throw new Error(`Missing PostgreSQL extensions: ${missing.join(", ")}`);
    }
    const [version] = await rawSql<{ server_version: string }[]>`SHOW server_version`;
    return { extensions: present.sort(), version: version?.server_version };
  });
}

async function checkJobs(): Promise<{ redis: ComponentResult; worker: ComponentResult }> {
  const env = serverEnv();

  if (env.jobsDriver === "inline") {
    return {
      redis: { status: "skipped", detail: "Not used by the inline jobs driver." },
      worker: { status: "ok", driver: "inline", ...inlineJobStats() },
    };
  }

  const { redis } = await import("@/lib/jobs/redis");

  const redisResult = await timed(async () => {
    const pong = await redis().ping();
    if (pong !== "PONG") throw new Error(`Unexpected PING reply: ${pong}`);
  });

  // The worker has no URL; its liveness is a heartbeat key it refreshes.
  const worker = await timed(async () => {
    const value = await redis().get(WORKER_HEARTBEAT_KEY);
    const verdict = readHeartbeat(value);
    if (!verdict.fresh) {
      throw new Error(`Worker heartbeat ${verdict.reason} (TTL ${WORKER_HEARTBEAT_TTL_SECONDS}s).`);
    }
    return { driver: "bullmq", lastBeatAt: value, ageSeconds: verdict.ageSeconds };
  });

  return { redis: { ...redisResult, driver: "bullmq" }, worker };
}

function checkStorage(): Promise<ComponentResult> {
  return timed(async () => {
    const driver = await storage();
    const { location } = await driver.check();
    return { driver: driver.kind, location: driver.kind === "local" ? "local folder" : location };
  });
}

export async function GET(request: Request): Promise<Response> {
  const [database, jobs, bucket] = await Promise.all([checkDatabase(), checkJobs(), checkStorage()]);

  const components = { database, redis: jobs.redis, bucket, worker: jobs.worker };
  const healthy = Object.values(components).every((component) => component.status !== "error");

  return Response.json(
    {
      status: healthy ? "ok" : "error",
      checkedAt: new Date().toISOString(),
      requestId: request.headers.get("x-request-id"),
      local: serverEnv().VITRINE_LOCAL,
      components,
    },
    { status: healthy ? 200 : 503, headers: { "cache-control": "no-store" } },
  );
}
