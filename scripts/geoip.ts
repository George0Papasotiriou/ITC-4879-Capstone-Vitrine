/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Downloads and queries the local IP-to-country database used for prices by country.
 */

/**
 * The IP-to-country database behind prices by country (docs/adr/013).
 *
 *   pnpm geoip update --dry-run   say what would be downloaded, and how big it is
 *   pnpm geoip update             download this month's DB-IP "IP to Country Lite"
 *   pnpm geoip check 5.54.1.2     look an address up in the local copy
 *
 * DB-IP Lite is free under CC BY 4.0 (attribution on the credits page). It is a
 * gzipped CSV of address ranges, about 4–5 MB compressed and 20–30 MB unpacked,
 * refreshed monthly. The file is written to .local/geoip/ (git-ignored); in
 * production, GEOIP_DATABASE points at a copy on a volume. Nothing about any
 * visitor is sent anywhere: the download is the database itself.
 */

import { createWriteStream, existsSync, readFileSync } from "node:fs";
import { mkdir, rename, stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";

import { DEFAULT_GEOIP_PATH } from "@/lib/geo/server";
import { IpCountryIndex } from "@/lib/geo/ip-country";

const [command, ...rest] = process.argv.slice(2);
const dryRun = rest.includes("--dry-run");

function sourceUrl(date = new Date()): string {
  const month = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
  return `https://download.db-ip.com/free/dbip-country-lite-${month}.csv.gz`;
}

async function update() {
  // DB-IP publishes early in the month; fall back to last month's file until then.
  const now = new Date();
  const candidates = [sourceUrl(now), sourceUrl(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)))];
  let url: string | null = null;
  let size: number | null = null;
  for (const candidate of candidates) {
    const head = await fetch(candidate, { method: "HEAD" });
    if (head.ok) {
      url = candidate;
      size = Number(head.headers.get("content-length") ?? "0") || null;
      break;
    }
  }
  if (url === null) throw new Error(`No DB-IP Lite file found at ${candidates.join(" or ")}`);

  const megabytes = size === null ? "unknown size" : `${(size / 1_048_576).toFixed(1)} MB compressed`;
  console.log(`Source: ${url} (${megabytes}), licence CC BY 4.0`);
  console.log(`Destination: ${DEFAULT_GEOIP_PATH}`);
  if (dryRun) {
    console.log("Dry run: nothing downloaded.");
    return;
  }

  await mkdir(path.dirname(DEFAULT_GEOIP_PATH), { recursive: true });
  const response = await fetch(url);
  if (!response.ok || response.body === null) throw new Error(`Download failed: HTTP ${response.status}`);
  const partial = `${DEFAULT_GEOIP_PATH}.partial`;
  await pipeline(Readable.fromWeb(response.body as import("node:stream/web").ReadableStream), createGunzip(), createWriteStream(partial));

  // Refuse a file that does not parse into a plausible database, rather than replace a good one.
  const index = IpCountryIndex.fromCsv(readFileSync(partial, "utf8"));
  if (index.size < 100_000) throw new Error(`Only ${index.size} ranges parsed; keeping the previous database.`);
  await rename(partial, DEFAULT_GEOIP_PATH);
  const { size: bytes } = await stat(DEFAULT_GEOIP_PATH);
  console.log(`Saved ${index.size.toLocaleString("en")} ranges (${(bytes / 1_048_576).toFixed(1)} MB). Restart the app to load it.`);
}

function check(address: string | undefined) {
  if (address === undefined) throw new Error("Usage: pnpm geoip check <address>");
  if (!existsSync(DEFAULT_GEOIP_PATH)) throw new Error(`No database at ${DEFAULT_GEOIP_PATH}. Run: pnpm geoip update`);
  const index = IpCountryIndex.fromCsv(readFileSync(DEFAULT_GEOIP_PATH, "utf8"));
  console.log(`${address}: ${index.lookup(address) ?? "no country (private or unknown)"}`);
}

if (command === "update") await update();
else if (command === "check") check(rest[0]);
else {
  console.error("Usage: pnpm geoip update [--dry-run] | pnpm geoip check <address>");
  process.exitCode = 1;
}
