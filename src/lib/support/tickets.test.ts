/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Tests for the support desk's rules: the ticket's states, the reply clock, the queue and the shape of a message.
 */

import { describe, expect, it } from "vitest";

import {
  canReopen,
  cleanMessage,
  csatScore,
  firstReplyDueAt,
  guessTopic,
  nextStatus,
  queueOrder,
  renderMacro,
  satisfaction,
  subjectFrom,
  ticketSla,
  type TicketStatus,
} from "@/lib/support/tickets";

const NOW = new Date("2026-09-20T12:00:00Z");
const hours = (count: number) => new Date(NOW.getTime() + count * 60 * 60 * 1000);

describe("the ticket's states", () => {
  it("opens again whenever the customer writes", () => {
    for (const status of ["open", "waiting_customer", "resolved"] as TicketStatus[]) {
      expect(nextStatus(status, "customer_message")).toBe("open");
    }
  });

  it("waits for the customer after an agent replies", () => {
    expect(nextStatus("open", "agent_reply")).toBe("waiting_customer");
    expect(nextStatus("resolved", "agent_reply")).toBe("waiting_customer");
  });

  it("does not move a ticket to where it already is", () => {
    expect(nextStatus("resolved", "resolve")).toBeNull();
    expect(nextStatus("open", "reopen")).toBeNull();
  });

  it("lets nothing but reopening touch a closed ticket", () => {
    expect(nextStatus("closed", "agent_reply")).toBeNull();
    expect(nextStatus("closed", "customer_message")).toBeNull();
    expect(nextStatus("closed", "reopen")).toBe("open");
  });

  it("takes a closed ticket up again only while it is recent", () => {
    expect(canReopen({ status: "closed", closedAt: new Date(NOW.getTime() - 3 * 24 * 3_600_000) }, NOW)).toBe(true);
    expect(canReopen({ status: "closed", closedAt: new Date(NOW.getTime() - 20 * 24 * 3_600_000) }, NOW)).toBe(false);
    expect(canReopen({ status: "open", closedAt: null }, NOW)).toBe(true);
  });
});

describe("the reply clock", () => {
  const ticket = (overrides: Partial<Parameters<typeof ticketSla>[0]> = {}) => ({
    firstReplyDueAt: hours(10),
    firstReplyAt: null,
    status: "open" as TicketStatus,
    ...overrides,
  });

  it("gives a working day from the moment the customer writes", () => {
    expect(firstReplyDueAt(NOW).toISOString()).toBe("2026-09-21T12:00:00.000Z");
  });

  it("counts down, warns, and then says it is late", () => {
    expect(ticketSla(ticket(), NOW).state).toBe("due");
    expect(ticketSla(ticket({ firstReplyDueAt: hours(2) }), NOW).state).toBe("soon");
    expect(ticketSla(ticket({ firstReplyDueAt: hours(-1) }), NOW)).toMatchObject({ state: "late", msLeft: -3_600_000 });
  });

  it("stops once a person has replied, and remembers a late one", () => {
    expect(ticketSla(ticket({ firstReplyAt: hours(-2) }), NOW)).toMatchObject({ state: "answered", wasLate: false });
    expect(ticketSla(ticket({ firstReplyDueAt: hours(-5), firstReplyAt: hours(-1) }), NOW)).toMatchObject({ state: "answered", wasLate: true });
  });
});

describe("the queue", () => {
  it("puts what nobody has answered first, by the oldest promise", () => {
    const rows = [
      { id: "answered-old", firstReplyAt: hours(-30), firstReplyDueAt: hours(-40), lastCustomerAt: hours(-30) },
      { id: "waiting-later", firstReplyAt: null, firstReplyDueAt: hours(6), lastCustomerAt: hours(-18) },
      { id: "waiting-soonest", firstReplyAt: null, firstReplyDueAt: hours(-2), lastCustomerAt: hours(-26) },
      { id: "answered-new", firstReplyAt: hours(-1), firstReplyDueAt: hours(10), lastCustomerAt: hours(-1) },
    ];
    expect(queueOrder(rows).map((row) => row.id)).toEqual(["waiting-soonest", "waiting-later", "answered-old", "answered-new"]);
  });
});

describe("what a message looks like", () => {
  it("trims, and leaves at most one blank line between paragraphs", () => {
    expect(cleanMessage("  Hello   \r\n\r\n\r\n\r\nthere  \n")).toBe("Hello\n\nthere");
  });

  it("makes a subject from the first line, cut on a word", () => {
    expect(subjectFrom("My table arrived scratched\nIt was in the box like that.")).toBe("My table arrived scratched");
    const long = subjectFrom(`${"chair ".repeat(30)}`);
    expect(long.length).toBeLessThanOrEqual(91);
    expect(long.endsWith("…")).toBe(true);
    expect(long).not.toContain("  ");
  });

  it("fills a ready answer with the ticket's own details, and leaves what it does not know", () => {
    expect(renderMacro("Hello {name}, your order {number} is on its way. {oops}", { name: "Eleni", number: "VT-1111-2222" })).toBe(
      "Hello Eleni, your order VT-1111-2222 is on its way. {oops}",
    );
  });
});

describe("satisfaction", () => {
  it("takes 1 to 5 and nothing else", () => {
    expect(csatScore("5")).toBe(5);
    expect(csatScore(1)).toBe(1);
    expect(csatScore(0)).toBeNull();
    expect(csatScore(6)).toBeNull();
    expect(csatScore("great")).toBeNull();
    expect(csatScore(4.5)).toBeNull();
  });

  it("averages to one decimal, and says nothing when nobody answered", () => {
    expect(satisfaction([5, 4, 4])).toEqual({ count: 3, average: 4.3 });
    expect(satisfaction([])).toEqual({ count: 0, average: null });
  });
});

describe("guessing the queue", () => {
  it("files a message by what it is about, in English and Greek", () => {
    expect(guessTopic("The table arrived broken")).toBe("returns");
    // Written as a Greek customer writes it, with accents.
    expect(guessTopic("Πότε θα γίνει η παράδοση;")).toBe("delivery");
    expect(guessTopic("Ήρθε σπασμένο, θέλω επιστροφή χρημάτων")).toBe("returns");
    expect(guessTopic("I was charged twice on my card")).toBe("payment");
    expect(guessTopic("I can't sign in to my account")).toBe("account");
    expect(guessTopic("What are the dimensions of the sofa?")).toBe("product");
    expect(guessTopic("Hello there")).toBe("other");
  });
});
