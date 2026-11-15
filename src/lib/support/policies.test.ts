/**
 * Vitrine — AI-native e-shop (ITC 4879 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * The policies the support assistant answers from are the ones George approved, character for character.
 */

import { existsSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { POLICIES } from "@/lib/support/policies.generated";

/**
 * docs/policies.md is the document; the module is what a deployed server
 * reads. If they drift, the assistant would answer from an
 * older set of rules than the one on file, which is exactly the failure this
 * test exists to prevent. Run `pnpm support policies` after editing the
 * document. The document is kept out of the published source, so a checkout
 * without it skips this comparison; the module alone is what the shop uses.
 */
const POLICIES_DOCUMENT = "docs/policies.md";
const lf = (text: string) => text.replace(/\r\n/g, "\n");

describe("the policies the assistant reads", () => {
  it.skipIf(!existsSync(POLICIES_DOCUMENT))("are the document, exactly", () => {
    expect(lf(POLICIES)).toBe(lf(readFileSync(POLICIES_DOCUMENT, "utf8")));
  });

  it("still say the things the desk promises", () => {
    expect(POLICIES).toContain("14 days from delivery");
    expect(POLICIES).toContain("First reply within one working day");
    expect(POLICIES).toContain("test payment");
    // The assistant is told to hand over rather than guess.
    expect(POLICIES).toContain("pass it to a person");
  });
});
