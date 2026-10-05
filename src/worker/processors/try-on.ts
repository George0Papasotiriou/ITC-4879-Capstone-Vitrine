/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Job processor that runs one try-on — or one step of an outfit — for a shopper: the photograph, the piece, and the result kept for a day.
 */

import { serverEnv } from "@/env";
import { MODELS, type ModelEntry } from "@/lib/ai/models";
import { categoryFor, toDataUri } from "@/lib/ai/providers/fashn";
import { createUsageStore, type Actor } from "@/lib/ai/usage";
import { sql } from "@/lib/db/client";
import { studioDriver } from "@/lib/fitting/driver";
import { tryOnEngine } from "@/lib/fitting/engines";
import { enqueue } from "@/lib/jobs/queue";
import type { JobPayloads } from "@/lib/jobs/types";
import { loggerFor } from "@/lib/log";
import { tryOnKey } from "@/lib/photos/photos";
import { createPhotoStore } from "@/lib/photos/store";
import { storage } from "@/lib/storage";

/**
 * One try-on (docs/adr/023, docs/adr/063).
 *
 * The shopper's photograph never leaves the shop's storage except as a data
 * URI to the paid API they approved, and the result is stored beside it, with
 * the same day to live. Credits were taken when the try-on was asked for; they
 * are given back if it fails, because nothing was made.
 *
 * An outfit is a chain: its first step is made on the photograph, each later
 * one on the picture the step before made, so a jacket goes on over the shirt.
 * A step queues the next when it is done; a step that fails ends the outfit,
 * and the steps after it are marked failed and their credits given back.
 *
 * The garment's own photograph is fetched from its address (the shop's public
 * files, ABO's bucket or Amazon's image CDN), so this works in the worker and
 * in the web process alike.
 */

/** What the stand-ins are recorded as, so the AI page can tell them apart and charge nothing. */
const DRAWN_MODEL: ModelEntry = { provider: "drawn", id: "vitrine-drawn-composite", pricing: { kind: "tokens", inputUsdPerMillion: 0, outputUsdPerMillion: 0 } };
const FIXTURE_MODEL: ModelEntry = { provider: "fixture", id: "fashn-fixture", pricing: { kind: "tokens", inputUsdPerMillion: 0, outputUsdPerMillion: 0 } };

type Row = {
  id: string;
  upload_id: string;
  product_id: string | null;
  actor_key: string;
  status: string;
  storage_key: string | null;
  kind: string | null;
  media_src: string | null;
  outfit_id: string | null;
  outfit_position: number | null;
};

const actorOf = (key: string): Actor => ({ key, kind: key.startsWith("user:") ? "customer" : "guest" });

