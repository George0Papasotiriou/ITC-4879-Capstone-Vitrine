/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Guards the proxy route matcher pattern against regressions.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * Guards the proxy matcher against the bug that shipped once (ADR-006).
 *
 * `config.matcher` must be a static literal — Next reads it at build time and
 * rejects imported constants — so it cannot be shared with a test by import.
 * Instead this reads the literal from the source, evaluates it exactly as
 * JavaScript would, and checks the resulting pattern.
 *
 * The failure it catches is invisible in review: `".*\\..*"` and `".*\..*"`
 * look almost identical, but the second is the string `.*..*`, and a regex
 * built from it excludes every path except `/`. Nothing fails to build; `/`
 * still redirects; every other page quietly skips the proxy.
 */

const source = readFileSync(fileURLToPath(new URL("./proxy.ts", import.meta.url)), "utf8");

function evaluatedMatcher(): string {
  const literal = /matcher:\s*\[\s*("(?:[^"\\]|\\.)*")\s*\]/.exec(source)?.[1];
  if (literal === undefined) throw new Error("Could not find config.matcher in src/proxy.ts");
  // JSON string escaping matches JavaScript's for this literal, and unlike
  // eval it cannot execute anything.
  return JSON.parse(literal) as string;
}

/** Next anchors the matcher to the whole path. */
function matches(path: string): boolean {
  return new RegExp(`^${evaluatedMatcher()}$`).test(path);
}

describe("proxy matcher", () => {
  it("keeps the escaped dot, so the file-extension exclusion is a literal dot", () => {
    expect(evaluatedMatcher()).toContain("\\.");
    expect(evaluatedMatcher()).not.toContain(".*..*");
  });

  it("runs on pages, so unprefixed paths get a locale", () => {
    for (const path of ["/", "/cart", "/design", "/c/lighting", "/el/p/oak-chair-8k62"]) {
      expect(matches(path), path).toBe(true);
    }
  });

  it("runs on API routes, so they receive request ids", () => {
    expect(matches("/api/health")).toBe(true);
  });

  it("skips Next internals and static files", () => {
    for (const path of [
      "/_next/static/chunks/main.js",
      "/_next/image",
      "/icons/icon-192.png",
      "/products/b07f2x8k62.webp",
      "/sw.js",
      "/manifest.webmanifest",
    ]) {
      expect(matches(path), path).toBe(false);
    }
  });
});
