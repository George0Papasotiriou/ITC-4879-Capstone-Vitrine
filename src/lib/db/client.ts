/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * PostgreSQL connection pool and Drizzle client.
 */

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { serverEnv } from "@/env";
import * as schema from "@/lib/db/schema";

/**
 * PostgreSQL is the single source of truth: relational data, full-text, fuzzy
 * and vector search live in the same database, so hybrid search is one round
 * trip and embeddings can never drift from the products they describe
 * (docs/PLAN.md 2.1).
 *
 * One pool per process, reused across requests. In development Next.js reloads
 * modules on every change, so the pool is cached on `globalThis` to avoid
 * leaking a connection per reload.
 *
 * The pool is created on first use, not on import. `next build` imports every
 * route module to read its configuration — the sitemap included — and a module
 * that connected at import time made the build require a database and a full
 * environment. Now importing this file costs nothing; the first query connects.
 */

const globalForDb = globalThis as unknown as {
  vitrineSql?: postgres.Sql;
};

function client(): postgres.Sql {
  if (globalForDb.vitrineSql === undefined) {
    const env = serverEnv();
    globalForDb.vitrineSql = postgres(env.DATABASE_URL, {
      max: env.NODE_ENV === "production" ? 10 : 3,
      idle_timeout: 20,
      connect_timeout: 10,
    });
  }
  return globalForDb.vitrineSql;
}

/**
 * The postgres.js client, created lazily. It behaves exactly like the client
 * itself — a tagged template function with methods such as `begin` and
 * `unsafe` — because the proxy forwards both calls and property reads to the
 * real client on first use.
 */
export const sql = new Proxy((() => {}) as unknown as postgres.Sql, {
  apply: (_target, thisArg, args) => Reflect.apply(client() as unknown as (...rest: unknown[]) => unknown, thisArg, args),
  get: (_target, property) => {
    const real = client();
    const value = Reflect.get(real, property, real) as unknown;
    return typeof value === "function" ? (value as (...rest: unknown[]) => unknown).bind(real) : value;
  },
});

let database: ReturnType<typeof drizzle<typeof schema>> | undefined;

/** Drizzle over the same pool, also created on first use. */
export function db() {
  database ??= drizzle(client(), { schema });
  return database;
}

export type Database = ReturnType<typeof db>;
