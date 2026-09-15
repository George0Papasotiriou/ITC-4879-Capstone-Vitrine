/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Unit tests for the inline jobs driver retry behaviour.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The inline driver must retry the way BullMQ does, or a job that is flaky in
 * production would look reliable locally (or the reverse). The registry is
 * mocked so failure can be scripted; everything else is the real driver.
 */

const calls = { ping: 0 };
let behaviour: "succeed" | "fail" | "fail-once" = "succeed";

vi.mock("@/worker/registry", () => ({
  processors: {
    ping: async () => {
      calls.ping += 1;
      if (behaviour === "fail") throw new Error("scripted failure");
      if (behaviour === "fail-once" && calls.ping === 1) throw new Error("scripted first failure");
      return { ok: true };
    },
  },
}));

const { backoffDelay, drainInlineJobs, enqueueInline, inlineJobStats } = await import("@/lib/jobs/inline");

const payload = { requestedAt: new Date(0).toISOString() };

beforeEach(() => {
  calls.ping = 0;
  behaviour = "succeed";
});

describe("backoffDelay", () => {
  it("doubles from the base, matching BullMQ's exponential setting", () => {
    expect([1, 2, 3, 4].map((attempt) => backoffDelay(attempt, 2_000))).toEqual([2_000, 4_000, 8_000, 16_000]);
  });
});

describe("enqueueInline", () => {
  it("returns an id immediately and runs the job afterwards", async () => {
    const before = inlineJobStats().succeeded;
    const id = enqueueInline("ping", payload);

    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    // Not yet run: enqueueing must never make the caller wait for the job.
    expect(calls.ping).toBe(0);

    await drainInlineJobs();
    expect(calls.ping).toBe(1);
    expect(inlineJobStats().succeeded).toBe(before + 1);
  });

  it("retries a failing job until its attempts are used up, then records the failure", async () => {
    behaviour = "fail";
    const before = inlineJobStats().failed;

    enqueueInline("ping", payload, { attempts: 3, backoffMs: 1 });
    await drainInlineJobs();

    expect(calls.ping).toBe(3);
    expect(inlineJobStats().failed).toBe(before + 1);
  });

  it("succeeds on a retry when the failure was transient", async () => {
    behaviour = "fail-once";
    const before = inlineJobStats();

    enqueueInline("ping", payload, { attempts: 3, backoffMs: 1 });
    await drainInlineJobs();

    expect(calls.ping).toBe(2);
    expect(inlineJobStats().succeeded).toBe(before.succeeded + 1);
    expect(inlineJobStats().failed).toBe(before.failed);
  });
});
