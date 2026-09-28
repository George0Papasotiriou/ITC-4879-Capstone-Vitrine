/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Tests for turning study events into timed attempts.
 */

import { describe, expect, it } from "vitest";

import { attemptsFromEvents, PARTICIPANT_CODE } from "@/lib/study/tasks";

const at = (seconds: number) => new Date(Date.UTC(2026, 9, 1, 10, 0, seconds));

describe("attemptsFromEvents", () => {
  it("times each task from its start to its outcome, per participant", () => {
    const attempts = attemptsFromEvents([
      { participant: "P01", task: "find", event: "success", at: at(50) },
      { participant: "P01", task: "find", event: "start", at: at(5) },
      { participant: "P02", task: "find", event: "start", at: at(0) },
      { participant: "P02", task: "find", event: "fail", at: at(58) },
    ]);
    expect(attempts).toEqual([
      { participant: "P01", task: "find", outcome: "success", seconds: 45 },
      { participant: "P02", task: "find", outcome: "fail", seconds: 58 },
    ]);
  });

  it("restarts the clock on a second start, and leaves out a start that never ended", () => {
    const attempts = attemptsFromEvents([
      { participant: "P01", task: "size", event: "start", at: at(0) },
      { participant: "P01", task: "size", event: "start", at: at(20) },
      { participant: "P01", task: "size", event: "partial", at: at(50) },
      { participant: "P01", task: "room", event: "start", at: at(55) },
    ]);
    expect(attempts).toEqual([{ participant: "P01", task: "size", outcome: "partial", seconds: 30 }]);
  });

  it("accepts only codes like P07", () => {
    expect(PARTICIPANT_CODE.test("P07")).toBe(true);
    expect(PARTICIPANT_CODE.test("maria")).toBe(false);
    expect(PARTICIPANT_CODE.test("P7")).toBe(false);
  });
});
