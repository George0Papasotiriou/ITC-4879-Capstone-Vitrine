/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * One tool call from a surface that talks to its model from the browser (voice): the same registry, guards and checks.
 */

import { z } from "zod";

import { routing } from "@/i18n/routing";
import { createRateLimiter } from "@/lib/ai/guardrails/rate-limit";
import { aiActor, toolServices, toolUser, usageStore } from "@/lib/ai/server";
import { findTool, needsApproval, runTool } from "@/lib/ai/tools/registry";
import { currentUser } from "@/lib/auth/session";
import { clientAddress } from "@/lib/geo/ip-country";
import { loggerForRequest } from "@/lib/log";

/**
 * In a voice session the audio goes between the browser and the provider, so
 * the model's tool calls arrive here from the browser (docs/PLAN.md 2.5). They
 * run through the same registry as chat, as the same person, under the same
 * kill switch and budget. A tool that asks first is refused until the page
 * sends `approved: true`, which it does only after the shopper taps the
 * on-screen approval button that mirrors the spoken confirmation.
 */

export const runtime = "nodejs";

const perAddress = createRateLimiter({ limit: 60, windowMs: 60_000 });

const bodySchema = z.object({
  name: z.string().regex(/^[a-z_]{3,40}$/),
  input: z.unknown(),
  locale: z.enum(routing.locales).catch(routing.defaultLocale),
  surface: z.enum(["voice"]).default("voice"),
  approved: z.boolean().optional(),
});

export async function POST(request: Request): Promise<Response> {
  const body = bodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return Response.json({ ok: false, reason: "invalid_request" }, { status: 400 });
  if (!perAddress(clientAddress(request.headers) ?? "unknown")) return Response.json({ ok: false, reason: "slow_down" }, { status: 429 });

  const tool = findTool(body.data.name, body.data.surface);
  if (tool === null) return Response.json({ ok: false, reason: "unknown_tool" }, { status: 404 });
  if (needsApproval(tool) && body.data.approved !== true) return Response.json({ ok: false, reason: "approval_required", tool: tool.name }, { status: 409 });

  const gate = await (await usageStore()).open();
  if (!gate.ok) return Response.json({ ok: false, reason: gate.reason }, { status: gate.reason === "off" ? 503 : 429 });

  const user = await currentUser();
  const locale = body.data.locale;
  const ctx = { locale, surface: body.data.surface, user: toolUser(user), actor: await aiActor(user), services: await toolServices({ locale, user }), signal: request.signal };
  const result = await runTool(tool, ctx, body.data.input);
  loggerForRequest(request.headers).info({ tool: { name: tool.name, surface: body.data.surface, ok: result.ok } }, "tool call");
  return result.ok ? Response.json({ ok: true, output: result.output }) : Response.json({ ok: false, reason: result.reason, issues: result.issues.slice(0, 5) }, { status: 422 });
}
