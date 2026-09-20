/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * The support desk in the database: tickets, their messages, the queue, drafts, macros and satisfaction.
 */

import type postgres from "postgres";
import { uuidv7 } from "uuidv7";

import {
  canReopen,
  cleanMessage,
  csatScore,
  firstReplyDueAt,
  nextStatus,
  queueOrder,
  subjectFrom,
  type MessageAuthor,
  type TicketEvent,
  type TicketStatus,
  type TicketTopic,
} from "@/lib/support/tickets";

/**
 * Support tickets (docs/adr/021). Every write goes through one of these
 * functions, because a message and what it does to the ticket — its status,
 * the reply clock, when the customer last wrote — have to happen together or
 * not at all.
 *
 * Who may see a ticket is decided by the caller: the account it belongs to,
 * the link token a guest was given, or a member of staff.
 */

type Sql = postgres.Sql;

export type TicketSummary = {
  id: string;
  number: string;
  subject: string;
  status: TicketStatus;
  topic: TicketTopic;
  locale: string;
  email: string;
  name: string;
  userId: string | null;
  orderId: string | null;
  orderNumber: string | null;
  assignedTo: string | null;
  assignedEmail: string | null;
  firstReplyDueAt: Date;
  firstReplyAt: Date | null;
  lastCustomerAt: Date;
  closedAt: Date | null;
  csatScore: number | null;
  createdAt: Date;
  messageCount: number;
  /** A draft is waiting for an agent to read it. */
  hasDraft: boolean;
};

export type TicketMessage = {
  id: string;
  author: MessageAuthor;
  authorEmail: string | null;
  body: string;
  draft: boolean;
  internal: boolean;
  model: string | null;
  createdAt: Date;
};

export type Ticket = TicketSummary & { messages: TicketMessage[] };

export type NewTicket = {
  /** Chosen by the caller, because the ticket's private link is derived from it. */
  id: string;
  number: string;
  subject: string | null;
  body: string;
  topic: TicketTopic;
  locale: string;
  email: string;
  name: string;
  userId: string | null;
  orderId: string | null;
  accessTokenHash: string;
};

export type Macro = { id: string; key: string; topic: string; titleEn: string; titleEl: string; bodyEn: string; bodyEl: string; sort: number };

type TicketRow = {
  id: string;
  number: string;
  subject: string;
  status: TicketStatus;
  topic: TicketTopic;
  locale: string;
  email: string;
  name: string;
  user_id: string | null;
  order_id: string | null;
  order_number: string | null;
  assigned_to: string | null;
  assigned_email: string | null;
  first_reply_due_at: Date;
  first_reply_at: Date | null;
  last_customer_at: Date;
  closed_at: Date | null;
  csat_score: number | null;
  created_at: Date;
  message_count: number;
  has_draft: boolean;
};

function toSummary(row: TicketRow): TicketSummary {
  return {
    id: row.id,
    number: row.number,
    subject: row.subject,
    status: row.status,
    topic: row.topic,
    locale: row.locale,
    email: row.email,
    name: row.name,
    userId: row.user_id,
    orderId: row.order_id,
    orderNumber: row.order_number,
    assignedTo: row.assigned_to,
    assignedEmail: row.assigned_email,
    firstReplyDueAt: new Date(row.first_reply_due_at),
    firstReplyAt: row.first_reply_at === null ? null : new Date(row.first_reply_at),
    lastCustomerAt: new Date(row.last_customer_at),
    closedAt: row.closed_at === null ? null : new Date(row.closed_at),
    csatScore: row.csat_score,
    createdAt: new Date(row.created_at),
    messageCount: Number(row.message_count),
    hasDraft: row.has_draft,
  };
}

