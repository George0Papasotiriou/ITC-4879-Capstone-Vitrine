/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Web Push housekeeping: make the shop's VAPID key pair, and count who gets notifications.
 */

/**
 * docs/adr/044.
 *
 *   pnpm push keys     a new VAPID key pair, printed here only, to paste into Railway
 *   pnpm push list     how many devices get notifications, by topic (no addresses)
 *
 * The private key is printed to this terminal and nowhere else: it goes into
 * Railway's VAPID_PRIVATE_KEY by hand and is never committed. Changing the key
 * pair later silently ends every existing subscription (browsers bind them to
 * the public key), so make it once.
 */

import { parseArgs } from "node:util";

import postgres from "postgres";

import { generateVapidKeys } from "@/lib/push/webpush";

const { positionals } = parseArgs({ allowPositionals: true, options: {} });
const [command = "keys"] = positionals;

async function main(): Promise<void> {
  if (command === "keys") {
    const keys = generateVapidKeys();
    process.stdout.write(
      [
        "A new VAPID key pair for Web Push. Set all three on BOTH Railway services (web and worker):",
        "",
        `  VAPID_PUBLIC_KEY=${keys.publicKey}`,
        `  VAPID_PRIVATE_KEY=${keys.privateKey}`,
        "  VAPID_SUBJECT=mailto:<an address the push services can write to>",
        "",
        "Keep the private key secret: do not commit it or paste it into a chat.",
        "Changing the pair later ends every existing subscription, so make it once.",
        "",
      ].join("\n"),
    );
    return;
  }
  if (command === "list") {
    const url = process.env.DATABASE_URL;
    if (url === undefined) throw new Error("DATABASE_URL is not set.");
    const sql = postgres(url, { max: 1, onnotice: () => {} });
    try {
      const rows = await sql<{ topic: string; devices: number; people: number }[]>`
        SELECT topic, count(*)::int AS devices, count(DISTINCT user_id)::int AS people
        FROM push_subscriptions, unnest(topics) AS topic GROUP BY topic ORDER BY topic
      `;
      if (rows.length === 0) process.stdout.write("No device gets notifications yet.\n");
      for (const row of rows) process.stdout.write(`${row.topic.padEnd(8)} ${String(row.devices).padStart(4)} devices, ${row.people} people\n`);
    } finally {
      await sql.end();
    }
    return;
  }
  throw new Error(`Unknown command "${command}". Use keys or list.`);
}

main().catch((error: unknown) => {
  process.stderr.write(`[push] ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
