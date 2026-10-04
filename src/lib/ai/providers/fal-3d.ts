/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * A small typed client for fal.ai's queue: a photograph in, a 3D model (.glb) out, from TRELLIS or TRELLIS.2.
 */

import { z } from "zod";

/**
 * docs/adr/059. Written against fal's own documentation (fal.ai/docs, "Queue",
 * and the TRELLIS and TRELLIS.2 API pages, read 2026-10-03), with no SDK: the
 * queue is three HTTP calls.
 *
 *   POST https://queue.fal.run/<model>   {image_url, …}       → request_id, status_url, response_url
 *   GET  status_url                                            → {status: IN_QUEUE | IN_PROGRESS | COMPLETED}
 *   GET  response_url                                          → TRELLIS {model_mesh: File}, TRELLIS.2 {model_glb: File}
 *
 * Every call carries `Authorization: Key <FAL_KEY>`. Every answer is checked
 * with zod: a changed API fails loudly here rather than storing nonsense.
 * The photograph sent is a product photograph from the catalogue (ABO,
 * CC BY 4.0) — never a shopper's.
 */

export type Fal3dModel = "fal-ai/trellis" | "fal-ai/trellis-2";

const submitted = z.object({ request_id: z.string().min(1), status_url: z.string().url(), response_url: z.string().url() });
const status = z.object({ status: z.enum(["IN_QUEUE", "IN_PROGRESS", "COMPLETED"]) });
const file = z.object({ url: z.string().url(), content_type: z.string().optional(), file_size: z.number().optional() });
const result = z.union([z.object({ model_mesh: file }), z.object({ model_glb: file })]);

export class Fal3dError extends Error {
  constructor(
    readonly reason: "refused" | "failed" | "timeout" | "unreadable",
    message: string,
  ) {
    super(message);
  }
}

export type Fal3dDeps = { key: string; fetch?: typeof fetch; sleep?: (ms: number) => Promise<void>; pollMs?: number; timeoutMs?: number };

/** The inputs each model is asked with: TRELLIS at 1024-pixel textures, TRELLIS.2 at 1024 resolution with 2048 textures. */
export function falInput(model: Fal3dModel, imageUrl: string): Record<string, unknown> {
  return model === "fal-ai/trellis" ? { image_url: imageUrl, texture_size: "1024", mesh_simplify: 0.95, seed: 4949 } : { image_url: imageUrl, resolution: "1024", texture_size: "2048", seed: 4949 };
}

/** Asks fal for a model of the photograph at `imageUrl`, waits for it, and returns where the .glb can be downloaded. */
export async function generate3d(model: Fal3dModel, imageUrl: string, deps: Fal3dDeps): Promise<{ requestId: string; glbUrl: string }> {
  const call = deps.fetch ?? fetch;
  const sleep = deps.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const headers = { authorization: `Key ${deps.key}`, "content-type": "application/json" };
  const read = async (response: Response) => {
    if (response.status === 401 || response.status === 403) throw new Fal3dError("refused", `fal refused the key (${response.status})`);
    if (!response.ok) throw new Fal3dError("failed", `fal answered ${response.status}`);
    return response.json() as Promise<unknown>;
  };

  const queued = submitted.safeParse(await read(await call(`https://queue.fal.run/${model}`, { method: "POST", headers, body: JSON.stringify(falInput(model, imageUrl)) })));
  if (!queued.success) throw new Fal3dError("unreadable", "fal's queue answer was not as documented");
  const started = Date.now();
  for (;;) {
    const now = status.safeParse(await read(await call(queued.data.status_url, { headers })));
    if (!now.success) throw new Fal3dError("unreadable", "fal's status answer was not as documented");
    if (now.data.status === "COMPLETED") break;
    if (Date.now() - started > (deps.timeoutMs ?? 600_000)) throw new Fal3dError("timeout", "fal took too long");
    await sleep(deps.pollMs ?? 3000);
  }
  const done = result.safeParse(await read(await call(queued.data.response_url, { headers })));
  if (!done.success) throw new Fal3dError("unreadable", "fal's result was not as documented");
  return { requestId: queued.data.request_id, glbUrl: "model_mesh" in done.data ? done.data.model_mesh.url : done.data.model_glb.url };
}
