/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * The support desk from the command line: the ready answers it ships with, and demo tickets for the local shop.
 */

/**
 * Support (docs/adr/021).
 *
 *   pnpm support macros                  write the ready answers the desk ships with (safe to repeat)
 *   pnpm support demo [--count 6]        a handful of tickets on the local shop, to see the desk working
 *   pnpm support list                    what is in the queue
 *   pnpm support policies                write docs/policies.md into the module the AI answers from
 *
 * `macros` runs as part of `pnpm db:setup`, so a deploy has them. `demo` writes
 * customer messages and refuses to run against anything but the local stack.
 */

import { readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";

import postgres from "postgres";
import { uuidv7 } from "uuidv7";

import { hashToken, newTicketNumber, ticketLinkToken } from "@/lib/commerce/tokens";
import { DEFAULT_MACROS } from "@/lib/support/macros";
import { createSupportStore } from "@/lib/support/store";
import { ticketSla, type TicketTopic } from "@/lib/support/tickets";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { count: { type: "string", default: "6" }, "dry-run": { type: "boolean", default: false } },
});
const [command = "macros"] = positionals;

function connect() {
  const url = process.env.DATABASE_URL;
  if (url === undefined || url === "") throw new Error("DATABASE_URL is not set; run through `pnpm support`.");
  return postgres(url, { max: 2, onnotice: () => {} });
}

/** What a few people would write in: enough to see the queue, the clock and a draft. */
const DEMO_TICKETS: readonly { name: string; email: string; locale: string; topic: TicketTopic; subject: string; body: string; hoursAgo: number }[] = [
  {
    name: "Maria Georgiou",
    email: "maria.demo@example.com",
    locale: "en",
    topic: "delivery",
    subject: "When will my table arrive?",
    body: "Hello, I ordered a dining table last week and the page says packed. Do you know when it will be sent? I am away after Friday.",
    hoursAgo: 26,
  },
  {
    name: "Nikos Alexiou",
    email: "nikos.demo@example.com",
    locale: "el",
    topic: "returns",
    subject: "Η λάμπα ήρθε σπασμένη",
    body: "Καλησπέρα. Η λάμπα έφτασε σήμερα με σπασμένο το γυαλί. Τι κάνουμε;",
    hoursAgo: 20,
  },
  {
    name: "Eleni Papadopoulou",
    email: "eleni.demo@example.com",
    locale: "en",
    topic: "payment",
    subject: "Was I charged twice?",
    body: "I pressed pay twice by mistake and I want to be sure there is only one order.",
    hoursAgo: 5,
  },
  {
    name: "Giorgos Lambrou",
    email: "giorgos.demo@example.com",
    locale: "el",
    topic: "product",
    subject: "Διαστάσεις καναπέ",
    body: "Χωράει ο καναπές Canova σε άνοιγμα 210 εκατοστών; Το σαλόνι μου είναι μικρό.",
    hoursAgo: 2,
  },
  {
    name: "Sofia Dimitriou",
    email: "sofia.demo@example.com",
    locale: "en",
    topic: "account",
    subject: "Two-step sign-in",
    body: "I lost my phone and I cannot get the code any more. How do I get back in?",
    hoursAgo: 1,
  },
  {
    name: "Andreas Petrou",
    email: "andreas.demo@example.com",
    locale: "en",
    topic: "other",
    subject: "Is this a real shop?",
    body: "Lovely site. Is it a real shop or a school project? I could not find an address.",
    hoursAgo: 0.5,
  },
];

async function macros(sql: postgres.Sql): Promise<void> {
  const desk = createSupportStore(sql);
  if (values["dry-run"]) {
    console.log(`Would write ${DEFAULT_MACROS.length} ready answers, replacing any that are already there.`);
    return;
  }
  const added = await desk.seedMacros(DEFAULT_MACROS);
  console.log(`Ready answers: ${DEFAULT_MACROS.length} written (${added} new, ${DEFAULT_MACROS.length - added} brought up to date).`);
}

