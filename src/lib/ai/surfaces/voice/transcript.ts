/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * A realtime spoken conversation written into the Concierge's conversation: what was said, and each tool it used.
 */

import type { UIMessage } from "ai";

/**
 * docs/adr/030. A realtime session keeps its own record of the conversation,
 * but the dock shows one: the Concierge's. So what the shopper says, what the
 * Concierge answers and every tool it uses are written into that conversation
 * as ordinary messages and tool parts. The dock then shows spoken turns
 * exactly like typed ones — product cards, approvals, the hand-over card — and
 * the page actions run through the same code (the Spotlight, the undo), with
 * no second path to keep in step.
 *
 * Pure functions over the message list, so the ordering rules can be tested
 * without a socket: the shopper's words can arrive after the answer has begun
 * (transcription runs beside the model), so their message is placed when the
 * shopper stops speaking and filled in when the words arrive.
 */

export type SpokenRole = "user" | "assistant";

type Part = UIMessage["parts"][number];

const spokenMessage = (id: string, role: SpokenRole, text: string): UIMessage => ({
  id,
  role,
  parts: [{ type: "text", text }],
  metadata: { spoken: true },
});

/** The text of a message, as one string. */
export function messageText(message: UIMessage): string {
  return message.parts.map((part) => (part.type === "text" ? part.text : "")).join("");
}

/**
 * Sets (or, with `append`, extends) the words of a spoken message, adding the
 * message at the end if it is not there yet. The text part is kept last, so an
 * answer's words follow the tools it used.
 */
export function withSpeech(messages: UIMessage[], { id, role, text, append = false }: { id: string; role: SpokenRole; text: string; append?: boolean }): UIMessage[] {
  const index = messages.findIndex((message) => message.id === id);
  if (index === -1) return [...messages, spokenMessage(id, role, text)];
  const current = messages[index]!;
  const words = append ? messageText(current) + text : text;
  const next: UIMessage = { ...current, parts: [...current.parts.filter((part) => part.type !== "text"), { type: "text", text: words }] };
  return messages.map((message, position) => (position === index ? next : message));
}

/**
 * Adds a tool part to the answer `messageId`, or replaces the part with the
 * same call id (an approval card becoming its result). Placed before the
 * answer's words, which are always last.
 */
export function withToolPart(messages: UIMessage[], { messageId, part }: { messageId: string; part: Part & { toolCallId: string } }): UIMessage[] {
  const index = messages.findIndex((message) => message.id === messageId);
  if (index === -1) return [...messages, { id: messageId, role: "assistant", parts: [part], metadata: { spoken: true } }];
  const current = messages[index]!;
  const same = (candidate: Part) => "toolCallId" in candidate && candidate.toolCallId === part.toolCallId;
  const parts = current.parts.some(same)
    ? current.parts.map((candidate) => (same(candidate) ? part : candidate))
    : [...current.parts.filter((candidate) => candidate.type !== "text"), part, ...current.parts.filter((candidate) => candidate.type === "text")];
  return messages.map((message, position) => (position === index ? { ...current, parts } : message));
}

/** Drops spoken messages that never got any words or tools: a pause the model did not answer. */
export function withoutEmptySpeech(messages: UIMessage[]): UIMessage[] {
  return messages.filter((message) => (message.metadata as { spoken?: boolean } | undefined)?.spoken !== true || message.parts.some((part) => part.type !== "text" || part.text.trim() !== ""));
}
