/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * One tool call from a surface whose model is in the browser (voice, WebMCP): the same registry, guards and checks.
 */

import { z } from "zod";

import { routing } from "@/i18n/routing";
import { logConciergeEvents } from "@/lib/admin/server";
import { sharedRateLimiter } from "@/lib/kv/rate-limit";
import { aiActor, conciergeCart, toolServices, toolUser, usageStore } from "@/lib/ai/server";
import { mcpDefinition, withPageDefaults } from "@/lib/ai/surfaces/mcp/tools";
import { UNTRUSTED_CONTENT_TOOLS, WEBMCP_TOOLS } from "@/lib/ai/surfaces/webmcp";
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
 *
 * WebMCP (docs/adr/043): an assistant built into the shopper's browser calls
 * the tools the page registered for it. Only those tools, none that asks
 * first, and no AI budget is spent (the assistant's model is the browser's);
 * the kill switch still stops it.
 */

export const runtime = "nodejs";

const perAddress = sharedRateLimiter({ name: "concierge-tools", limit: 60, windowMs: 60_000 });

const bodySchema = z.object({
  name: z.string().regex(/^[a-z_]{3,40}$/),
  input: z.unknown(),
  locale: z.enum(routing.locales).catch(routing.defaultLocale),
  surface: z.enum(["voice", "webmcp"]).default("voice"),
  approved: z.boolean().optional(),
});

export async function POST(request: Request): Promise<Response> {
  const body = bodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return Response.json({ ok: false, reason: "invalid_request" }, { status: 400 });
  if (!(await perAddress(clientAddress(request.headers) ?? "unknown"))) return Response.json({ ok: false, reason: "slow_down" }, { status: 429 });

  const webmcp = body.data.surface === "webmcp";
  const tool = webmcp && !WEBMCP_TOOLS.includes(body.data.name) ? null : findTool(body.data.name, body.data.surface);
  if (tool === null) return Response.json({ ok: false, reason: "unknown_tool" }, { status: 404 });
  if (needsApproval(tool) && body.data.approved !== true) return Response.json({ ok: false, reason: "approval_required", tool: tool.name }, { status: 409 });

  const gate = await (await usageStore()).open();
  if (!gate.ok && (!webmcp || gate.reason === "kill_switch")) return Response.json({ ok: false, reason: gate.reason }, { status: gate.reason === "off" ? 503 : 429 });

  const user = await currentUser();
  const locale = body.data.locale;
  const ctx = { locale, surface: body.data.surface, user: toolUser(user), actor: await aiActor(user), services: await toolServices({ locale, user, cart: await conciergeCart() }), signal: request.signal };
  const started = performance.now();
  const result = await runTool(tool, ctx, webmcp ? withPageDefaults(tool, body.data.input ?? {}) : body.data.input);
  logConciergeEvents([{ kind: "tool", surface: body.data.surface, tool: tool.name, outcome: result.ok ? "ok" : "error", latencyMs: performance.now() - started }]);
  loggerForRequest(request.headers).info({ tool: { name: tool.name, surface: body.data.surface, ok: result.ok } }, "tool call");
  return result.ok ? Response.json({ ok: true, output: result.output }) : Response.json({ ok: false, reason: result.reason, issues: result.issues.slice(0, 5) }, { status: 422 });
}

/** The tools a WebMCP page registers, described once for every page (docs/adr/043). */
export function GET(request: Request): Response {
  if (new URL(request.url).searchParams.get("surface") !== "webmcp") return Response.json({ ok: false, reason: "unknown_surface" }, { status: 404 });
  const tools = WEBMCP_TOOLS.map((name) => findTool(name, "webmcp"))
    .filter((tool) => tool !== null)
    .map((tool) => {
      const definition = mcpDefinition(tool);
      return { ...definition, annotations: { readOnlyHint: definition.annotations?.readOnlyHint === true, untrustedContentHint: UNTRUSTED_CONTENT_TOOLS.includes(tool.name), consequentialHint: tool.scope === "cart" } };
    });
  return Response.json({ tools }, { headers: { "cache-control": "public, max-age=300" } });
}
