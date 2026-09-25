/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * The support desk's rules: what a ticket may do next, how long there is to answer, and the shape of a message.
 */

/**
 * Support tickets (docs/adr/021). The rules live here, away from the database
 * and the request, because they are what the desk promises: a first reply
 * within a working day (docs/policies.md), a conversation that reopens when
 * the customer writes again, and one satisfaction question when it closes.
 */

export const TICKET_STATUSES = ["open", "waiting_customer", "resolved", "closed"] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export const TICKET_TOPICS = ["delivery", "returns", "product", "account", "payment", "other"] as const;
export type TicketTopic = (typeof TICKET_TOPICS)[number];

export const MESSAGE_AUTHORS = ["customer", "agent", "ai", "system"] as const;
export type MessageAuthor = (typeof MESSAGE_AUTHORS)[number];

/** The promise in docs/policies.md, in hours. */
export const FIRST_REPLY_HOURS = 24;

/** Left to answer before the timer turns from "due" to "soon". */
export const SOON_HOURS = 4;

/** A closed ticket that gets another message starts a new one instead of rising from the dead. */
export const REOPEN_WINDOW_DAYS = 14;

export const MAX_MESSAGE_LENGTH = 4_000;
export const MAX_SUBJECT_LENGTH = 90;

export type TicketEvent = "customer_message" | "agent_reply" | "resolve" | "close" | "reopen";

/**
 * What a ticket becomes. Returns null when the event does not apply, so a
 * caller says "that cannot happen" rather than writing a state nobody expects.
 *
 * - a customer's message always opens it again, unless it is closed;
 * - an agent's reply puts the ball in the customer's court;
 * - resolved is "we think this is done"; closed is final, and asks for a score.
 */
export function nextStatus(status: TicketStatus, event: TicketEvent): TicketStatus | null {
  if (status === "closed") return event === "reopen" ? "open" : null;
  switch (event) {
    case "customer_message":
      return "open";
    case "agent_reply":
      return "waiting_customer";
    case "resolve":
      return status === "resolved" ? null : "resolved";
    case "close":
      return "closed";
    case "reopen":
      return status === "open" ? null : "open";
  }
}

export type TicketSla = {
  dueAt: Date;
  /** Milliseconds left; negative once the time has passed. */
  msLeft: number;
  /** answered: a person has replied. due / soon / late: nobody has yet. */
  state: "answered" | "late" | "soon" | "due";
  /** The first reply came after the promise. */
  wasLate: boolean;
};

/** Where a ticket stands against the promise. */
export function ticketSla(
  ticket: { firstReplyDueAt: Date; firstReplyAt: Date | null; status: TicketStatus },
  now = new Date(),
): TicketSla {
  const msLeft = ticket.firstReplyDueAt.getTime() - now.getTime();
  if (ticket.firstReplyAt !== null) {
    return { dueAt: ticket.firstReplyDueAt, msLeft, state: "answered", wasLate: ticket.firstReplyAt.getTime() > ticket.firstReplyDueAt.getTime() };
  }
  // A ticket nobody has answered still counts against the clock, closed or not.
  const state = msLeft <= 0 ? "late" : msLeft <= SOON_HOURS * 60 * 60 * 1000 ? "soon" : "due";
  return { dueAt: ticket.firstReplyDueAt, msLeft, state, wasLate: false };
}

export const firstReplyDueAt = (createdAt: Date) => new Date(createdAt.getTime() + FIRST_REPLY_HOURS * 60 * 60 * 1000);

/**
 * The queue an agent works through: the ones nobody has answered first, oldest
 * promise first; then the rest, by when the customer last wrote.
 */
