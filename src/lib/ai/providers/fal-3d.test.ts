/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Unit tests for the fal 3D client, against a scripted queue: submit, wait, fetch the result; refusals and odd answers.
 */

import { describe, expect, it } from "vitest";

import { Fal3dError, falInput, generate3d } from "@/lib/ai/providers/fal-3d";

const STATUS = "https://queue.fal.run/fal-ai/trellis/requests/r1/status";
const RESULT = "https://queue.fal.run/fal-ai/trellis/requests/r1";

/** A queue that answers in order, and remembers what it was asked. */
function queue(answers: Record<string, (() => Response)[]>) {
  const asked: { url: string; init?: RequestInit }[] = [];
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    asked.push({ url, init });
    const next = answers[url]?.shift();
    if (next === undefined) throw new Error(`unexpected ${url}`);
    return next();
  }) as typeof fetch;
  return { fetcher, asked };
}

const json = (body: unknown, status = 200) => () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("generate3d", () => {
  it("submits the photograph, waits until it is done, and returns the model's address", async () => {
    const { fetcher, asked } = queue({
      "https://queue.fal.run/fal-ai/trellis": [json({ request_id: "r1", status_url: STATUS, response_url: RESULT })],
      [STATUS]: [json({ status: "IN_QUEUE" }), json({ status: "IN_PROGRESS" }), json({ status: "COMPLETED" })],
      [RESULT]: [json({ model_mesh: { url: "https://fal.media/files/chair.glb", content_type: "model/gltf-binary", file_size: 1234 } })],
    });
    const done = await generate3d("fal-ai/trellis", "https://example.org/chair.jpg", { key: "secret", fetch: fetcher, sleep: async () => {} });
    expect(done).toEqual({ requestId: "r1", glbUrl: "https://fal.media/files/chair.glb" });
    // Every call carries the key in fal's own header form; the photograph goes in the documented field.
    for (const call of asked) expect(new Headers(call.init?.headers).get("authorization")).toBe("Key secret");
    expect(JSON.parse(String(asked[0]!.init?.body))).toMatchObject({ image_url: "https://example.org/chair.jpg", texture_size: "1024" });
  });

  it("reads TRELLIS.2's model_glb", async () => {
    const { fetcher } = queue({
      "https://queue.fal.run/fal-ai/trellis-2": [json({ request_id: "r1", status_url: STATUS, response_url: RESULT })],
      [STATUS]: [json({ status: "COMPLETED" })],
      [RESULT]: [json({ model_glb: { url: "https://fal.media/files/sofa.glb" } })],
    });
    expect((await generate3d("fal-ai/trellis-2", "https://example.org/sofa.jpg", { key: "k", fetch: fetcher, sleep: async () => {} })).glbUrl).toBe("https://fal.media/files/sofa.glb");
  });

  it("says plainly when the key is refused", async () => {
    const { fetcher } = queue({ "https://queue.fal.run/fal-ai/trellis": [json({ detail: "no" }, 401)] });
    await expect(generate3d("fal-ai/trellis", "https://example.org/a.jpg", { key: "bad", fetch: fetcher })).rejects.toMatchObject({ reason: "refused" });
  });

  it("refuses an answer that is not what fal documents", async () => {
    const { fetcher } = queue({ "https://queue.fal.run/fal-ai/trellis": [json({ id: "r1" })] });
    await expect(generate3d("fal-ai/trellis", "https://example.org/a.jpg", { key: "k", fetch: fetcher })).rejects.toBeInstanceOf(Fal3dError);
  });

  it("gives up after its time is up", async () => {
    let clock = 0;
    const { fetcher } = queue({
      "https://queue.fal.run/fal-ai/trellis": [json({ request_id: "r1", status_url: STATUS, response_url: RESULT })],
      [STATUS]: Array.from({ length: 5 }, () => json({ status: "IN_PROGRESS" })),
    });
    const realNow = Date.now;
    Date.now = () => clock;
    try {
      await expect(
        generate3d("fal-ai/trellis", "https://example.org/a.jpg", {
          key: "k",
          fetch: fetcher,
          timeoutMs: 5000,
          sleep: async () => {
            clock += 3000;
          },
        }),
      ).rejects.toMatchObject({ reason: "timeout" });
    } finally {
      Date.now = realNow;
    }
  });

  it("asks each model with its own documented fields", () => {
    expect(Object.keys(falInput("fal-ai/trellis", "u"))).toEqual(expect.arrayContaining(["image_url", "texture_size", "mesh_simplify"]));
    expect(Object.keys(falInput("fal-ai/trellis-2", "u"))).toEqual(expect.arrayContaining(["image_url", "resolution", "texture_size"]));
  });
});
