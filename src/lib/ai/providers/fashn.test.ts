/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Tests for the try-on drivers: what FASHN is asked, how its answers are read, and what the drawn stand-in returns.
 */

import { describe, expect, it } from "vitest";

import { categoryFor, createFashnDriver, dataUriBytes, toDataUri } from "@/lib/ai/providers/fashn";

const PERSON = toDataUri(new Uint8Array([1, 2, 3]), "image/webp");
const GARMENT = toDataUri(new Uint8Array([4, 5, 6]), "image/webp");

type Call = { url: string; init?: RequestInit };

/** A FASHN that answers a scripted sequence, and records what it was asked. */
function fakeFashn(steps: readonly { status: number; body?: unknown; bytes?: Uint8Array }[]): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  let index = 0;
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const step = steps[Math.min(index, steps.length - 1)]!;
    index += 1;
    if (step.bytes !== undefined) {
      return new Response(step.bytes as unknown as BodyInit, { status: step.status, headers: { "content-type": "image/png" } });
    }
    return new Response(JSON.stringify(step.body ?? {}), { status: step.status, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  return { fetch: fetchImpl, calls };
}

const driverWith = (steps: readonly { status: number; body?: unknown; bytes?: Uint8Array }[]) => {
  const fake = fakeFashn(steps);
  return { driver: createFashnDriver({ apiKey: "test-key", fetch: fake.fetch, pollMs: 0, sleep: async () => {} }), calls: fake.calls };
};

describe("which part of the body a piece belongs to", () => {
  it("follows the capsule's kinds", () => {
    expect(categoryFor("SHIRT")).toBe("tops");
    expect(categoryFor("COAT")).toBe("tops");
    expect(categoryFor("TROUSERS")).toBe("bottoms");
    expect(categoryFor("SKIRT")).toBe("bottoms");
    expect(categoryFor("DRESS")).toBe("one-pieces");
    expect(categoryFor("SOFA")).toBe("auto");
  });
});

describe("the FASHN driver", () => {
  it("asks for a run the way the API expects, and fetches the image itself", async () => {
    const { driver, calls } = driverWith([
      { status: 200, body: { id: "pred-1", error: null } },
      { status: 200, body: { id: "pred-1", status: "processing" } },
      { status: 200, body: { id: "pred-1", status: "completed", output: ["https://cdn.fashn.ai/pred-1/output_0.png"], error: null } },
      { status: 200, bytes: new Uint8Array([9, 9, 9]) },
    ]);

    const result = await driver.run({ person: PERSON, garment: GARMENT, category: "tops" });
    expect(result).toMatchObject({ ok: true, contentType: "image/png" });

    expect(calls[0]!.url).toBe("https://api.fashn.ai/v1/run");
    expect(calls[0]!.init?.method).toBe("POST");
    expect((calls[0]!.init?.headers as Record<string, string>).authorization).toBe("Bearer test-key");
    const body = JSON.parse(String(calls[0]!.init?.body)) as { model_name: string; inputs: Record<string, unknown> };
    expect(body.model_name).toBe("tryon-v1.6");
    expect(body.inputs.model_image).toBe(PERSON);
    expect(body.inputs.garment_image).toBe(GARMENT);
    expect(body.inputs.category).toBe("tops");
    expect(body.inputs.num_samples).toBe(1);
    // The photograph goes as data, never as a link to a public copy of it.
    expect(String(body.inputs.model_image).startsWith("data:")).toBe(true);
    expect(calls[1]!.url).toBe("https://api.fashn.ai/v1/status/pred-1");
    expect(driver.model).toBe("tryon-v1.6");
  });

  it("gives back a typed reason instead of throwing", async () => {
    const refused = driverWith([{ status: 402, body: { error: "out of credits" } }]);
    await expect(refused.driver.run({ person: PERSON, garment: GARMENT, category: "tops" })).resolves.toEqual({ ok: false, reason: "run_402" });

    const failed = driverWith([
      { status: 200, body: { id: "pred-2" } },
      { status: 200, body: { id: "pred-2", status: "failed", error: "moderation" } },
    ]);
    await expect(failed.driver.run({ person: PERSON, garment: GARMENT, category: "tops" })).resolves.toEqual({ ok: false, reason: "moderation" });

    const empty = driverWith([
      { status: 200, body: { id: "pred-3" } },
      { status: 200, body: { id: "pred-3", status: "completed", output: [] } },
    ]);
    await expect(empty.driver.run({ person: PERSON, garment: GARMENT, category: "tops" })).resolves.toEqual({ ok: false, reason: "no_output" });
  });

  it("gives up rather than polling for ever", async () => {
    const stuck = fakeFashn([
      { status: 200, body: { id: "pred-4" } },
      { status: 200, body: { id: "pred-4", status: "processing" } },
    ]);
    let clock = 0;
    const driver = createFashnDriver({
      apiKey: "k",
      fetch: stuck.fetch,
      pollMs: 1_000,
      timeoutMs: 5_000,
      sleep: async (ms) => {
        clock += ms;
      },
    });
    // The clock only moves when the driver waits, so the test does not.
    const started = Date.now;
    Date.now = () => started() + clock;
    try {
      await expect(driver.run({ person: PERSON, garment: GARMENT, category: "tops" })).resolves.toEqual({ ok: false, reason: "timeout" });
    } finally {
      Date.now = started;
    }
  });
});

describe("data URIs", () => {
  it("go out and come back the same", () => {
    const bytes = new Uint8Array([1, 2, 3, 250]);
    expect(dataUriBytes(toDataUri(bytes, "image/webp"))).toEqual(bytes);
  });

  it("refuse anything that is not one", () => {
    expect(dataUriBytes("https://example.com/photo.jpg")).toBeNull();
    expect(dataUriBytes("data:image/webp,not-base64")).toBeNull();
  });
});