export function queueOrder<T extends { firstReplyAt: Date | null; firstReplyDueAt: Date; lastCustomerAt: Date }>(tickets: readonly T[]): T[] {
  return [...tickets].sort((a, b) => {
    const unanswered = Number(a.firstReplyAt === null) - Number(b.firstReplyAt === null);
    if (unanswered !== 0) return -unanswered;
    if (a.firstReplyAt === null && b.firstReplyAt === null) return a.firstReplyDueAt.getTime() - b.firstReplyDueAt.getTime();
    return a.lastCustomerAt.getTime() - b.lastCustomerAt.getTime();
  });
}

/** Whether a closed ticket is recent enough to take up again, rather than starting another. */
export function canReopen(ticket: { status: TicketStatus; closedAt: Date | null }, now = new Date()): boolean {
  if (ticket.status !== "closed") return true;
  if (ticket.closedAt === null) return false;
  return now.getTime() - ticket.closedAt.getTime() <= REOPEN_WINDOW_DAYS * 24 * 60 * 60 * 1000;
}

/** A message as it is stored: trimmed, without runs of blank lines, and never longer than the limit. */
export function cleanMessage(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MAX_MESSAGE_LENGTH);
}

/** A subject from the first line of what the customer wrote, when they gave none. */
export function subjectFrom(text: string): string {
  const firstLine = cleanMessage(text).split("\n")[0] ?? "";
  if (firstLine.length <= MAX_SUBJECT_LENGTH) return firstLine;
  const cut = firstLine.slice(0, MAX_SUBJECT_LENGTH);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > MAX_SUBJECT_LENGTH / 2 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

export function isTopic(value: unknown): value is TicketTopic {
  return typeof value === "string" && (TICKET_TOPICS as readonly string[]).includes(value);
}

/** 1 to 5, or null for anything else: a score nobody gave is not a zero. */
export function csatScore(value: unknown): number | null {
  const score = typeof value === "string" ? Number.parseInt(value, 10) : value;
  return typeof score === "number" && Number.isInteger(score) && score >= 1 && score <= 5 ? score : null;
}

/**
 * A ready answer with the ticket's own details filled in. Anything the values
 * do not name is left as it was written, so a macro with a typo shows the typo
 * rather than an empty space the agent might not notice.
 */
export function renderMacro(body: string, values: Readonly<Record<string, string>>): string {
  return body.replace(/\{(\w+)\}/g, (whole, key: string) => values[key] ?? whole);
}

/** The average score, to one decimal, or null when nobody has answered. */
export function satisfaction(scores: readonly number[]): { count: number; average: number | null } {
  const valid = scores.filter((score) => csatScore(score) !== null);
  if (valid.length === 0) return { count: 0, average: null };
  return { count: valid.length, average: Math.round((valid.reduce((sum, score) => sum + score, 0) / valid.length) * 10) / 10 };
}

/** A topic from what the customer wrote, so a new ticket lands in the right queue without asking them. */
export function guessTopic(text: string): TicketTopic {
  // Accents off first: Greek is written with them ("παράδοση"), and the stems
  // below are written without, so a message with accents matched nothing.
  const words = text.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
  const has = (...terms: string[]) => terms.some((term) => words.includes(term));
  if (has("refund", "return", "broken", "damaged", "επιστροφ", "σπασ", "χαλασ")) return "returns";
  if (has("deliver", "shipping", "courier", "arrive", "παραδοσ", "αποστολ", "μεταφορ")) return "delivery";
  if (has("charge", "payment", "card", "invoice", "vat", "πληρωμ", "χρεωσ", "τιμολογ", "φπα")) return "payment";
  if (has("password", "sign in", "account", "two-step", "passkey", "λογαριασμ", "κωδικ", "συνδεσ")) return "account";
  if (has("size", "dimension", "material", "colour", "color", "fabric", "διασταση", "υλικ", "χρωμα", "υφασμ")) return "product";
  return "other";
}

/**
 * Where the Concierge leaves a guest's approved summary for the contact form
 * (docs/adr/027). Session storage, in this tab only: the summary never travels
 * in a URL, and the guest's email is typed into the form, never into a chat.
 */
export const CONTACT_DRAFT_KEY = "vitrine:contact-draft";
