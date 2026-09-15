/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Unit tests for request id validation and generation.
 */

import { describe, expect, it } from "vitest";

import { resolveRequestId } from "@/lib/log/request-id";

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("resolveRequestId", () => {
  it("keeps a well-formed id from upstream so it follows the request", () => {
    expect(resolveRequestId("0192f3a1-9c4e-7b21-8d3f-5a6b7c8d9e0f")).toBe(
      "0192f3a1-9c4e-7b21-8d3f-5a6b7c8d9e0f",
    );
    expect(resolveRequestId("lb-abc12345")).toBe("lb-abc12345");
  });

  it("mints a UUIDv7 when there is none", () => {
    expect(resolveRequestId(null)).toMatch(UUID_V7);
    expect(resolveRequestId(undefined)).toMatch(UUID_V7);
    expect(resolveRequestId("")).toMatch(UUID_V7);
  });

  it("replaces a value that could forge log entries", () => {
    // A newline would let a client append a fake line to the log.
    const forged = 'abc12345\n{"level":"info","msg":"payment approved"}';
    expect(resolveRequestId(forged)).toMatch(UUID_V7);
  });

  it("replaces values that are too short, too long or carry other characters", () => {
    expect(resolveRequestId("short")).toMatch(UUID_V7);
    expect(resolveRequestId("a".repeat(65))).toMatch(UUID_V7);
    expect(resolveRequestId("has spaces in it")).toMatch(UUID_V7);
    expect(resolveRequestId("<script>alert(1)</script>")).toMatch(UUID_V7);
  });

  it("mints time-ordered ids, so they sort in arrival order", async () => {
    const first = resolveRequestId(null);
    await new Promise((resolve) => setTimeout(resolve, 2));
    const second = resolveRequestId(null);
    expect([second, first].sort()).toEqual([first, second]);
  });
});
