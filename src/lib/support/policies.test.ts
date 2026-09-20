/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * The policies the support assistant answers from are the ones George approved, character for character.
 */

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { POLICIES } from "@/lib/support/policies.generated";

/**
 * docs/policies.md is the document; the module is what a deployed server
 * reads (docs/adr/021). If they drift, the assistant would answer from an
 * older set of rules than the one on file, which is exactly the failure this
 * test exists to prevent. Run `pnpm support policies` after editing the
 * document.
 */
describe("the policies the assistant reads", () => {
  it("are the document, exactly", () => {
    const markdown = readFileSync("docs/policies.md", "utf8");
    expect(POLICIES).toBe(markdown);
  });

  it("still say the things the desk promises", () => {
    expect(POLICIES).toContain("14 days from delivery");
    expect(POLICIES).toContain("First reply within one working day");
    expect(POLICIES).toContain("test payment");
    // The assistant is told to hand over rather than guess.
    expect(POLICIES).toContain("pass it to a person");
  });
});
