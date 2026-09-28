/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Tests for the schedule table and its local stand-in.
 */

import { describe, expect, it } from "vitest";

import { SCHEDULES, startLocalSchedules } from "@/lib/jobs/schedule";

describe("SCHEDULES", () => {
  it("gives every schedule its own id and a five-field UTC cron pattern", () => {
    expect(new Set(SCHEDULES.map((schedule) => schedule.id)).size).toBe(SCHEDULES.length);
    for (const schedule of SCHEDULES) expect(schedule.pattern.split(" ")).toHaveLength(5);
  });

  it("stores the catalogue's 3D scans in production every five minutes", () => {
    expect(SCHEDULES.find((schedule) => schedule.job === "catalog-models")?.pattern).toBe("*/5 * * * *");
  });
});

describe("startLocalSchedules", () => {
  it("starts a timer for every schedule except the ones that run locally only by hand", () => {
    const started: number[] = [];
    const stop = startLocalSchedules({
      setTimer: ((_run: () => void, ms: number) => {
        started.push(ms);
        return { unref: () => {} } as unknown as ReturnType<typeof setInterval>;
      }) as unknown as typeof setInterval,
      clearTimer: (() => {}) as typeof clearInterval,
    });
    const onTimers = SCHEDULES.filter((schedule) => schedule.localEveryMs !== null);
    expect(started.sort()).toEqual(onTimers.map((schedule) => schedule.localEveryMs).sort());
    // A laptop never starts downloading the 3D scans on its own.
    expect(SCHEDULES.find((schedule) => schedule.job === "catalog-models")?.localEveryMs).toBeNull();
    stop();
  });
});
