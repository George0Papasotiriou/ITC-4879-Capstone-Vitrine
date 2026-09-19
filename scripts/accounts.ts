/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Account administration from the command line: list accounts, grant and revoke roles, create local demo accounts.
 */

/**
 * Accounts (docs/adr/016).
 *
 *   pnpm accounts list                         every account, its roles and how it signs in
 *   pnpm accounts grant <email> <role>         add a role (customer, support, merchandiser, admin)
 *   pnpm accounts revoke <email> <role>        remove one
 *   pnpm accounts demo                         one confirmed account per role, local stack only
 *
 * Every command that changes something takes --dry-run. Against production the
 * first admin comes from ADMIN_EMAILS instead (no laptop reaches Railway's
 * private database); this script is for the local stack, or for running inside
 * the Railway service with its own DATABASE_URL.
 *
 * The demo accounts' password is generated once per machine and kept in
 * .local/demo-password (owner-only), so the demo is repeatable without a
 * password being written into the repository.
 */

import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

import { hashPassword } from "better-auth/crypto";
import postgres from "postgres";
import { uuidv7 } from "uuidv7";

import { recordAudit } from "@/lib/admin/audit";
import { isRole, parseRoles, ROLES, withoutRole, withRole, type Role } from "@/lib/auth/roles";

const DEMO_PASSWORD_FILE = path.join(".local", "demo-password");
const DEMO_ACCOUNTS: readonly { role: Role; name: string; email: string }[] = [
  { role: "customer", name: "Demo Customer", email: "customer@vitrine.test" },
  { role: "support", name: "Demo Support", email: "support@vitrine.test" },
  { role: "merchandiser", name: "Demo Merchandiser", email: "merchandiser@vitrine.test" },
  { role: "admin", name: "Demo Admin", email: "admin@vitrine.test" },
];

const { positionals, values } = parseArgs({ allowPositionals: true, options: { "dry-run": { type: "boolean", default: false } } });
const [command, ...rest] = positionals;
const dryRun = values["dry-run"];

function connect() {
  const url = process.env.DATABASE_URL;
  if (url === undefined || url === "") throw new Error("DATABASE_URL is not set; run through `pnpm accounts`.");
  return postgres(url, { max: 2, onnotice: () => {} });
}

async function list(sql: postgres.Sql) {
  const rows = await sql<{ email: string; role: string; email_verified: boolean; two_factor_enabled: boolean | null; methods: string[]; created_at: Date }[]>`
    SELECT u.email, u.role, u.email_verified, u.two_factor_enabled, u.created_at,
           array_remove(array_agg(DISTINCT a.provider_id), NULL) || CASE WHEN count(p.id) > 0 THEN ARRAY['passkey'] ELSE ARRAY[]::text[] END AS methods
    FROM users u LEFT JOIN accounts a ON a.user_id = u.id LEFT JOIN passkeys p ON p.user_id = u.id
    GROUP BY u.id ORDER BY u.created_at
  `;
  if (rows.length === 0) return console.log("No accounts yet.");
  for (const row of rows) {
    const flags = [row.email_verified ? "confirmed" : "not confirmed", row.two_factor_enabled === true ? "two-step" : null].filter(Boolean).join(", ");
    console.log(`${row.email.padEnd(36)} ${parseRoles(row.role).join(",").padEnd(24)} ${row.methods.join("+").padEnd(20)} ${flags}`);
  }
}

async function changeRole(sql: postgres.Sql, change: "grant" | "revoke", email: string | undefined, role: string | undefined) {
  if (email === undefined || role === undefined || !isRole(role)) {
    throw new Error(`Usage: pnpm accounts ${change} <email> <${ROLES.join("|")}> [--dry-run]`);
  }
  const [user] = await sql<{ id: string; role: string }[]>`SELECT id, role FROM users WHERE email = ${email.toLowerCase()}`;
  if (user === undefined) throw new Error(`No account for ${email}. It must sign up first.`);
  const next = change === "grant" ? withRole(user.role, role) : withoutRole(user.role, role);
  console.log(`${email}: ${user.role} → ${next}${next === user.role ? " (no change)" : ""}`);
  if (dryRun || next === user.role) return;
  // Audited with no person as the actor: whoever ran the script is not an account (docs/adr/018).
  await sql.begin(async (tx) => {
    await tx`UPDATE users SET role = ${next}, updated_at = now() WHERE id = ${user.id}`;
    await recordAudit(tx, {
      actor: null,
      action: change === "grant" ? "role.grant" : "role.revoke",
      entityType: "user",
      entityId: user.id,
      changes: { role: { before: user.role, after: next } },
      reason: "pnpm accounts",
    });
  });
  // Sessions are re-read on each request, so the change applies at once.
  console.log("Saved.");
}

async function demoPassword(): Promise<string> {
  if (existsSync(DEMO_PASSWORD_FILE)) return (await readFile(DEMO_PASSWORD_FILE, "utf8")).trim();
  const password = `demo-${randomBytes(9).toString("base64url")}`;
  await mkdir(path.dirname(DEMO_PASSWORD_FILE), { recursive: true });
  await writeFile(DEMO_PASSWORD_FILE, password, { mode: 0o600 });
  return password;
}

async function demo(sql: postgres.Sql) {
  // Demo accounts with a shared password belong on a laptop, never in production.
  if (process.env.VITRINE_LOCAL !== "1") throw new Error("Demo accounts are for the local stack only (run through `pnpm accounts`).");
  console.log(`${DEMO_ACCOUNTS.length} confirmed demo accounts, one per role:`);
  for (const account of DEMO_ACCOUNTS) console.log(`  ${account.email.padEnd(28)} ${account.role}`);
  if (dryRun) return console.log("Dry run: nothing written.");

  const password = await demoPassword();
  const hash = await hashPassword(password);
  for (const account of DEMO_ACCOUNTS) {
    const [user] = await sql<{ id: string }[]>`
      INSERT INTO users (id, name, email, email_verified, role)
      VALUES (${uuidv7()}, ${account.name}, ${account.email}, true, ${account.role})
      ON CONFLICT (email) DO UPDATE SET role = excluded.role, email_verified = true, updated_at = now()
      RETURNING id
    `;
    // Better Auth's own layout for a password: a "credential" account whose id is the user's.
    await sql`
      INSERT INTO accounts (id, account_id, provider_id, user_id, password)
      VALUES (${uuidv7()}, ${user!.id}, 'credential', ${user!.id}, ${hash})
      ON CONFLICT (provider_id, account_id) DO UPDATE SET password = excluded.password, updated_at = now()
    `;
  }
  console.log(`\nPassword for all of them: ${password}\n(kept in ${DEMO_PASSWORD_FILE}; delete the file for a new one)`);
}

const sql = connect();
try {
  if (command === "list") await list(sql);
  else if (command === "grant" || command === "revoke") await changeRole(sql, command, rest[0], rest[1]);
  else if (command === "demo") await demo(sql);
  else {
    console.error("Usage: pnpm accounts list | grant <email> <role> | revoke <email> <role> | demo  [--dry-run]");
    process.exitCode = 1;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await sql.end();
}
