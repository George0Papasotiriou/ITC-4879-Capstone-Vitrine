/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * A fresh local shop for a demonstration: the local database set aside, never deleted, so the next start seeds anew.
 */

/**
 * docs/adr/046.
 *
 *   pnpm demo:reset --dry-run   what would be set aside
 *   pnpm demo:reset             set it aside; then `pnpm local` seeds a fresh shop
 *
 * On this machine only. The local database (.local/pgdata) is renamed, not
 * removed, so a reset can be undone by renaming it back. The next `pnpm
 * local` makes a new one and seeds it as on a first start: the catalogue,
 * the showcase accounts with their history (with the local demo password),
 * and `pnpm orders demo` adds the dashboard orders.
 *
 * Production is never reset by a script: its showcase history is written once
 * and `pnpm showcase lock` ends it (docs/adr/028). Deleting orders there would
 * also leave stock counts that no longer add up.
 */

import { existsSync } from "node:fs";
import { readdir, readFile, rename, stat } from "node:fs/promises";
import path from "node:path";

const LOCAL_DIR = ".local";
const DATA_DIR = path.join(LOCAL_DIR, "pgdata");
const LOCK_FILE = path.join(LOCAL_DIR, "pgdata.lock");
const dryRun = process.argv.includes("--dry-run");

/** A lock whose process is gone (a crash) does not count, as in scripts/local.mjs. */
async function runningShop() {
  if (!existsSync(LOCK_FILE)) return false;
  try {
    const { pid } = JSON.parse(await readFile(LOCK_FILE, "utf8"));
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function sizeOf(dir) {
  let bytes = 0;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    bytes += entry.isDirectory() ? await sizeOf(full) : (await stat(full)).size;
  }
  return bytes;
}

async function main() {
  if (process.env.NODE_ENV === "production" || (process.env.DATABASE_URL ?? "").includes("railway")) {
    throw new Error("demo:reset only runs on this machine, never against a deployed database.");
  }
  if (await runningShop()) throw new Error("The local shop is running (.local/pgdata.lock). Stop `pnpm local` first.");
  if (!existsSync(DATA_DIR)) {
    console.log("[demo:reset] No local database yet: the next `pnpm local` starts fresh anyway.");
    return;
  }
  const target = `${DATA_DIR}-before-reset-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const megabytes = ((await sizeOf(DATA_DIR)) / 1024 / 1024).toFixed(1);
  if (dryRun) {
    console.log(`[demo:reset] Would set aside ${DATA_DIR} (${megabytes} MB) as ${target}. Nothing changed.`);
    return;
  }
  await rename(DATA_DIR, target);
  console.log(`[demo:reset] Set aside ${DATA_DIR} (${megabytes} MB) as ${target}.`);
  console.log("[demo:reset] Next: `pnpm local` seeds a fresh shop; `pnpm orders demo` adds the dashboard orders.");
  console.log(`[demo:reset] To undo: stop the shop and rename ${target} back to ${DATA_DIR}.`);
}

main().catch((error) => {
  console.error(`[demo:reset] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
