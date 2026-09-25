/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * The desk's ready answers as the staff edit them: what an answer may say, and the key a new one is filed under.
 */

import { z } from "zod";

import { TICKET_TOPICS } from "@/lib/support/tickets";

/**
 * Ready answers (docs/adr/029). They are the words the desk's drafts start
 * from, so an edit here changes what customers read — which is why an answer
 * is checked before it is saved rather than when it is sent.
 */

/** The only blanks a ready answer may leave; the draft fills them from the ticket. */
export const ANSWER_PLACEHOLDERS = ["name", "number", "order"] as const;

export const MAX_ANSWER_TITLE = 80;
export const MAX_ANSWER_BODY = 4_000;

/** Every `{word}` in a text, in order, once each. */
export function placeholdersIn(text: string): string[] {
  return [...new Set([...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]!))];
}

/**
 * Blanks the draft cannot fill. A `{customer}` typed by mistake would reach a
 * customer as the literal word in braces, so it is refused with the list of
 * the ones that work.
 */
export function unknownPlaceholders(text: string): string[] {
  return placeholdersIn(text).filter((name) => !(ANSWER_PLACEHOLDERS as readonly string[]).includes(name));
}

const title = z.string().trim().min(2, "too_short").max(MAX_ANSWER_TITLE, "too_long");
const body = z
  .string()
  .trim()
  .min(10, "too_short")
  .max(MAX_ANSWER_BODY, "too_long")
  .superRefine((text, context) => {
    const unknown = unknownPlaceholders(text);
    if (unknown.length > 0) context.addIssue({ code: "custom", message: "unknown_placeholder", params: { names: unknown } });
  });

/** An answer as the editor sends it, in both languages: the desk answers in the customer's. */
export const answerInputSchema = z.object({
  topic: z.enum(TICKET_TOPICS),
  titleEn: title,
  titleEl: title,
  bodyEn: body,
  bodyEl: body,
  sort: z.number().int().min(0).max(999),
});

export type AnswerInput = z.output<typeof answerInputSchema>;

/**
 * The key a new answer is filed under: its English title in lower case with
 * underscores, and a number after it if the key is taken. The shop's own
 * answers keep their keys, so a new one can never replace one of them.
 */
export function answerKey(titleEn: string, taken: ReadonlySet<string>): string {
  const base =
    titleEn
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 48) || "answer";
  if (!taken.has(base)) return base;
  let suffix = 2;
  while (taken.has(`${base}_${suffix}`)) suffix += 1;
  return `${base}_${suffix}`;
}
