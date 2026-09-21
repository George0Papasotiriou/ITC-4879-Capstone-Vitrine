/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Starts the local stack: an embedded PostgreSQL database plus the Next.js app, with no Docker.
 */

/**
 * The local stack (ADR-008): a real PostgreSQL and the app, with nothing to
 * install and no Docker.
 *
 *   pnpm local                     database + `next dev`   on http://localhost:3000
 *   pnpm local:start [--port N]    database + `next start` (after `pnpm build`)
 *   pnpm local:db                  database only, for tools and scripts
 *   pnpm catalog <command> …       a catalogue command (scripts/catalog.ts) against the database
 *   node scripts/local.mjs run scripts/<name>.ts …   any script against the database (evaluations)
 *
 * Options:
 *   --port N        app port (default 3000)
 *   --db-port N     database port (default 5433, clear of a real PostgreSQL on 5432)
 *   --ephemeral     in-memory database, discarded on exit (used by the test runs)
 *   --no-seed       leave an empty database empty
 *
 * The database is PGlite: PostgreSQL 18 compiled to WebAssembly, with pgvector,
 * pg_trgm and unaccent, served over the normal PostgreSQL wire protocol, so the
 * app, drizzle-kit and psql connect to it exactly as they would to a server. Its
 * data lives in `.local/pgdata` and survives restarts. Every start syncs the
 * catalogue from the repository — the specimen and the collection — exactly as
 * Railway's pre-deploy step does, adding new products and leaving stock alone;
 * the in-memory test database (--ephemeral) gets the 25 specimen products only.
 *
 * Jobs and storage use the inline and local drivers (see src/env.ts). No `.env`
 * file is read or written: the environment is passed to the processes started
 * here. The one generated value — the storage signing secret — is kept in
 * `.local/storage-secret`, created with owner-only permissions, and is not a
 * credential for anything outside this machine.
 */

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createConnection } from "node:net";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { unaccent } from "@electric-sql/pglite/contrib/unaccent";
import { vector } from "@electric-sql/pglite-pgvector";
import { createPgliteServer } from "./pglite-server.mjs";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const LOCAL_DIR = ".local";
const DATA_DIR = path.join(LOCAL_DIR, "pgdata");
const LOCK_FILE = path.join(LOCAL_DIR, "pgdata.lock");
const TSX = path.join("node_modules", "tsx", "dist", "cli.mjs");

const [mode = "dev", ...rest] = process.argv.slice(2);
if (!["dev", "start", "db", "catalog", "run"].includes(mode)) {
  console.error(`Unknown mode "${mode}". Use dev, start, db, catalog or run.`);
  process.exit(1);
}

function option(name, fallback) {
  const index = rest.indexOf(`--${name}`);
  return index === -1 ? fallback : rest[index + 1];
}

const appPort = Number(option("port", "3000"));
const dbPort = Number(option("db-port", "5433"));
const ephemeral = rest.includes("--ephemeral");
const seedOnStart = !rest.includes("--no-seed");
const databaseUrl = `postgres://postgres:postgres@127.0.0.1:${dbPort}/postgres`;

const log = (message) => process.stdout.write(`[local] ${message}\n`);

/** A random secret kept in .local/, so it survives restarts (signed URLs and cookies stay valid). */
async function localSecret(name) {
  const file = path.join(LOCAL_DIR, name);
  if (existsSync(file)) return (await readFile(file, "utf8")).trim();
  const secret = randomBytes(32).toString("base64url");
  await writeFile(file, secret, { mode: 0o600 });
  await chmod(file, 0o600).catch(() => {});
  return secret;
}

async function environment() {
  const env = {
    ...process.env,
    APP_URL: `http://localhost:${appPort}`,
    DATABASE_URL: databaseUrl,
    VITRINE_LOCAL: "1",
    JOBS_DRIVER: "inline",
    STORAGE_DRIVER: "local",
    LOCAL_STORAGE_DIR: path.join(LOCAL_DIR, ephemeral ? "storage-ephemeral" : "storage"),
    LOCAL_STORAGE_SECRET: await localSecret("storage-secret"),
    COOKIE_SECRET: await localSecret("cookie-secret"),
    BETTER_AUTH_SECRET: await localSecret("auth-secret"),
    PORT: String(appPort),
  };
  // A stray SKIP_ENV_VALIDATION would hide exactly the misconfiguration this
  // stack is meant to surface.
  delete env.SKIP_ENV_VALIDATION;
  return env;
}

function run(command, args, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [command, ...args], { env, stdio: "inherit" });
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