async function demo(sql: postgres.Sql): Promise<void> {
  if (process.env.VITRINE_LOCAL !== "1" && process.env.VITRINE_LOCAL !== "true") {
    throw new Error("Demo tickets are for the local shop only (VITRINE_LOCAL).");
  }
  const desk = createSupportStore(sql);
  const wanted = DEMO_TICKETS.slice(0, Math.max(1, Math.min(DEMO_TICKETS.length, Number.parseInt(values.count ?? "6", 10))));
  if (values["dry-run"]) {
    console.log(`Would open ${wanted.length} tickets:`);
    for (const ticket of wanted) console.log(`  ${ticket.topic.padEnd(9)} ${ticket.subject}`);
    return;
  }
  // The private link is derived from the ticket's id and the shop's secret, as
  // the route derives it, so a demo ticket opens from its email like a real one.
  const secret = process.env.COOKIE_SECRET;
  if (secret === undefined || secret === "") throw new Error("COOKIE_SECRET is not set; run through `pnpm support`.");

  for (const ticket of wanted) {
    const at = new Date(Date.now() - ticket.hoursAgo * 60 * 60 * 1000);
    const number = newTicketNumber();
    const id = uuidv7();
    await desk.open(
      {
        id,
        number,
        subject: ticket.subject,
        body: ticket.body,
        topic: ticket.topic,
        locale: ticket.locale,
        email: ticket.email,
        name: ticket.name,
        userId: null,
        orderId: null,
        accessTokenHash: hashToken(ticketLinkToken(id, secret)),
      },
      at,
    );
    console.log(`${number}  ${ticket.topic.padEnd(9)} ${ticket.subject} (${id})`);
  }
}

async function list(sql: postgres.Sql): Promise<void> {
  const desk = createSupportStore(sql);
  const tickets = await desk.queue({ limit: 30 });
  if (tickets.length === 0) {
    console.log("The queue is empty.");
    return;
  }
  for (const ticket of tickets) {
    const sla = ticketSla(ticket);
    const clock = sla.state === "answered" ? "answered" : `${Math.round(sla.msLeft / 60_000)} min`;
    console.log(`${ticket.number}  ${ticket.status.padEnd(17)} ${clock.padStart(12)}  ${ticket.subject}`);
  }
  const counts = await desk.counts();
  console.log(`\nopen ${counts.open}, waiting ${counts.waiting_customer}, resolved ${counts.resolved}, unanswered ${counts.unanswered}, late ${counts.late}`);
}

const POLICY_SOURCE = "docs/policies.md";
const POLICY_MODULE = "src/lib/support/policies.generated.ts";

/**
 * The support assistant answers from docs/policies.md, which George approves.
 * A deployed server should not read a document out of the repository at run
 * time, so the file is written into a module here; a unit test keeps the two
 * in step (src/lib/support/policies.test.ts).
 */
export function policyModule(markdown: string): string {
  // Everything that would end or escape a template literal, written so it survives as text.
  const quoted = markdown.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
  return `/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * The shop's policies as the support assistant reads them. Generated from ${POLICY_SOURCE}; do not edit.
 */

/** Written by \`pnpm support policies\`. The document itself is ${POLICY_SOURCE}, which George approves. */
export const POLICIES = \`${quoted}\`;
`;
}

async function policies(): Promise<void> {
  const markdown = await readFile(POLICY_SOURCE, "utf8");
  const generated = policyModule(markdown);
  if (values["dry-run"]) {
    console.log(`Would write ${generated.length} characters to ${POLICY_MODULE}.`);
    return;
  }
  await writeFile(POLICY_MODULE, generated, "utf8");
  console.log(`${POLICY_MODULE} written from ${POLICY_SOURCE} (${markdown.length} characters).`);
}

async function main(): Promise<void> {
  if (command === "policies") {
    await policies();
    return;
  }
  const sql = connect();
  try {
    if (command === "macros") await macros(sql);
    else if (command === "demo") await demo(sql);
    else if (command === "list") await list(sql);
    else throw new Error(`Unknown command "${command}". Try: macros, demo, list, policies`);
  } finally {
    await sql.end();
  }
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
