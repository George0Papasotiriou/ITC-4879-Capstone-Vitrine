/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Integration test database setup using PostgreSQL or in-memory PGlite.
 */

import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { unaccent } from "@electric-sql/pglite/contrib/unaccent";
import { vector } from "@electric-sql/pglite-pgvector";
// The protocol server with its message-ordering fix (see the file for details).
import { createPgliteServer } from "../../../scripts/pglite-server.mjs";

/**
 * A database for the integration tests, with no Docker (ADR-008).
 *
 * If DATABASE_URL is already set — CI provides a real PostgreSQL with pgvector —
 * the tests use it. Otherwise this starts an in-memory PGlite for the run and
 * discards it afterwards, so `pnpm test:integration` works on any laptop and
 * every run starts from an empty database.
 *
 * Running the same suite against both is the point: a query that behaves
 * differently on PGlite and PostgreSQL shows up as a test that passes in one
 * place and fails in the other.
 */
const PORT = 5435;

export default async function setup(): Promise<(() => Promise<void>) | void> {
  if (process.env.DATABASE_URL !== undefined && process.env.DATABASE_URL !== "") return;

  const db = await PGlite.create("memory://", { extensions: { vector, pg_trgm, unaccent } });
  const server = createPgliteServer({ db, port: PORT, host: "127.0.0.1", maxConnections: 16 });
  await server.start();

  // Test workers are started after global setup, so they inherit this.
  process.env.DATABASE_URL = `postgres://postgres:postgres@127.0.0.1:${PORT}/postgres`;
  process.env.VITRINE_TEST_DATABASE = "pglite";

  return async () => {
    await server.stop();
    await db.close();
  };
}