export async function processTryOn(payload: JobPayloads["try-on"], jobId: string) {
  const log = loggerFor({ job: "try-on", jobId });
  const env = serverEnv();
  const photos = createPhotoStore(sql);
  const usage = createUsageStore(sql, { mode: env.aiMode, killSwitch: env.AI_KILL_SWITCH, dailyBudgetEur: env.AI_DAILY_BUDGET_EUR });
  const files = await storage();

  const [row] = await sql<Row[]>`
    SELECT t.id, t.upload_id, t.product_id, t.actor_key, t.status, t.outfit_id, t.outfit_position,
           u.storage_key, p.kind,
           (SELECT m.src FROM product_media m WHERE m.product_id = p.id AND m.kind = 'image' ORDER BY m.position LIMIT 1) AS media_src
    FROM try_ons t
    JOIN uploads u ON u.id = t.upload_id AND u.deleted_at IS NULL
    LEFT JOIN products p ON p.id = t.product_id
    WHERE t.id = ${payload.tryOnId}
  `;

  if (row === undefined) {
    log.warn({ tryOn: payload.tryOnId }, "try-on has no photograph any more");
    return { ok: false, reason: "gone" };
  }
  if (row.status === "done") return { ok: true, already: true };

  const day = new Date().toISOString().slice(0, 10);
  const later = async () =>
    row.outfit_id === null
      ? []
      : await sql<{ id: string }[]>`SELECT id FROM try_ons WHERE outfit_id = ${row.outfit_id} AND outfit_position > ${row.outfit_position ?? 0} AND status IN ('queued', 'running')`;

  const fail = async (reason: string) => {
    await photos.markTryOn(row.id, { status: "failed", failureReason: reason });
    // The shopper gets the credits back: nothing was made. In an outfit, nothing after this step is made either.
    const rest = await later();
    for (const step of rest) await photos.markTryOn(step.id, { status: "failed", failureReason: "outfit_stopped" });
    await usage.releaseCredits(actorOf(row.actor_key), "try_on", day, 1 + rest.length);
    log.warn({ tryOn: row.id, reason, stoppedAfter: rest.length }, "try-on failed");
    return { ok: false, reason };
  };

  await photos.markTryOn(row.id, { status: "running" });

  // The person: the photograph, or — for a later step of an outfit — the picture the step before made.
  let person: { body: Uint8Array; contentType: string } | null = null;
  if (row.outfit_id !== null && (row.outfit_position ?? 0) > 0) {
    const [previous] = await sql<{ result_key: string | null; status: string }[]>`
      SELECT result_key, status FROM try_ons WHERE outfit_id = ${row.outfit_id} AND outfit_position = ${(row.outfit_position ?? 0) - 1}
    `;
    if (previous?.status !== "done" || previous.result_key === null) return fail("outfit_stopped");
    person = await files.getObject(previous.result_key);
  } else {
    person = row.storage_key === null ? null : await files.getObject(row.storage_key);
  }
  if (person === null) return fail("photo_gone");
  if (row.media_src === null || row.kind === null) return fail("piece_gone");

  const garmentUrl = new URL(row.media_src, env.APP_URL).toString();
  const garmentResponse = await fetch(garmentUrl).catch(() => null);
  if (garmentResponse === null || !garmentResponse.ok) return fail("piece_image");
  const garment = new Uint8Array(await garmentResponse.arrayBuffer());

  const driver = studioDriver(env);
  const engine = tryOnEngine(row.kind, env.FASHN_TRYON_MODEL);
  const outcome = await driver.run({
    person: toDataUri(person.body, person.contentType),
    garment: toDataUri(garment, garmentResponse.headers.get("content-type") ?? "image/jpeg"),
    category: categoryFor(row.kind),
    engine,
  });
  if (!outcome.ok) return fail(outcome.reason);

  const resultKey = tryOnKey(row.id);
  await files.putObject({ key: resultKey, body: outcome.image, contentType: outcome.contentType });
  // FASHN bills credits; the record carries them as units, at the engine's price.
  const model = driver.drawn ? DRAWN_MODEL : driver.provider === "fixture" ? FIXTURE_MODEL : engine === "max" ? MODELS.tryOnMax : MODELS.tryOn;
  const cost = await usage.record({ feature: "try_on", model, surface: "fitting-room", actorKey: row.actor_key, usage: { units: outcome.credits }, paid: driver.provider === "fashn" });
  await photos.markTryOn(row.id, { status: "done", resultKey, costMicros: cost });

  // The next piece of the outfit goes on over this one.
  if (row.outfit_id !== null) {
    const [next] = await sql<{ id: string }[]>`
      SELECT id FROM try_ons WHERE outfit_id = ${row.outfit_id} AND outfit_position = ${(row.outfit_position ?? 0) + 1} AND status = 'queued'
    `;
    if (next !== undefined) await enqueue("try-on", { tryOnId: next.id, requestedAt: new Date().toISOString() });
  }

  const stats = { tryOn: row.id, provider: driver.provider, engine, credits: outcome.credits, drawn: driver.drawn, costMicros: cost, bytes: outcome.image.byteLength, outfitPosition: row.outfit_position };
  log.info(stats, "try-on done");
  return { ok: true, ...stats };
}
