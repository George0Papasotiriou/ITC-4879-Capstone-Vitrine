/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Unit tests for worker heartbeat freshness checks.
 */

import { describe, expect, it } from "vitest";

import { readHeartbeat } from "@/lib/jobs/heartbeat";

const now = new Date("2026-09-12T12:00:00.000Z");

describe("readHeartbeat", () => {
  it("accepts a beat written moments ago", () => {
    const beat = new Date(now.getTime() - 5_000).toISOString();
    expect(readHeartbeat(beat, now)).toEqual({ fresh: true, ageSeconds: 5 });
  });

  it("accepts a beat exactly at the TTL boundary", () => {
    const beat = new Date(now.getTime() - 60_000).toISOString();
    expect(readHeartbeat(beat, now, 60)).toEqual({ fresh: true, ageSeconds: 60 });
  });

  it("rejects a beat past the TTL", () => {
    const beat = new Date(now.getTime() - 61_000).toISOString();
    expect(readHeartbeat(beat, now, 60)).toEqual({
      fresh: false,
      reason: "stale",
      ageSeconds: 61,
    });
  });

  it("reports a missing key rather than guessing", () => {
    expect(readHeartbeat(null, now)).toEqual({
      fresh: false,
      reason: "missing",
      ageSeconds: null,
    });
  });

  it("reports an unparseable value rather than throwing", () => {
    expect(readHeartbeat("not a date", now)).toEqual({
      fresh: false,
      reason: "unparseable",
      ageSeconds: null,
    });
  });

  it("treats clock skew from the future as age zero, not negative", () => {
    const beat = new Date(now.getTime() + 30_000).toISOString();
    expect(readHeartbeat(beat, now)).toEqual({ fresh: true, ageSeconds: 0 });
  });
});
