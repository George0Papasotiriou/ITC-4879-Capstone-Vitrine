/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * The Concierge's chat endpoint: checks the guards, runs one turn of the tool loop, and streams it to the dock.
 */

import { convertToModelMessages, createUIMessageStreamResponse, safeValidateUIMessages, toUIMessageStream, type UIMessage } from "ai";
import { z } from "zod";

import { routing } from "@/i18n/routing";
import { logConciergeEvents } from "@/lib/admin/server";
import { parsePageMap } from "@/lib/ai/guardrails/page-map";
import { sharedRateLimiter } from "@/lib/kv/rate-limit";
import { MODELS } from "@/lib/ai/models";
import { CONCIERGE_PROMPT_VERSION, conciergeInstructions } from "@/lib/ai/prompts/concierge-v1";
import { textModel } from "@/lib/ai/providers";
import { aiActor, aiMode, approvalSecret, conciergeCart, toolServices, toolUser, usageStore } from "@/lib/ai/server";
import { approvalAnswers, runTurn } from "@/lib/ai/surfaces/chat";
import { currentUser } from "@/lib/auth/session";
import { clientAddress } from "@/lib/geo/ip-country";
import { loggerForRequest } from "@/lib/log";
import { serverEnv } from "@/env";

/**
 * docs/PLAN.md Phase 6, docs/adr/019. In order: the request's shape, the rate
 * limit per address, the mode, kill switch and budget, then — for a new
 * message, not for an approval being answered — one turn from the shopper's
 * daily allowance. Messages are capped in number and length, so one request
 * cannot carry an unbounded prompt. Refusals are JSON with a reason the dock
 * explains in the shopper's language.
 */

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_MESSAGES = 16;
const MAX_TEXT = 2_000;
const perAddress = sharedRateLimiter({ name: "concierge", limit: 20, windowMs: 60_000 });

const bodySchema = z.object({
  messages: z.array(z.unknown()).min(1).max(200),
  locale: z.enum(routing.locales).catch(routing.defaultLocale),
  pageMap: z.unknown().optional(),
  /** True when the question was spoken and the answer will be read aloud (docs/adr/026). */
  spoken: z.boolean().optional(),
});

const refuse = (reason: string, status: number) => Response.json({ ok: false, reason }, { status });

export async function POST(request: Request): Promise<Response> {
  const body = bodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return refuse("invalid_request", 400);
  if (!(await perAddress(clientAddress(request.headers) ?? "unknown"))) return refuse("slow_down", 429);

  const validated = await safeValidateUIMessages({ messages: body.data.messages.slice(-MAX_MESSAGES) });
  if (!validated.success) return refuse("invalid_request", 400);
  const messages = validated.data as UIMessage[];
  const tooLong = messages.some((message) => message.parts.some((part) => part.type === "text" && part.text.length > MAX_TEXT));
  if (tooLong) return refuse("too_long", 413);

  const locale = body.data.locale;
  const user = await currentUser();
  const actor = await aiActor(user);
  const usage = await usageStore();
  const env = serverEnv();
  // A new question takes a turn; answering an approval card continues the same turn.
  const gate = messages.at(-1)?.role === "user" ? await usage.takeTurn(actor) : await usage.open();
  const surface = body.data.spoken === true ? ("voice" as const) : ("chat" as const);
  if (!gate.ok) {
    logConciergeEvents([{ kind: "refused", surface, outcome: gate.reason }]);
    return refuse(gate.reason, gate.reason === "off" ? 503 : 429);
  }
  // Approvals the shopper has just answered, yes or no (docs/adr/034).
  logConciergeEvents(approvalAnswers(messages.at(-1)).map((answer) => ({ kind: "tool" as const, surface, tool: answer.tool, outcome: answer.approved ? ("approved" as const) : ("declined" as const) })));

  const chosen = textModel(aiMode(), MODELS.concierge, { locale, apiKey: env.GOOGLE_GENERATIVE_AI_API_KEY });
  if (chosen === null) return refuse("off", 503);

  // Both cookies are written before the stream starts: nothing can be set once it has.
  const cart = await conciergeCart();
  const spoken = body.data.spoken === true;
  // What was said, as plain text: a hand-over carries it to the person who
  // takes over (docs/adr/027). Only the words — no tool output, no prices.
  const conversation = messages
    .map((message) => {
      const text = message.parts.map((part) => (part.type === "text" ? part.text : "")).join(" ").trim();
      return text === "" ? null : `${message.role === "user" ? "Shopper" : "Concierge"}: ${text}`;
    })
    .filter((line): line is string => line !== null)
    .join("\n");
  const services = await toolServices({ locale, user, cart, conversation });
  const ctx = { locale, surface, user: toolUser(user), actor, services };
  const log = loggerForRequest(request.headers);
  const started = performance.now();
  const result = runTurn({
    model: chosen.model,
    instructions: conciergeInstructions({ locale, pageMap: parsePageMap(body.data.pageMap), signedIn: user !== null, spoken }),
    messages: await convertToModelMessages(messages),
    ctx,
    approvalSecret: approvalSecret(),
    abortSignal: request.signal,
    onEvents: logConciergeEvents,
    onUsage: async (turn) => {
      const cost = await usage.record({ feature: "concierge", model: chosen.entry, surface: "chat", actorKey: actor.key, usage: turn });
      // Counts only: no message text, no tool inputs (CLAUDE.md rule 9).
      log.info({ concierge: { prompt: CONCIERGE_PROMPT_VERSION, mode: aiMode(), steps: turn.steps, inputTokens: turn.inputTokens, outputTokens: turn.outputTokens, costMicros: cost } }, "concierge turn");
    },
  });

  return createUIMessageStreamResponse({
    stream: toUIMessageStream({
      stream: result.stream,
      originalMessages: messages,
      // The dock labels demo answers, so no one mistakes the rules for a model.
      messageMetadata: ({ part }) => (part.type === "start" ? { demo: aiMode() === "demo", prompt: CONCIERGE_PROMPT_VERSION } : undefined),
      onError: (error) => {
        log.error({ err: error }, "concierge turn failed");
        logConciergeEvents([{ kind: "turn", surface, outcome: "error", latencyMs: performance.now() - started, steps: 0 }]);
        return "The Concierge could not answer that. Please try again.";
      },
    }),
  });
}
