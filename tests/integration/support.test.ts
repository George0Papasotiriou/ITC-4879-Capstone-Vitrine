/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Integration tests for the support desk: the reply clock, drafts, reopening, satisfaction and the desk's figures.
 */

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { uuidv7 } from "uuidv7";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import * as schema from "@/lib/db/schema";
import { DEFAULT_MACROS } from "@/lib/support/macros";
import { createSupportStore, type NewTicket } from "@/lib/support/store";
import { FIRST_REPLY_HOURS, REOPEN_WINDOW_DAYS } from "@/lib/support/tickets";

const url = process.env.DATABASE_URL;
const HOUR = 60 * 60 * 1000;

describe.skipIf(url === undefined || url === "")("the support desk", () => {
  let connection: ReturnType<typeof postgres>;
  let desk: ReturnType<typeof createSupportStore>;
  const opened = new Date("2026-09-20T09:00:00Z");

  const newTicket = (overrides: Partial<NewTicket> = {}): NewTicket => ({
    id: uuidv7(),
    number: `VS-TEST-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
    subject: "My table has not arrived",
    body: "Hello, the table was due last week. Where is it?",
    topic: "delivery",
    locale: "en",
    email: "customer@example.com",
    name: "Maria Georgiou",
    userId: null,
    orderId: null,
    accessTokenHash: "hash",
    ...overrides,
  });

  beforeAll(async () => {
    connection = postgres(url as string, { max: 4, onnotice: () => {} });
    await migrate(drizzle(connection, { schema }), { migrationsFolder: "./drizzle" });
  });

  beforeEach(async () => {
    await connection`TRUNCATE support_tickets, support_macros CASCADE`;
    desk = createSupportStore(connection);
  });

  afterAll(async () => {
    await connection?.end();
  });

  it("writes the ticket and its first message together, with a working day to answer", async () => {
    const { id } = await desk.open(newTicket(), opened);
    const ticket = await desk.byId(id);

    expect(ticket).toMatchObject({ status: "open", topic: "delivery", messageCount: 1, hasDraft: false, firstReplyAt: null });
    expect(ticket!.messages).toHaveLength(1);
    expect(ticket!.messages[0]).toMatchObject({ author: "customer", body: "Hello, the table was due last week. Where is it?" });
    expect(ticket!.firstReplyDueAt.getTime() - opened.getTime()).toBe(FIRST_REPLY_HOURS * HOUR);
  });

  it("takes a subject from the first line when none is given", async () => {
    const { id } = await desk.open(newTicket({ subject: null, body: "The lamp arrived broken\nIt was like that in the box." }), opened);
    expect((await desk.byId(id))!.subject).toBe("The lamp arrived broken");
  });

  it("stops the clock at the first reply a customer can read, and not before", async () => {
    const { id } = await desk.open(newTicket(), opened);

    // A note between staff answers nobody.
    await desk.addMessage(id, { author: "system", body: "Checked the carrier, nothing yet.", internal: true }, new Date(opened.getTime() + HOUR));
    expect(await desk.byId(id)).toMatchObject({ status: "open", firstReplyAt: null });

    await desk.addMessage(id, { author: "agent", body: "It is with the carrier and arrives on Thursday." }, new Date(opened.getTime() + 2 * HOUR));
    const answered = await desk.byId(id);
    expect(answered).toMatchObject({ status: "waiting_customer" });
    expect(answered!.firstReplyAt?.toISOString()).toBe(new Date(opened.getTime() + 2 * HOUR).toISOString());

    // A second reply does not move the first.
    await desk.addMessage(id, { author: "agent", body: "It is out for delivery now." }, new Date(opened.getTime() + 20 * HOUR));
    expect((await desk.byId(id))!.firstReplyAt?.toISOString()).toBe(new Date(opened.getTime() + 2 * HOUR).toISOString());
  });

  it("opens again when the customer writes, and remembers when they last did", async () => {
    const { id } = await desk.open(newTicket(), opened);
    await desk.addMessage(id, { author: "agent", body: "Thursday." }, new Date(opened.getTime() + HOUR));
    const wrote = new Date(opened.getTime() + 5 * HOUR);
    await desk.addMessage(id, { author: "customer", body: "Thursday does not work for me." }, wrote);

    const ticket = await desk.byId(id);
    expect(ticket).toMatchObject({ status: "open" });
    expect(ticket!.lastCustomerAt.toISOString()).toBe(wrote.toISOString());
  });

  describe("drafts", () => {
    it("are invisible to the customer, move nothing, and are replaced rather than piled up", async () => {
      const { id } = await desk.open(newTicket(), opened);
      const first = await desk.addMessage(id, { author: "ai", body: "Draft one.", draft: true, model: "macros" }, new Date(opened.getTime() + HOUR));
      expect(first).toMatchObject({ ok: true });

      // The customer's view has no draft in it, and the clock is still running.
      expect((await desk.byId(id))!.messages.map((message) => message.body)).toEqual(["Hello, the table was due last week. Where is it?"]);
      expect(await desk.byId(id)).toMatchObject({ status: "open", firstReplyAt: null, hasDraft: true });

      await desk.addMessage(id, { author: "ai", body: "Draft two.", draft: true, model: "macros" }, new Date(opened.getTime() + 2 * HOUR));
      const staffView = await desk.byId(id, { withDrafts: true });
      expect(staffView!.messages.filter((message) => message.draft).map((message) => message.body)).toEqual(["Draft two."]);
    });

    it("become the agent's own message when sent, with whatever they changed", async () => {
      const { id } = await desk.open(newTicket(), opened);
      const agent = uuidv7();
      await connection`INSERT INTO users (id, name, email, email_verified, role) VALUES (${agent}, 'Agent', ${`agent.${agent}@vitrine.test`}, true, 'support')`;
      const draft = await desk.addMessage(id, { author: "ai", body: "Draft.", draft: true, model: "macros" }, new Date(opened.getTime() + HOUR));
      expect(draft.ok).toBe(true);

      const sent = await desk.sendDraft(draft.ok ? draft.messageId : "", { body: "Edited by the agent.", agentUserId: agent }, new Date(opened.getTime() + 3 * HOUR));
      expect(sent).toMatchObject({ ok: true, status: "waiting_customer" });

      const ticket = await desk.byId(id);
      expect(ticket).toMatchObject({ status: "waiting_customer", hasDraft: false });
      expect(ticket!.messages.at(-1)).toMatchObject({ author: "agent", body: "Edited by the agent." });
      expect(ticket!.firstReplyAt?.toISOString()).toBe(new Date(opened.getTime() + 3 * HOUR).toISOString());
    });

    it("can be thrown away", async () => {
      const { id } = await desk.open(newTicket(), opened);
      const draft = await desk.addMessage(id, { author: "ai", body: "Draft.", draft: true }, opened);
      expect(await desk.discardDraft(draft.ok ? draft.messageId : "")).toBe(true);
      expect(await desk.byId(id)).toMatchObject({ hasDraft: false });
    });
  });

  describe("closing", () => {
    it("refuses an agent's reply, and starts a new promise when the customer writes again", async () => {
      const { id } = await desk.open(newTicket(), opened);
      await desk.addMessage(id, { author: "agent", body: "Sorted." }, new Date(opened.getTime() + HOUR));
      const closedAt = new Date(opened.getTime() + 2 * HOUR);
      expect(await desk.move(id, "close", closedAt)).toMatchObject({ ok: true, status: "closed" });

      await expect(desk.addMessage(id, { author: "agent", body: "One more thing." }, closedAt)).resolves.toEqual({ ok: false, reason: "closed" });

      const wroteAgain = new Date(closedAt.getTime() + 24 * HOUR);
      const reopened = await desk.addMessage(id, { author: "customer", body: "It still has not arrived." }, wroteAgain);
      expect(reopened).toMatchObject({ ok: true, status: "open", reopened: true });

      const ticket = await desk.byId(id);
      expect(ticket).toMatchObject({ status: "open", firstReplyAt: null, closedAt: null });
      expect(ticket!.firstReplyDueAt.getTime() - wroteAgain.getTime()).toBe(FIRST_REPLY_HOURS * HOUR);
    });

    it("stays closed once it is old", async () => {
      const { id } = await desk.open(newTicket(), opened);
      const closedAt = new Date(opened.getTime() + HOUR);
      await desk.move(id, "close", closedAt);
      const muchLater = new Date(closedAt.getTime() + (REOPEN_WINDOW_DAYS + 1) * 24 * HOUR);
      await expect(desk.addMessage(id, { author: "customer", body: "Hello again." }, muchLater)).resolves.toEqual({ ok: false, reason: "closed" });
    });

    it("takes a score only for a closed ticket, and only a real one", async () => {
      const { id } = await desk.open(newTicket(), opened);
      expect(await desk.saveSatisfaction(id, 5, null)).toBe(false);

      await desk.move(id, "close", new Date(opened.getTime() + HOUR));
      expect(await desk.saveSatisfaction(id, 9, null)).toBe(false);
      expect(await desk.saveSatisfaction(id, 4, "Quick and clear.")).toBe(true);
      expect(await desk.byId(id)).toMatchObject({ csatScore: 4 });
    });
  });

  it("puts the unanswered first in the queue, and counts what is where", async () => {
    const late = await desk.open(newTicket({ subject: "Late one" }), new Date(opened.getTime() - 30 * HOUR));
    const recent = await desk.open(newTicket({ subject: "Recent one" }), new Date(opened.getTime() - 2 * HOUR));
    const answered = await desk.open(newTicket({ subject: "Answered one" }), new Date(opened.getTime() - 20 * HOUR));
    await desk.addMessage(answered.id, { author: "agent", body: "Here you go." }, new Date(opened.getTime() - 19 * HOUR));

    const queue = await desk.queue();
    expect(queue.map((ticket) => ticket.subject)).toEqual(["Late one", "Recent one", "Answered one"]);
    expect(queue[0]!.id).toBe(late.id);
    expect(queue[1]!.id).toBe(recent.id);

    const counts = await desk.counts();
    expect(counts).toMatchObject({ open: 2, waiting_customer: 1, closed: 0, unanswered: 2 });
    expect(counts.late).toBeGreaterThanOrEqual(1);
  });

  it("reports how the desk did: what came in, how fast, and what people thought", async () => {
    const first = await desk.open(newTicket({ topic: "delivery" }), new Date(opened.getTime() - 10 * HOUR));
    await desk.addMessage(first.id, { author: "agent", body: "Answered in an hour." }, new Date(opened.getTime() - 9 * HOUR));
    const second = await desk.open(newTicket({ topic: "returns" }), new Date(opened.getTime() - 8 * HOUR));
    await desk.addMessage(second.id, { author: "agent", body: "Answered in three hours." }, new Date(opened.getTime() - 5 * HOUR));
    await desk.move(second.id, "close", new Date(opened.getTime() - 4 * HOUR));
    await desk.saveSatisfaction(second.id, 5, null);
    await desk.open(newTicket({ topic: "returns" }), new Date(opened.getTime() - 1 * HOUR));

    const stats = await desk.stats({ from: new Date(opened.getTime() - 48 * HOUR), to: opened });
    expect(stats).toMatchObject({ opened: 3, answered: 2, lateFirstReplies: 0 });
    // One hour and three hours: the middle of the two.
    expect(stats.medianFirstReplyMinutes).toBe(120);
    expect(stats.csat).toEqual({ count: 1, average: 5 });
    expect(stats.byTopic).toEqual([
      { topic: "returns", count: 2 },
      { topic: "delivery", count: 1 },
    ]);
  });

  it("writes the ready answers, and brings them up to date on the next deploy", async () => {
    expect(await desk.seedMacros(DEFAULT_MACROS)).toBe(DEFAULT_MACROS.length);
    expect(await desk.seedMacros(DEFAULT_MACROS)).toBe(0);
    expect(await desk.macros()).toHaveLength(DEFAULT_MACROS.length);

    await connection`UPDATE support_macros SET body_en = 'stale' WHERE key = 'damaged'`;
    await desk.seedMacros(DEFAULT_MACROS);
    const damaged = (await desk.macros("returns")).find((macro) => macro.key === "damaged");
    expect(damaged!.bodyEn).toBe(DEFAULT_MACROS.find((macro) => macro.key === "damaged")!.bodyEn);
  });
});
