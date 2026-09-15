/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Budget Stylist API returning optimised product bundles for a request.
 */

import { ZodError } from "zod";

import { loggerForRequest } from "@/lib/log";
import { buildBundles } from "@/lib/stylist/server";

/**
 * Budget Stylist endpoint (A3), for the Concierge's `build_bundle` tool.
 *
 * POST a JSON request ({ template, budgetCents, avoidColors?, maxWidthCm?,
 * query? }); receive up to three bundles of product ids, quantities and
 * prices. Compact by design: the Concierge renders products from the database
 * by id, and never quotes a price it did not receive from here.
 */

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid_json", message: "Send the request as a JSON object." }, { status: 400 });
  }

  try {
    const result = await buildBundles(body);
    loggerForRequest(request.headers).info(
      { stylist: { template: result.request.template, bundles: result.bundles.length, elapsedMs: result.stats.elapsedMs, exact: result.stats.exact } },
      "stylist",
    );
    return Response.json(result, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof ZodError) {
      return Response.json(
        { error: "invalid_request", message: "Check template, budgetCents (whole cents) and colours.", issues: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })) },
        { status: 400 },
      );
    }
    throw error;
  }
}
