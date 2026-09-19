/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Checks that no source file hides invisible characters: control codes, no-break spaces, byte-order marks or bidi controls.
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Twice, a tool that writes files turned an escape such as the one for a
 * no-break space into the character itself. The code still ran, but the
 * character is invisible in any editor or review, so nobody could read what a
 * regex matched. Code that needs such characters builds them by code point
 * (String.fromCharCode) or names them with a Unicode property class (\p{Cc}).
 */

const ROOTS = ["src", "scripts", "tests", "evals"];
const EXTENSIONS = new Set([".ts", ".tsx", ".mjs", ".mts", ".js"]);

function isInvisible(code: number): boolean {
  return (
    (code < 32 && code !== 9 && code !== 10 && code !== 13) ||
    code === 0x7f ||
    code === 0xa0 ||
    code === 0xfeff ||
    (code >= 0x200b && code <= 0x200f) ||
    (code >= 0x202a && code <= 0x202e) ||
    (code >= 0x2066 && code <= 0x2069)
  );
}

function sources(directory: string): string[] {
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.flatMap((entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : sources(full);
    return EXTENSIONS.has(path.extname(entry.name)) ? [full] : [];
  });
}

describe("source hygiene", () => {
  it("has no invisible characters in any source file", () => {
    const found: string[] = [];
    for (const file of ROOTS.flatMap(sources)) {
      readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, index) => {
          const codes = [...line].map((character) => character.codePointAt(0)!).filter(isInvisible);
          if (codes.length > 0) found.push(`${file}:${index + 1} (${codes.map((code) => `U+${code.toString(16).padStart(4, "0")}`).join(", ")})`);
        });
    }
    expect(found).toEqual([]);
  });
});
