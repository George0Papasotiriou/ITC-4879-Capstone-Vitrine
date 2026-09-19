/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * The chat surface: the tool registry handed to the AI SDK's tool loop, with approvals, a step limit and usage recording.
 */

import { isStepCount, streamText, tool, type LanguageModel, type ModelMessage, type ToolSet } from "ai";

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

export function aiTools(surface: Surface, ctx: ToolContext): ToolSet {
  return Object.fromEntries(
    toolsFor(surface).map((entry) => [
      entry.name,
      tool({
        description: entry.description,
        inputSchema: entry.input,
        execute: async (input, { abortSignal }) => {
          const result = await runTool(entry, { ...ctx, signal: abortSignal }, input);
          // A refused input goes back to the model as a result it can correct, not as a crash.
          return result.ok ? result.output : { ok: false, reason: result.reason, issues: result.issues.slice(0, 5) };
        },
      }),
    ]),
  );
}

/** Asks the shopper before any costly or sensitive tool; everything else runs at once. */
export function approvalPolicy(surface: Surface) {
  return ({ toolCall }: { toolCall: { toolName: string } }) => {
    const entry = findTool(toolCall.toolName, surface);
    return entry !== null && needsApproval(entry) ? ("user-approval" as const) : undefined;
  };
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
}: {
  model: LanguageModel;
  instructions: string;
  messages: ModelMessage[];
  ctx: ToolContext;
  approvalSecret: string;
  abortSignal?: AbortSignal;
  onUsage: (usage: TurnUsage) => Promise<void> | void;
}) {
  return streamText({
    model,
    instructions,
    messages,
    tools: aiTools(ctx.surface, ctx),
    toolApproval: approvalPolicy(ctx.surface),
    experimental_toolApprovalSecret: approvalSecret,
    stopWhen: isStepCount(MAX_STEPS),
    abortSignal,
    onEnd: async ({ totalUsage, steps }) => {
      await onUsage({ inputTokens: totalUsage.inputTokens ?? 0, outputTokens: totalUsage.outputTokens ?? 0, steps: steps.length });
    },
  });
}
