/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Resolves the visitor's country from a CDN header or the local IP database.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { serverEnv } from "@/env";
import { clientAddress, IpCountryIndex } from "@/lib/geo/ip-country";
import { logger } from "@/lib/log";

/**
 * The visitor's country from their request, without calling any outside
 * service: a CDN header when one is configured, otherwise the local IP
 * database. The address is used for this lookup only; it is not stored or
 * logged.
 */

export const DEFAULT_GEOIP_PATH = path.join(".local", "geoip", "dbip-country-lite.csv");
/** The same database compiled by `pnpm geoip update` (or `compile`): loads in milliseconds instead of seconds. */
export const DEFAULT_GEOIP_BINARY = path.join(".local", "geoip", "dbip-country-lite.bin");

let loaded: { index: IpCountryIndex | null; path: string | null; mtimeMs: number } | undefined;

/** The file to read: the configured one, else the compiled copy, else the CSV. */
function databaseFile(): string | null {
  const configured = serverEnv().GEOIP_DATABASE;
  if (configured !== undefined) return configured;
  if (existsSync(DEFAULT_GEOIP_BINARY)) return DEFAULT_GEOIP_BINARY;
  return existsSync(DEFAULT_GEOIP_PATH) ? DEFAULT_GEOIP_PATH : null;
}

function database(): IpCountryIndex | null {
  const file = databaseFile();
  if (file === null) return null;
  try {
    const { mtimeMs } = statSync(file);
    // Reload after `pnpm geoip update` replaces the file; otherwise keep the parsed index.
    if (loaded !== undefined && loaded.path === file && loaded.mtimeMs === mtimeMs) return loaded.index;
    const started = Date.now();
    const index = file.endsWith(".bin") ? IpCountryIndex.fromBinary(readFileSync(file)) : IpCountryIndex.fromCsv(readFileSync(file, "utf8"));
    loaded = { index, path: file, mtimeMs };
    logger.info({ geoip: { ranges: index.size, ms: Date.now() - started, format: file.endsWith(".bin") ? "binary" : "csv" } }, "IP country database loaded");
    return index;
  } catch (error) {
    logger.warn({ err: error, geoip: { file } }, "IP country database could not be read; prices default to Greece");
    loaded = { index: null, path: file, mtimeMs: -1 };
    return null;
  }
}

export function countryFromRequest(headers: { get(name: string): string | null }): string | null {
  const header = serverEnv().GEO_COUNTRY_HEADER;
  if (header !== undefined) {
    const value = headers.get(header)?.trim().toUpperCase();
    // Cloudflare uses XX for unknown and T1 for Tor.
    if (value !== undefined && /^[A-Z]{2}$/.test(value) && value !== "XX" && value !== "T1") return value;
  }
  const address = clientAddress(headers);
  if (address === null) return null;
  return database()?.lookup(address) ?? null;
}