export function createSupportStore(sql: Sql) {
  const ticketsWhere = async (where: postgres.PendingQuery<postgres.Row[]>, limit: number): Promise<TicketSummary[]> => {
    const rows = await sql<TicketRow[]>`
      SELECT t.id, t.number, t.subject, t.status, t.topic, t.locale, t.email, t.name, t.user_id, t.order_id, o.number AS order_number,
             t.assigned_to, u.email AS assigned_email, t.first_reply_due_at, t.first_reply_at, t.last_customer_at, t.closed_at,
             t.csat_score, t.created_at,
             (SELECT count(*)::int FROM support_messages m WHERE m.ticket_id = t.id AND m.draft = false AND m.internal = false) AS message_count,
             EXISTS (SELECT 1 FROM support_messages m WHERE m.ticket_id = t.id AND m.draft = true) AS has_draft
      FROM support_tickets t
      LEFT JOIN orders o ON o.id = t.order_id
      LEFT JOIN users u ON u.id = t.assigned_to
      WHERE ${where}
      ORDER BY t.created_at DESC
      LIMIT ${limit}
    `;
    return rows.map(toSummary);
  };

  /** A ticket and its first message, written together. */
  async function open(ticket: NewTicket, at = new Date()): Promise<{ id: string; number: string }> {
    const body = cleanMessage(ticket.body);
    const id = ticket.id;
    await sql.begin(async (tx) => {
      await tx`
        INSERT INTO support_tickets (id, number, subject, status, topic, locale, email, name, user_id, order_id,
                                     first_reply_due_at, last_customer_at, access_token_hash, created_at, updated_at)
        VALUES (${id}, ${ticket.number}, ${ticket.subject ?? subjectFrom(body)}, 'open', ${ticket.topic}, ${ticket.locale},
                ${ticket.email.toLowerCase()}, ${ticket.name}, ${ticket.userId}, ${ticket.orderId},
                ${firstReplyDueAt(at).toISOString()}::timestamptz, ${at.toISOString()}::timestamptz, ${ticket.accessTokenHash},
                ${at.toISOString()}::timestamptz, ${at.toISOString()}::timestamptz)
      `;
      await tx`
        INSERT INTO support_messages (id, ticket_id, author, author_user_id, body, draft, internal, created_at)
        VALUES (${uuidv7()}, ${id}, 'customer', ${ticket.userId}, ${body}, false, false, ${at.toISOString()}::timestamptz)
      `;
    });
    return { id, number: ticket.number };
  }

  /**
   * Adds a message and moves the ticket with it. A draft or an internal note
   * moves nothing: neither is a reply until an agent sends it.
   */
  async function addMessage(
    ticketId: string,
    message: { author: MessageAuthor; authorUserId?: string | null; body: string; draft?: boolean; internal?: boolean; model?: string | null },
    at = new Date(),
  ): Promise<{ ok: true; messageId: string; status: TicketStatus; reopened: boolean } | { ok: false; reason: "not_found" | "closed" }> {
    const body = cleanMessage(message.body);
    return sql.begin(async (tx) => {
      const [current] = await tx<{ status: TicketStatus; closed_at: Date | null }[]>`
        SELECT status, closed_at FROM support_tickets WHERE id = ${ticketId} FOR UPDATE
      `;
      if (current === undefined) return { ok: false, reason: "not_found" } as const;

      const draft = message.draft === true;
      const internal = message.internal === true;
      const spoken = !draft && !internal;
      const status = current.status;
      const fromCustomer = spoken && message.author === "customer";
      const answers = spoken && (message.author === "agent" || message.author === "ai");
      let next: TicketStatus = status;
      let reopened = false;

      if (fromCustomer) {
        if (status === "closed") {
          // A closed ticket takes another message only while it is recent (docs/adr/021).
          if (!canReopen({ status, closedAt: current.closed_at === null ? null : new Date(current.closed_at) }, at)) return { ok: false, reason: "closed" } as const;
          next = "open";
          reopened = true;
        } else {
          next = nextStatus(status, "customer_message") ?? status;
        }
      }
      if (answers) {
        if (status === "closed") return { ok: false, reason: "closed" } as const;
        next = nextStatus(status, "agent_reply") ?? status;
      }

      const messageId = uuidv7();
      // At most one unsent draft per ticket: a new one replaces the one nobody sent.
      if (draft) await tx`DELETE FROM support_messages WHERE ticket_id = ${ticketId} AND draft = true`;
      await tx`
        INSERT INTO support_messages (id, ticket_id, author, author_user_id, body, draft, internal, model, created_at)
        VALUES (${messageId}, ${ticketId}, ${message.author}, ${message.authorUserId ?? null}, ${body}, ${draft}, ${internal},
                ${message.model ?? null}, ${at.toISOString()}::timestamptz)
      `;

      if (reopened) {
        // A question asked again deserves its own promise, so the clock starts over.
        await tx`
          UPDATE support_tickets SET status = 'open', first_reply_at = NULL, first_reply_due_at = ${firstReplyDueAt(at).toISOString()}::timestamptz,
                 last_customer_at = ${at.toISOString()}::timestamptz, closed_at = NULL, updated_at = ${at.toISOString()}::timestamptz
          WHERE id = ${ticketId}
        `;
      } else {
        // The clock stops at the first reply the customer can read, whoever wrote it.
        await tx`
          UPDATE support_tickets SET status = ${next},
                 first_reply_at = COALESCE(first_reply_at, ${answers ? at.toISOString() : null}::timestamptz),
                 last_customer_at = COALESCE(${fromCustomer ? at.toISOString() : null}::timestamptz, last_customer_at),
                 updated_at = ${at.toISOString()}::timestamptz
          WHERE id = ${ticketId}
        `;
      }
      return { ok: true, messageId, status: next, reopened } as const;
    });
  }

  /** An agent sends a draft, with whatever edits they made to it. */
  async function sendDraft(
    messageId: string,
    { body, agentUserId }: { body: string; agentUserId: string },
    at = new Date(),
  ): Promise<{ ok: true; ticketId: string; status: TicketStatus } | { ok: false; reason: "not_found" | "closed" }> {
    const text = cleanMessage(body);
    return sql.begin(async (tx) => {
      const [draft] = await tx<{ ticket_id: string; status: TicketStatus }[]>`
        SELECT m.ticket_id, t.status FROM support_messages m JOIN support_tickets t ON t.id = m.ticket_id
        WHERE m.id = ${messageId} AND m.draft = true
        FOR UPDATE OF t
      `;
      if (draft === undefined) return { ok: false, reason: "not_found" } as const;
      if (draft.status === "closed") return { ok: false, reason: "closed" } as const;

      // It becomes the agent's message: they read it, changed it and stand behind it.
      await tx`
        UPDATE support_messages SET draft = false, author = 'agent', author_user_id = ${agentUserId}, body = ${text}, created_at = ${at.toISOString()}::timestamptz
        WHERE id = ${messageId}
      `;
      await tx`
        UPDATE support_tickets SET status = 'waiting_customer',
               first_reply_at = COALESCE(first_reply_at, ${at.toISOString()}::timestamptz),
               updated_at = ${at.toISOString()}::timestamptz
        WHERE id = ${draft.ticket_id}
      `;
      return { ok: true, ticketId: draft.ticket_id, status: "waiting_customer" as const } as const;
    });
  }

  /** Throws away a draft nobody sent. */
  async function discardDraft(messageId: string): Promise<boolean> {
    const rows = await sql<{ id: string }[]>`DELETE FROM support_messages WHERE id = ${messageId} AND draft = true RETURNING id`;
    return rows.length > 0;
  }

  /** Resolve, close or reopen, from the desk. */
  async function move(
    ticketId: string,
    event: Extract<TicketEvent, "resolve" | "close" | "reopen">,
    at = new Date(),
  ): Promise<{ ok: true; status: TicketStatus } | { ok: false; reason: "not_found" | "not_allowed" }> {
    return sql.begin(async (tx) => {
      const [current] = await tx<{ status: TicketStatus }[]>`SELECT status FROM support_tickets WHERE id = ${ticketId} FOR UPDATE`;
      if (current === undefined) return { ok: false, reason: "not_found" } as const;
      const next = nextStatus(current.status, event);
      if (next === null) return { ok: false, reason: "not_allowed" } as const;
      await tx`
        UPDATE support_tickets SET status = ${next},
               resolved_at = CASE WHEN ${next === "resolved"} THEN ${at.toISOString()}::timestamptz WHEN ${next === "open"} THEN NULL ELSE resolved_at END,
               closed_at = CASE WHEN ${next === "closed"} THEN ${at.toISOString()}::timestamptz WHEN ${next === "open"} THEN NULL ELSE closed_at END,
               first_reply_due_at = CASE WHEN ${next === "open"} THEN ${firstReplyDueAt(at).toISOString()}::timestamptz ELSE first_reply_due_at END,
               updated_at = ${at.toISOString()}::timestamptz
        WHERE id = ${ticketId}
      `;
      return { ok: true, status: next } as const;
    });
  }

  /** Gives a ticket to an agent, or takes it back with null. */
  async function assign(ticketId: string, agentUserId: string | null, at = new Date()): Promise<boolean> {
    const rows = await sql<{ id: string }[]>`
      UPDATE support_tickets SET assigned_to = ${agentUserId}, updated_at = ${at.toISOString()}::timestamptz WHERE id = ${ticketId} RETURNING id
    `;
    return rows.length > 0;
  }

  /** The customer's answer to the one question asked when a ticket closes. */
  async function saveSatisfaction(ticketId: string, score: unknown, comment: string | null, at = new Date()): Promise<boolean> {
    const value = csatScore(score);
    if (value === null) return false;
    const rows = await sql<{ id: string }[]>`
      UPDATE support_tickets SET csat_score = ${value}, csat_comment = ${comment === null ? null : cleanMessage(comment).slice(0, 500)},
             csat_answered_at = ${at.toISOString()}::timestamptz, updated_at = ${at.toISOString()}::timestamptz
      WHERE id = ${ticketId} AND status = 'closed'
      RETURNING id
    `;
    return rows.length > 0;
  }

  async function byId(ticketId: string, { withDrafts = false }: { withDrafts?: boolean } = {}): Promise<Ticket | null> {
    const [ticket] = await ticketsWhere(sql`t.id = ${ticketId}`, 1);
    if (ticket === undefined) return null;
    const rows = await sql<{
      id: string;
      author: MessageAuthor;
      author_email: string | null;
      body: string;
      draft: boolean;
      internal: boolean;
      model: string | null;
      created_at: Date;
    }[]>`
      SELECT m.id, m.author, u.email AS author_email, m.body, m.draft, m.internal, m.model, m.created_at
      FROM support_messages m LEFT JOIN users u ON u.id = m.author_user_id
      WHERE m.ticket_id = ${ticketId} AND (${withDrafts} OR (m.draft = false AND m.internal = false))
      ORDER BY m.created_at, m.id
    `;
    return {
      ...ticket,
      messages: rows.map((message) => ({
        id: message.id,
        author: message.author,
        authorEmail: message.author_email,
        body: message.body,
        draft: message.draft,
        internal: message.internal,
        model: message.model,
        createdAt: new Date(message.created_at),
      })),
    };
  }

  async function byNumber(number: string): Promise<TicketSummary | null> {
    const [ticket] = await ticketsWhere(sql`t.number = ${number.toUpperCase()}`, 1);
    return ticket ?? null;
  }

  /** The token a guest was given, checked against the stored hash by the caller. */
  async function tokenHash(ticketId: string): Promise<string | null> {
    const [row] = await sql<{ access_token_hash: string }[]>`SELECT access_token_hash FROM support_tickets WHERE id = ${ticketId}`;
    return row?.access_token_hash ?? null;
  }

  /** Everything this person has written to the desk, newest first. */
  async function forCustomer({ userId, email }: { userId?: string | null; email?: string | null }, limit = 20): Promise<TicketSummary[]> {
    if (userId != null && email != null) return ticketsWhere(sql`(t.user_id = ${userId} OR t.email = ${email.toLowerCase()})`, limit);
    if (userId != null) return ticketsWhere(sql`t.user_id = ${userId}`, limit);
    if (email != null) return ticketsWhere(sql`t.email = ${email.toLowerCase()}`, limit);
    return [];
  }

  /** The desk's queue: open work first, in the order an agent should take it. */
  async function queue({ status = null, limit = 50 }: { status?: TicketStatus | null; limit?: number } = {}): Promise<TicketSummary[]> {
    const tickets = await ticketsWhere(status === null ? sql`t.status <> 'closed'` : sql`t.status = ${status}`, limit);
    return queueOrder(tickets);
  }

  /** How many tickets sit in each state, for the desk's tabs. */
  async function counts(): Promise<Record<TicketStatus, number> & { unanswered: number; late: number }> {
    const [row] = await sql<{ open: number; waiting_customer: number; resolved: number; closed: number; unanswered: number; late: number }[]>`
      SELECT count(*) FILTER (WHERE status = 'open')::int AS open,
             count(*) FILTER (WHERE status = 'waiting_customer')::int AS waiting_customer,
             count(*) FILTER (WHERE status = 'resolved')::int AS resolved,
             count(*) FILTER (WHERE status = 'closed')::int AS closed,
             count(*) FILTER (WHERE first_reply_at IS NULL AND status <> 'closed')::int AS unanswered,
             count(*) FILTER (WHERE first_reply_at IS NULL AND status <> 'closed' AND first_reply_due_at < now())::int AS late
      FROM support_tickets
    `;
    return {
      open: row?.open ?? 0,
      waiting_customer: row?.waiting_customer ?? 0,
      resolved: row?.resolved ?? 0,
      closed: row?.closed ?? 0,
      unanswered: row?.unanswered ?? 0,
      late: row?.late ?? 0,
    };
  }

  /** The desk's figures for a period: what came in, how fast it was answered, and what people thought. */
  async function stats(period: { from: Date; to: Date }): Promise<{
    opened: number;
    answered: number;
    lateFirstReplies: number;
    medianFirstReplyMinutes: number | null;
    csat: { count: number; average: number | null };
    byTopic: { topic: string; count: number }[];
  }> {
    const from = period.from.toISOString();
    const to = period.to.toISOString();
    const [totals, minutes, byTopic] = await Promise.all([
      sql<{ opened: number; answered: number; late: number; csat_count: number; csat_avg: string | null }[]>`
        SELECT count(*)::int AS opened,
               count(*) FILTER (WHERE first_reply_at IS NOT NULL)::int AS answered,
               count(*) FILTER (WHERE first_reply_at IS NOT NULL AND first_reply_at > first_reply_due_at)::int AS late,
               count(csat_score)::int AS csat_count, avg(csat_score) AS csat_avg
        FROM support_tickets WHERE created_at >= ${from}::timestamptz AND created_at <= ${to}::timestamptz
      `,
      sql<{ minutes: string | null }[]>`
        SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (first_reply_at - created_at)) / 60) AS minutes
        FROM support_tickets
        WHERE first_reply_at IS NOT NULL AND created_at >= ${from}::timestamptz AND created_at <= ${to}::timestamptz
      `,
      sql<{ topic: string; count: number }[]>`
        SELECT topic, count(*)::int AS count FROM support_tickets
        WHERE created_at >= ${from}::timestamptz AND created_at <= ${to}::timestamptz
        GROUP BY topic ORDER BY count(*) DESC, topic
      `,
    ]);
    const row = totals[0];
    const median = minutes[0]?.minutes;
    return {
      opened: row?.opened ?? 0,
      answered: row?.answered ?? 0,
      lateFirstReplies: row?.late ?? 0,
      medianFirstReplyMinutes: median === null || median === undefined ? null : Math.round(Number(median)),
      csat: { count: row?.csat_count ?? 0, average: row?.csat_avg == null ? null : Math.round(Number(row.csat_avg) * 10) / 10 },
      byTopic,
    };
  }

  async function macros(topic?: string): Promise<Macro[]> {
    const rows = await sql<{ id: string; key: string; topic: string; title_en: string; title_el: string; body_en: string; body_el: string; sort: number }[]>`
      SELECT id, key, topic, title_en, title_el, body_en, body_el, sort FROM support_macros
      WHERE ${topic === undefined ? sql`TRUE` : sql`topic = ${topic}`}
      ORDER BY sort, key
    `;
    return rows.map((macro) => ({
      id: macro.id,
      key: macro.key,
      topic: macro.topic,
      titleEn: macro.title_en,
      titleEl: macro.title_el,
      bodyEn: macro.body_en,
      bodyEl: macro.body_el,
      sort: macro.sort,
    }));
  }

  /**
   * Writes the ready answers the desk ships with (src/lib/support/macros.ts).
   * They are part of the code, so a deploy replaces them: the text an agent
   * sends should be the text that was reviewed with the policies it quotes.
   * Returns how many rows were new.
   */
  async function seedMacros(entries: readonly Omit<Macro, "id">[], at = new Date()): Promise<number> {
    let added = 0;
    for (const macro of entries) {
      const rows = await sql<{ added: boolean }[]>`
        INSERT INTO support_macros (id, key, topic, title_en, title_el, body_en, body_el, sort, created_at, updated_at)
        VALUES (${uuidv7()}, ${macro.key}, ${macro.topic}, ${macro.titleEn}, ${macro.titleEl}, ${macro.bodyEn}, ${macro.bodyEl}, ${macro.sort},
                ${at.toISOString()}::timestamptz, ${at.toISOString()}::timestamptz)
        ON CONFLICT (key) DO UPDATE SET topic = EXCLUDED.topic, title_en = EXCLUDED.title_en, title_el = EXCLUDED.title_el,
               body_en = EXCLUDED.body_en, body_el = EXCLUDED.body_el, sort = EXCLUDED.sort, updated_at = EXCLUDED.updated_at
        RETURNING (xmax = 0) AS added
      `;
      added += rows[0]?.added === true ? 1 : 0;
    }
    return added;
  }

  return { open, addMessage, sendDraft, discardDraft, move, assign, saveSatisfaction, byId, byNumber, tokenHash, forCustomer, queue, counts, stats, macros, seedMacros };
}

export type SupportStore = ReturnType<typeof createSupportStore>;
