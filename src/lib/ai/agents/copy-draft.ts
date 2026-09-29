/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Product copy drafts for the staff: one model call, a checked shape, and every figure accounted for.
 */

import { generateText, Output, type LanguageModel } from "ai";
import { z } from "zod";

import { untrusted } from "@/lib/ai/guardrails/untrusted";
import { copyInstructions, COPY_PROMPT_VERSION, type CopyTask } from "@/lib/ai/prompts/copy-v1";

/**
 * docs/adr/045. Like the desk's reply drafts (ADR-021): the staff UI asks, a
 * person reads, and only their Save changes the shop. What the model returns
 * is checked against a schema, and the figures in the source — measurements,
 * counts, percentages — are looked for in the draft: a draft that dropped or
 * changed one comes back with that figure named, so the person checks it.
 */

export const COPY_MAX_TOKENS = 900;

export const copyDraftSchema = z.object({
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().max(1200),
  highlights: z.array(z.string().trim().min(1).max(200)).max(8),
});
export type CopyDraft = z.infer<typeof copyDraftSchema>;

export type CopySource = { title: string; description: string; highlights: readonly string[] };

export type CopyDraftResult = {
  draft: CopyDraft;
  /** Figures in the source the draft does not contain. */
  missingFigures: string[];
  model: string;
  prompt: string;
  usage: { inputTokens: number; outputTokens: number };
};

/**
 * The numbers in a text, normalised so "1.5" and "1,5" match (the Greek
 * decimal comma) and thousands separators do not split a number.
 */
export function figuresIn(text: string): string[] {
  const found = text.match(/\d+(?:[.,]\d+)*/g) ?? [];
  return [...new Set(found.map((figure) => figure.replace(/(\d)[.,](\d{3})(?!\d)/g, "$1$2").replace(",", ".")))];
}

/** Figures of the source that the draft lost. */
export function missingFigures(source: CopySource, draft: CopyDraft): string[] {
  const inDraft = new Set(figuresIn([draft.title, draft.description, ...draft.highlights].join(" ")));
  return figuresIn([source.title, source.description, ...source.highlights].join(" ")).filter((figure) => !inDraft.has(figure));
}

export async function draftCopy({ model, modelId, task, source, abortSignal }: { model: LanguageModel; modelId: string; task: CopyTask; source: CopySource; abortSignal?: AbortSignal }): Promise<CopyDraftResult | null> {
  const prompt = [
    `Title: ${untrusted(source.title, 300)}`,
    `Description: ${untrusted(source.description, 5000)}`,
    `Highlights: ${untrusted(source.highlights.join("\n"), 3000)}`,
  ].join("\n\n");
  const result = await generateText({
    model,
    instructions: copyInstructions(task),
    prompt,
    output: Output.object({ schema: copyDraftSchema }),
    maxOutputTokens: COPY_MAX_TOKENS,
    abortSignal,
  });
  const draft = copyDraftSchema.safeParse(result.output);
  if (!draft.success) return null;
  return {
    draft: draft.data,
    missingFigures: missingFigures(source, draft.data),
    model: modelId,
    prompt: COPY_PROMPT_VERSION,
    usage: { inputTokens: result.usage.inputTokens ?? 0, outputTokens: result.usage.outputTokens ?? 0 },
  };
}
