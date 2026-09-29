/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Integration tests for agent keys: made once, stored as a hash, limited, audited, revoked, and ended on their date.
 */

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { uuidv7 } from "uuidv7";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createAgentKeyStore, type AgentKeyStore } from "@/lib/agents/store";
import { hashAgentKey } from "@/lib/agents/tokens";
import * as schema from "@/lib/db/schema";

const url = process.env.DATABASE_URL;

describe.skipIf(url === undefined || url === "")("agent keys", () => {
  let connection: ReturnType<typeof postgres>;
  let keys: AgentKeyStore;
  let owner: { userId: string; email: string };
  let other: { userId: string; email: string };

  const person = async (name: string) => {
    const userId = uuidv7();
    const email = `${name.toLowerCase()}-${userId.slice(-6)}@example.com`;
    await connection`INSERT INTO users (id, name, email, email_verified) VALUES (${userId}, ${name}, ${email}, true)`;
    return { userId, email };
  };

  beforeAll(async () => {
    connection = postgres(url as string, { max: 4, onnotice: () => {} });
    await migrate(drizzle(connection, { schema }), { migrationsFolder: "./drizzle" });
    keys = createAgentKeyStore(connection);
  });

  beforeEach(async () => {
    owner = await person("Owner");
    other = await person("Other");
  });

  afterAll(async () => {
    await connection?.end();
  });

  it("makes a key shown once and stored only as its hash, and knows whose it is", async () => {
    const made = await keys.create(owner, { name: "Claude", scopes: ["cart", "orders"], days: 30 });
    if (!made.ok) throw new Error(made.reason);
    const [row] = await connection<{ token_hash: string; hint: string; scopes: string[] }[]>`SELECT token_hash, hint, scopes FROM agent_tokens WHERE id = ${made.view.id}`;
    expect(row!.token_hash).toBe(hashAgentKey(made.key));
    expect(JSON.stringify(row)).not.toContain(made.key);
    expect(row!.hint).toBe(made.key.slice(-4));
    expect(row!.scopes).toEqual(["cart", "orders"]);

    const identity = await keys.authenticate(made.key);
    expect(identity).toMatchObject({ keyId: made.view.id, scopes: ["cart", "orders"], user: { id: owner.userId, email: owner.email, emailVerified: true, roles: ["customer"] } });
    expect(await keys.authenticate(`${made.key.slice(0, -1)}x`)).toBeNull();
  });

  it("writes making and revoking to the audit log, never the key", async () => {
    const made = await keys.create(owner, { name: "Laptop", scopes: ["cart"], days: 7 });
    if (!made.ok) throw new Error(made.reason);
    expect(await keys.revoke(owner, made.view.id)).toBe(true);
    const entries = await connection<{ action: string; actor_email: string; changes: unknown }[]>`
      SELECT action, actor_email, changes FROM audit_log WHERE entity_type = 'agent' AND entity_id = ${made.view.id} ORDER BY created_at, action
    `;
    expect(entries.map((entry) => entry.action)).toEqual(["agent.create", "agent.revoke"]);
    expect(entries.every((entry) => entry.actor_email === owner.email)).toBe(true);
    expect(JSON.stringify(entries)).not.toContain(made.key);
  });

  it("stops a key at once when revoked, and lets only its owner revoke it", async () => {
    const made = await keys.create(owner, { name: "Phone", scopes: ["orders"], days: 1 });
    if (!made.ok) throw new Error(made.reason);
    expect(await keys.revoke(other, made.view.id)).toBe(false);
    expect(await keys.authenticate(made.key)).not.toBeNull();
    expect(await keys.revoke(owner, made.view.id)).toBe(true);
    expect(await keys.authenticate(made.key)).toBeNull();
    expect(await keys.revoke(owner, made.view.id)).toBe(false);
    expect((await keys.list(owner.userId)).find((key) => key.id === made.view.id)?.state).toBe("revoked");
  });

  it("ends a key on its date", async () => {
    const madeAt = new Date("2026-09-01T09:00:00Z");
    const made = await keys.create(owner, { name: "Short", scopes: ["cart"], days: 1 }, madeAt);
    if (!made.ok) throw new Error(made.reason);
    expect(await keys.authenticate(made.key, new Date("2026-09-01T20:00:00Z"))).not.toBeNull();
    expect(await keys.authenticate(made.key, new Date("2026-09-02T09:00:01Z"))).toBeNull();
    expect((await keys.list(owner.userId, new Date("2026-09-03T00:00:00Z"))).find((key) => key.id === made.view.id)?.state).toBe("expired");
  });

  it("keeps five keys active at most, and makes room when one is revoked", async () => {
    const made: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      const key = await keys.create(owner, { name: `Key ${i}`, scopes: ["cart"], days: 30 });
      if (!key.ok) throw new Error(key.reason);
      made.push(key.view.id);
    }
    expect(await keys.create(owner, { name: "One too many", scopes: ["cart"], days: 30 })).toEqual({ ok: false, reason: "too_many" });
    await keys.revoke(owner, made[0]!);
    expect((await keys.create(owner, { name: "Room again", scopes: ["cart"], days: 30 })).ok).toBe(true);
  });

  it("refuses a key whose account is banned, and remembers when a key was last used", async () => {
    const made = await keys.create(owner, { name: "Watcher", scopes: ["orders"], days: 30 });
    if (!made.ok) throw new Error(made.reason);
    const usedAt = new Date("2026-09-29T08:00:00Z");
    await keys.authenticate(made.key, usedAt);
    const [row] = await connection<{ last_used_at: Date }[]>`SELECT last_used_at FROM agent_tokens WHERE id = ${made.view.id}`;
    expect(new Date(row!.last_used_at).toISOString()).toBe(usedAt.toISOString());

    await connection`UPDATE users SET banned = true WHERE id = ${owner.userId}`;
    expect(await keys.authenticate(made.key)).toBeNull();
  });

  it("refuses unknown permissions and empty names in the database itself", async () => {
    await expect(
      connection`INSERT INTO agent_tokens (id, user_id, name, token_hash, hint, scopes, expires_at) VALUES (${uuidv7()}, ${owner.userId}, 'x', 'h1', 'abcd', ${["admin"]}::text[], now())`,
    ).rejects.toThrow(/agent_tokens_scopes_known/);
    await expect(
      connection`INSERT INTO agent_tokens (id, user_id, name, token_hash, hint, scopes, expires_at) VALUES (${uuidv7()}, ${owner.userId}, '', 'h2', 'abcd', ${["cart"]}::text[], now())`,
    ).rejects.toThrow(/agent_tokens_name_length/);
  });
});
