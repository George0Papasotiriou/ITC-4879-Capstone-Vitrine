/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * The chat surface: the tool registry handed to the AI SDK's tool loop, with approvals, a step limit and usage recording.
 */

import { isStepCount, streamText, tool, type LanguageModel, type ModelMessage, type ToolSet, type UIMessage } from "ai";

import type { ConciergeEventInput } from "@/lib/admin/events";

import { findTool, needsApproval, runTool, toolsFor } from "@/lib/ai/tools/registry";
import type { Surface, ToolContext } from "@/lib/ai/tools/types";

/**
 * A thin adapter (CLAUDE.md rule 4): each registry tool becomes an AI SDK tool
 * whose `execute` runs the registry's `runTool`, so input and output are
 * checked the same way on every surface. Tools in the costly and sensitive
 * scopes are marked for the shopper's approval; the approval is signed by the
 * server (`experimental_toolApprovalSecret`), so a modified browser cannot
 * fabricate one. One turn may take at most eight steps (docs/PLAN.md Phase 6).
 */

export const MAX_STEPS = 8;

/** Where a surface sends what happened, for the Concierge dashboard (docs/adr/034). Counts and names only. */
export type EventSink = (events: ConciergeEventInput[]) => void;

export function aiTools(surface: Surface, ctx: ToolContext, onEvents?: EventSink): ToolSet {
  return Object.fromEntries(
    toolsFor(surface).map((entry) => [
      entry.name,
      tool({
        description: entry.description,
        inputSchema: entry.input,
        execute: async (input, { abortSignal }) => {
          const started = performance.now();
          const result = await runTool(entry, { ...ctx, signal: abortSignal }, input);
          onEvents?.([{ kind: "tool", surface, tool: entry.name, outcome: result.ok ? "ok" : "error", latencyMs: performance.now() - started }]);
          // A refused input goes back to the model as a result it can correct, not as a crash.
          return result.ok ? result.output : { ok: false, reason: result.reason, issues: result.issues.slice(0, 5) };
        },
      }),
    ]),
  );
}

/** Asks the shopper before any costly or sensitive tool; everything else runs at once. */
export function approvalPolicy(surface: Surface, onEvents?: EventSink) {
  return ({ toolCall }: { toolCall: { toolName: string } }) => {
    const entry = findTool(toolCall.toolName, surface);
    if (entry === null || !needsApproval(entry)) return undefined;
    onEvents?.([{ kind: "tool", surface, tool: entry.name, outcome: "approval_asked" }]);
    return "user-approval" as const;
  };
}

/**
 * The approvals a shopper has just answered, from the message that carries
 * the answers (the last assistant message of a continuation): which tool, and
 * yes or no. Only answers still waiting to be acted on are read, so the same
 * answer is never counted twice as the conversation grows.
 */
export function approvalAnswers(message: UIMessage | undefined): { tool: string; approved: boolean }[] {
  if (message === undefined || message.role !== "assistant") return [];
  return message.parts.flatMap((part) => {
    const candidate = part as { type: string; state?: string; toolName?: string; approval?: { approved?: boolean } };
    if (candidate.state !== "approval-responded" || typeof candidate.approval?.approved !== "boolean") return [];
    const tool = candidate.type === "dynamic-tool" ? candidate.toolName : candidate.type.startsWith("tool-") ? candidate.type.slice("tool-".length) : undefined;
    return tool === undefined ? [] : [{ tool, approved: candidate.approval.approved }];
  });
}

export type TurnUsage = { inputTokens: number; outputTokens: number; steps: number };

export function runTurn({
  model,
  instructions,
  messages,
  ctx,
  approvalSecret,
  abortSignal,
  onUsage,
  onEvents,
}: {
  model: LanguageModel;
  instructions: string;
  messages: ModelMessage[];
  ctx: ToolContext;
  approvalSecret: string;
  abortSignal?: AbortSignal;
  onUsage: (usage: TurnUsage) => Promise<void> | void;
  onEvents?: EventSink;
}) {
  const started = performance.now();
  return streamText({
    model,
    instructions,
    messages,
    tools: aiTools(ctx.surface, ctx, onEvents),
    toolApproval: approvalPolicy(ctx.surface, onEvents),
    experimental_toolApprovalSecret: approvalSecret,
    stopWhen: isStepCount(MAX_STEPS),
    abortSignal,
    onEnd: async ({ totalUsage, steps }) => {
      onEvents?.([{ kind: "turn", surface: ctx.surface, outcome: "ok", latencyMs: performance.now() - started, steps: steps.length }]);
      await onUsage({ inputTokens: totalUsage.inputTokens ?? 0, outputTokens: totalUsage.outputTokens ?? 0, steps: steps.length });
    },
  });
}
