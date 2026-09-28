/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Runs Grafana k6 from the PATH, or from .local/tools where the project keeps a checked download.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

/**
 * k6 is a single binary, not an npm package. Installed on the machine, it is
 * on the PATH; otherwise the project keeps a release in .local/tools (never
 * committed), downloaded from github.com/grafana/k6/releases and checked
 * against the release's published SHA-256.
 */
function findK6() {
  const tools = path.join(".local", "tools");
  const binary = process.platform === "win32" ? "k6.exe" : "k6";
  if (existsSync(tools)) {
    for (const entry of readdirSync(tools).filter((name) => name.startsWith("k6-")).sort().reverse()) {
      const candidate = path.join(tools, entry, binary);
      if (existsSync(candidate)) return candidate;
    }
  }
  return "k6";
}

const k6 = findK6();
const result = spawnSync(k6, process.argv.slice(2), { stdio: "inherit" });
if (result.error !== undefined) {
  process.stderr.write(`[k6] could not start k6 (${result.error.message}). Install it (grafana.com/docs/k6) or place a release in .local/tools.\n`);
  process.exitCode = 1;
} else {
  process.exitCode = result.status ?? 1;
}
