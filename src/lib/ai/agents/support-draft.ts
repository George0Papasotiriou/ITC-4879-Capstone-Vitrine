/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * The draft reply offered to an agent: written by the model, or from the desk's ready answers with no key.
 */

import { generateText, type LanguageModel } from "ai";

import { untrusted } from "@/lib/ai/guardrails/untrusted";
import { supportInstructions, SUPPORT_PROMPT_VERSION, type DraftContext } from "@/lib/ai/prompts/support-v1";
import type { Macro } from "@/lib/support/store";
import { renderMacro, type TicketTopic } from "@/lib/support/tickets";

/**
 * A draft is a suggestion (docs/adr/021): it is stored as a message marked
 * `draft`, shown only to staff, and becomes a reply when an agent sends it.
 *
 * With no AI key the draft comes from the desk's own ready answers, chosen by
 * the ticket's topic. That is not a model — it is the same text an agent would
 * pick from the macro list — but it makes the whole desk usable and testable
 * today, and it is labelled as coming from the ready answers.
 */

export const DRAFT_MAX_TOKENS = 400;

export type DraftConversation = { author: "customer" | "agent" | "ai" | "system"; body: string }[];

export type DraftResult = {
  body: string;
  /** What wrote it: a model id, or "macros" for the keyless draft. */
  source: string;
  prompt: string;
  usage: { inputTokens: number; outputTokens: number };
};

/** The ready answer that fits a topic, with the ticket's details filled in. */
export function macroDraft({ ticket, macros }: { ticket: DraftContext["ticket"] & { locale: string }; macros: readonly Macro[] }): string | null {
  const byTopic = macros.filter((macro) => macro.topic === ticket.topic);
  const chosen = byTopic[0] ?? macros.find((macro) => macro.key === "handed_over") ?? macros[0];
  if (chosen === undefined) return null;
  const body = ticket.locale === "el" ? chosen.bodyEl : chosen.bodyEn;
  // With no order to name, {order} stays visible: better a placeholder than a gap.
  const values: Record<string, string> = { name: ticket.name.split(" ")[0] ?? ticket.name, number: ticket.number };
  if (ticket.orderNumber !== null) values.order = ticket.orderNumber;
  return renderMacro(body, values);
}

/** The conversation as the model sees it: fenced, oldest first, and never longer than it needs to be. */
export function conversationText(messages: DraftConversation, limit = 8): string {
  return messages
    .slice(-limit)
    .map((message) => `${message.author}: ${untrusted(message.body, 800)}`)
    .join("\n\n");
}

export async function draftReply({
  model,
  modelId,
  context,
  messages,
  macros,
  abortSignal,
}: {
  /** Null when the shop has no model: the ready answers are used instead. */
  model: LanguageModel | null;
  modelId: string;
  context: DraftContext & { ticket: DraftContext["ticket"] & { locale: string } };
  messages: DraftConversation;
  macros: readonly Macro[];
  abortSignal?: AbortSignal;
}): Promise<DraftResult | null> {
  if (model === null) {
    const body = macroDraft({ ticket: context.ticket, macros });
    return body === null ? null : { body, source: "macros", prompt: "macros", usage: { inputTokens: 0, outputTokens: 0 } };
  }

  const result = await generateText({
    model,
    instructions: supportInstructions(context),
    prompt: conversationText(messages),
    maxOutputTokens: DRAFT_MAX_TOKENS,
    abortSignal,
  });

  const body = result.text.trim();
  if (body === "") return null;
  return {
    body,
    source: modelId,
    prompt: SUPPORT_PROMPT_VERSION,
    usage: { inputTokens: result.usage.inputTokens ?? 0, outputTokens: result.usage.outputTokens ?? 0 },
  };
}

/** A topic from what the customer wrote, so a new ticket lands in the right queue without asking them. */
export function guessTopic(text: string): TicketTopic {
  const words = text.toLowerCase();
  const has = (...terms: string[]) => terms.some((term) => words.includes(term));
  if (has("refund", "return", "broken", "damaged", "επιστροφ", "σπασ", "χαλασ")) return "returns";
  if (has("deliver", "shipping", "courier", "arrive", "παραδοσ", "αποστολ", "μεταφορ")) return "delivery";
  if (has("charge", "payment", "card", "invoice", "vat", "πληρωμ", "χρεωσ", "τιμολογ", "φπα")) return "payment";
  if (has("password", "sign in", "account", "two-step", "passkey", "λογαριασμ", "κωδικ", "συνδεσ")) return "account";
  if (has("size", "dimension", "material", "colour", "color", "fabric", "διασταση", "υλικ", "χρωμα", "υφασμ")) return "product";
  return "other";
}
