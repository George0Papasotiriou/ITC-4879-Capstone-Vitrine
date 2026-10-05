/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Job processor for "On a model like you": a piece worn by the model a shopper picked, made once and kept for everyone.
 */

import { serverEnv } from "@/env";
import { MODELS, type ModelEntry } from "@/lib/ai/models";
import { toDataUri } from "@/lib/ai/providers/fashn";
import { createUsageStore } from "@/lib/ai/usage";
import { sql } from "@/lib/db/client";
import { studioDriver } from "@/lib/fitting/driver";
import { isModelPreset, modelShotPrompt } from "@/lib/fitting/presets";
import { createModelShotStore, modelShotKey } from "@/lib/fitting/shots-store";
import type { JobPayloads } from "@/lib/jobs/types";
import { loggerFor } from "@/lib/log";
import { storage } from "@/lib/storage";

/**
 * docs/adr/063. FASHN's Product to Model is given the piece's own studio
 * photograph and a brief naming the build and skin tone the shopper picked —
 * no face, nothing of the shopper's. The shot is stored under catalog/, served
 * to everyone at /media, and never made twice; the shopper who asked gets the
 * credits back if it fails.
 */

const FIXTURE_MODEL: ModelEntry = { provider: "fixture", id: "fashn-fixture", pricing: { kind: "tokens", inputUsdPerMillion: 0, outputUsdPerMillion: 0 } };

export async function processModelShot(payload: JobPayloads["model-shot"], jobId: string) {
  const log = loggerFor({ job: "model-shot", jobId });
  const env = serverEnv();
  const shots = createModelShotStore(sql);
  const usage = createUsageStore(sql, { mode: env.aiMode, killSwitch: env.AI_KILL_SWITCH, dailyBudgetEur: env.AI_DAILY_BUDGET_EUR });
  const files = await storage();

  const shot = await shots.byId(payload.shotId);
  if (shot === null) return { ok: false, reason: "gone" };
  if (shot.status === "done") return { ok: true, already: true };

  const [requester] = await sql<{ requested_by: string | null }[]>`SELECT requested_by FROM model_shots WHERE id = ${shot.id}`;
  const fail = async (reason: string) => {
    await shots.mark(shot.id, { status: "failed", failureReason: reason });
    const key = requester?.requested_by ?? null;
    if (key !== null) await usage.releaseCredits({ key, kind: key.startsWith("user:") ? "customer" : "guest" }, "model_shot", new Date().toISOString().slice(0, 10));
    log.warn({ shot: shot.id, reason }, "model shot failed");
    return { ok: false, reason };
  };

  if (!isModelPreset(shot.preset)) return fail("preset");
  const [product] = await sql<{ kind: string; department: string | null; src: string | null }[]>`
    SELECT p.kind, p.attributes->>'department' AS department,
           (SELECT m.src FROM product_media m WHERE m.product_id = p.id AND m.kind = 'image' ORDER BY m.position LIMIT 1) AS src
    FROM products p WHERE p.id = ${shot.productId}
  `;
  if (product?.src == null) return fail("piece_gone");

  await shots.mark(shot.id, { status: "running" });
  const response = await fetch(new URL(product.src, env.APP_URL).toString()).catch(() => null);
  if (response === null || !response.ok) return fail("piece_image");
  const photograph = new Uint8Array(await response.arrayBuffer());

  // A piece with no department (a bag, a pair of earrings) is shown on a woman or a man by the preset's place in the list.
  const department = product.department === "men" || product.department === "women" ? product.department : shot.preset === "slim-light" || shot.preset === "curvy-deep" ? "women" : "men";
  const driver = studioDriver(env);
  const outcome = await driver.modelShot({ product: toDataUri(photograph, response.headers.get("content-type") ?? "image/jpeg"), prompt: modelShotPrompt(shot.preset, department, product.kind) });
  if (!outcome.ok) return fail(outcome.reason);

  const key = modelShotKey(shot.productId, shot.preset);
  await files.putObject({ key, body: outcome.image, contentType: outcome.contentType });
  const model = driver.provider === "fixture" ? FIXTURE_MODEL : MODELS.modelShot;
  const cost = await usage.record({ feature: "model_shot", model, surface: "product", actorKey: requester?.requested_by ?? null, usage: { units: outcome.credits }, paid: driver.provider === "fashn" });
  await shots.mark(shot.id, { status: "done", storageKey: key, costMicros: cost });
  log.info({ shot: shot.id, preset: shot.preset, credits: outcome.credits, costMicros: cost }, "model shot done");
  return { ok: true, shot: shot.id };
}
