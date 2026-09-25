/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * The showcase accounts: created with their history on deploy, listed, or locked when the showcase is over.
 */

/**
 * Showcase (docs/adr/028).
 *
 *   pnpm showcase ensure            accounts up to date, history written once (runs on every deploy)
 *   pnpm showcase list              the accounts and what each can show
 *   pnpm showcase lock              the accounts can no longer sign in; their history stays
 *
 * `ensure` does nothing unless SHOWCASE_PASSWORD is set — George pastes it into
 * Railway himself, and removing it stops the next deploy from touching the
 * accounts. Locally the demo password in .local/demo-password stands in.
 *
 * It must never stop a deploy: whatever goes wrong is written to the log and
 * the shop starts anyway, without its showcase.
 */

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

import postgres from "postgres";

import { ORDER_STORIES, SHOWCASE_ACCOUNTS, showcasePassword, TICKET_STORIES, MIN_SHOWCASE_PASSWORD } from "@/lib/showcase/plan";
import { ensureAccounts, ensureHistory, lockShowcase } from "@/lib/showcase/seed";

const { positionals, values } = parseArgs({ allowPositionals: true, options: { "dry-run": { type: "boolean", default: false } } });
const [command] = positionals;
const log = (line: string) => console.log(`[showcase] ${line}`);

/** The password in force: Railway's variable, or the local demo one on a laptop. */
async function passwordInForce(): Promise<ReturnType<typeof showcasePassword>> {
  const fromEnvironment = showcasePassword(process.env.SHOWCASE_PASSWORD);
  if (fromEnvironment.ok || fromEnvironment.reason === "too_short") return fromEnvironment;
  const local = path.join(".local", "demo-password");
  if (process.env.VITRINE_LOCAL === "1" && existsSync(local)) return showcasePassword((await readFile(local, "utf8")).trim());
  return fromEnvironment;
}

function list() {
  const own = (key: string) => ORDER_STORIES.filter((story) => story.owner === key).map((story) => story.stage);
  console.log("Showcase accounts (docs/adr/028):\n");
  for (const account of SHOWCASE_ACCOUNTS) {
    const orders = own(account.key);
    console.log(`  ${account.email.padEnd(28)} ${account.role.padEnd(13)} ${account.name.padEnd(22)} ${orders.length} ${orders.length === 1 ? "order" : "orders"}${orders.length > 0 ? ` (${orders.join(", ")})` : ""}`);
  }
  console.log(`\nAlso: 28 guest orders over 30 days for the dashboards, ${TICKET_STORIES.length} desk conversations, price watches, carts, stock counted in and a piece on offer.`);
  console.log(`The password is SHOWCASE_PASSWORD (at least ${MIN_SHOWCASE_PASSWORD} characters), set in Railway by George.`);
}

async function main() {
  if (command === "list") return list();
  if (command !== "ensure" && command !== "lock") {
    console.error("Usage: pnpm showcase ensure | list | lock  [--dry-run]");
    process.exitCode = 1;
    return;
  }

  const url = process.env.DATABASE_URL;
  if (url === undefined || url === "") {
    log("DATABASE_URL is not set; nothing to do.");
    return;
  }

  if (command === "ensure") {
    const password = await passwordInForce();
    if (!password.ok) {
      log(password.reason === "unset" ? "Off: SHOWCASE_PASSWORD is not set, so no showcase accounts are created or changed." : `Off: SHOWCASE_PASSWORD is shorter than ${MIN_SHOWCASE_PASSWORD} characters.`);
      return;
    }
    const cookieSecret = process.env.COOKIE_SECRET;
    if (cookieSecret === undefined || cookieSecret === "") {
      log("Off: COOKIE_SECRET is not set, and order and ticket links are derived from it.");
      return;
    }
    if (values["dry-run"]) {
      list();
      log("Dry run: nothing written.");
      return;
    }
    const sql = postgres(url, { max: 2, onnotice: () => {} });
    try {
      log("Accounts:");
      const people = await ensureAccounts(sql, password.password, log);
      await ensureHistory(sql, people, { cookieSecret, log });
    } finally {
      await sql.end();
    }
    return;
  }

  // lock
  if (values["dry-run"]) {
    log(`Would remove the passwords and sessions of ${SHOWCASE_ACCOUNTS.length} showcase accounts. Dry run: nothing written.`);
    return;
  }
  const sql = postgres(url, { max: 2, onnotice: () => {} });
  try {
    await lockShowcase(sql, log);
    log("Remove SHOWCASE_PASSWORD in Railway too, or the next deploy opens them again.");
  } finally {
    await sql.end();
  }
}

try {
  await main();
} catch (error) {
  // A showcase is a convenience: it never stops the shop from starting.
  log(`Failed, and the shop starts without it: ${error instanceof Error ? error.message : String(error)}`);
  if (command !== "ensure") process.exitCode = 1;
}
