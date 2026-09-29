/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Where browsers report what the Content Security Policy blocked, so a policy that is too tight shows in the logs.
 */

import { clientAddress } from "@/lib/geo/ip-country";
import { sharedRateLimiter } from "@/lib/kv/rate-limit";
import { logger } from "@/lib/log";

/**
 * docs/adr/046. Only the directive, the blocked origin and the page's path
 * are logged: never a full address, which can carry a query string with
 * someone's data. Limited per address, so a page in a loop cannot fill the log.
 */

export const runtime = "nodejs";

const perAddress = sharedRateLimiter({ name: "csp-report", limit: 30, windowMs: 60_000 });

const originOf = (value: unknown) => {
  if (typeof value !== "string") return null;
  if (!value.includes(":")) return value.slice(0, 40); // "inline", "eval", "self"
  try {
    const url = new URL(value);
    return url.protocol === "blob:" || url.protocol === "data:" ? url.protocol : url.origin;
  } catch {
    return value.slice(0, 40);
  }
};
const pathOf = (value: unknown) => {
  try {
    return typeof value === "string" ? new URL(value).pathname.slice(0, 120) : null;
  } catch {
    return null;
  }
};

export async function POST(request: Request): Promise<Response> {
  if (!(await perAddress(clientAddress(request.headers) ?? "unknown"))) return new Response(null, { status: 204 });
  const text = (await request.text().catch(() => "")).slice(0, 8_000);
  let body: unknown = null;
  try {
    body = JSON.parse(text);
  } catch {
    return new Response(null, { status: 204 });
  }
  const report = (body as { "csp-report"?: Record<string, unknown> } | null)?.["csp-report"];
  if (report !== undefined) {
    logger.warn(
      { csp: { directive: report["effective-directive"] ?? report["violated-directive"], blocked: originOf(report["blocked-uri"]), page: pathOf(report["document-uri"]), disposition: report.disposition } },
      "content security policy report",
    );
  }
  return new Response(null, { status: 204 });
}