function isListening(port) {
  return new Promise((resolve) => {
    const socket = createConnection({ port, host: "127.0.0.1" });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * PGlite is an embedded database: two processes opening the same data folder
 * would corrupt it. The lock records which process owns the folder and on which
 * port it serves, so a second command can connect to that server instead.
 */
async function readLock() {
  if (!existsSync(LOCK_FILE)) return null;
  try {
    const lock = JSON.parse(await readFile(LOCK_FILE, "utf8"));
    return isAlive(lock.pid) ? lock : null;
  } catch {
    return null;
  }
}

async function startDatabase() {
  if (!ephemeral) {
    const lock = await readLock();
    if (lock !== null) {
      throw new Error(`The local database is already open by process ${lock.pid} on port ${lock.port}. Stop it first, or run \`pnpm catalog\` while it runs.`);
    }
  }

  const dataDir = ephemeral ? "memory://" : DATA_DIR;
  const startedAt = Date.now();
  const db = await PGlite.create(dataDir, { extensions: { vector, pg_trgm, unaccent } });
  const server = createPgliteServer({ db, port: dbPort, host: "127.0.0.1", maxConnections: 32 });

  try {
    await server.start();
  } catch (error) {
    await db.close();
    if (error?.code === "EADDRINUSE") {
      throw new Error(`Port ${dbPort} is in use. Stop the other process or pass --db-port.`);
    }
    throw error;
  }
  if (!ephemeral) await writeFile(LOCK_FILE, JSON.stringify({ pid: process.pid, port: dbPort }));

  // Apply the project's real migrations, the same ones production runs.
  const sql = postgres(databaseUrl, { max: 1, onnotice: () => {} });
  try {
    await migrate(drizzle(sql), { migrationsFolder: "./drizzle" });
  } finally {
    await sql.end();
  }

  log(`PostgreSQL (PGlite) ready on 127.0.0.1:${dbPort} in ${Date.now() - startedAt} ms, ${ephemeral ? "in memory" : `data in ${dataDir}`}`);

  const stopDatabase = async () => {
    await server.stop().catch(() => {});
    await db.close().catch(() => {});
    if (!ephemeral) await rm(LOCK_FILE, { force: true });
  };
  return stopDatabase;
}

async function main() {
  await mkdir(LOCAL_DIR, { recursive: true });
  const env = await environment();

  if (mode === "catalog" || mode === "run") {
    const args = rest.filter((arg, i) => arg !== "--db-port" && rest[i - 1] !== "--db-port");
    // `catalog <command>` is shorthand for `run scripts/catalog.ts <command>`.
    const script = mode === "catalog" ? ["scripts/catalog.ts", ...args] : args;
    if (script.length === 0 || !/^scripts\/[\w-]+\.ts$/.test(script[0])) {
      throw new Error("Usage: node scripts/local.mjs run scripts/<name>.ts [arguments]");
    }
    const lock = await readLock();
    if (lock !== null && (await isListening(lock.port))) {
      log(`using the running local database on port ${lock.port}`);
      process.exit(await run(TSX, script, { ...env, DATABASE_URL: `postgres://postgres:postgres@127.0.0.1:${lock.port}/postgres` }));
    }
    const stopDatabase = await startDatabase();
    const code = await run(TSX, script, env);
    await stopDatabase();
    process.exit(code);
  }

  const stopDatabase = await startDatabase();

  if (seedOnStart) {
    const code =
      // The shop gets the whole catalogue, synced on every start like a Railway
      // deploy; the throwaway test database gets the 25 specimen products only,
      // so the end-to-end tests always run against the same shelves.
      (await run(TSX, ["scripts/catalog.ts", "seed", ...(ephemeral ? ["--capsule", "--if-empty"] : ["--collection", "--capsule", "--sync"])], env)) ||
      // Content-based neighbour lists, so recommendations work from the first view.
      (await run(TSX, ["scripts/reco.ts", "rebuild", "--if-empty"], env)) ||
      // The support desk's ready answers, as a deploy writes them.
      (await run(TSX, ["scripts/support.ts", "macros"], env));
    if (code !== 0) {
      await stopDatabase();
      throw new Error("Seeding the catalogue failed; see the output above.");
    }
  }

  let child;
  let stopping = false;

  async function stop(code = 0) {
    if (stopping) return;
    stopping = true;
    if (child !== undefined && child.exitCode === null) {
      child.kill("SIGTERM");
      await new Promise((resolve) => child.once("exit", resolve));
    }
    await stopDatabase();
    log("stopped");
    process.exit(code);
  }

  process.on("SIGINT", () => void stop(0));
  process.on("SIGTERM", () => void stop(0));

  if (mode === "db") {
    log(`DATABASE_URL=${databaseUrl}`);
    log("Press Ctrl+C to stop.");
    return;
  }

  // Run Next through Node directly rather than a shell, which behaves the same
  // on Windows and Unix.
  const nextBin = path.join("node_modules", "next", "dist", "bin", "next");
  child = spawn(process.execPath, [nextBin, mode, "--port", String(appPort)], { env, stdio: "inherit" });

  log(`app starting on http://localhost:${appPort} (next ${mode})`);
  child.on("exit", (code) => void stop(code ?? 0));
}

main().catch((error) => {
  console.error(`[local] ${error.message}`);
  process.exit(1);
});
