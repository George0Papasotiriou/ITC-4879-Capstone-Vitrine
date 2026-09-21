/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Job processor that runs one try-on: the shopper's photograph, the piece, and the result kept for a day.
 */

import { serverEnv } from "@/env";
import { MODELS, type ModelEntry } from "@/lib/ai/models";
import { categoryFor, createDrawnTryOnDriver, createFashnDriver, toDataUri, type TryOnDriver } from "@/lib/ai/providers/fashn";
import { createUsageStore } from "@/lib/ai/usage";
import { sql } from "@/lib/db/client";
import type { JobPayloads } from "@/lib/jobs/types";
import { loggerFor } from "@/lib/log";
import { tryOnKey } from "@/lib/photos/photos";
import { createPhotoStore } from "@/lib/photos/store";
import { storage } from "@/lib/storage";

/**
 * One try-on (docs/adr/023).
 *
 * The shopper's photograph never leaves the shop's storage except as a data
 * URI to the paid API they approved, and the result is stored beside it, with
 * the same day to live. Credits were taken when the try-on was asked for; they
 * are given back if it fails, because nothing was made.
 *
 * The garment's own photograph is fetched from the shop's public URL, so this
 * works whether it runs in the worker or in the web process.
 */

/** What the drawn stand-in is recorded as, so the AI page can tell it apart. */
const DRAWN_MODEL: ModelEntry = { provider: "drawn", id: "vitrine-drawn-composite", pricing: { kind: "tokens", inputUsdPerMillion: 0, outputUsdPerMillion: 0 } };

export async function processTryOn(payload: JobPayloads["try-on"], jobId: string) {
  const log = loggerFor({ job: "try-on", jobId });
  const env = serverEnv();
  const photos = createPhotoStore(sql);
  const usage = createUsageStore(sql, { mode: env.aiMode, killSwitch: env.AI_KILL_SWITCH, dailyBudgetEur: env.AI_DAILY_BUDGET_EUR });
  const files = await storage();

  const [row] = await sql<{
    id: string;
    upload_id: string;
    product_id: string | null;
    actor_key: string;
    status: string;
    expires_at: Date;
    storage_key: string | null;
    kind: string | null;
    media_src: string | null;
  }[]>`
    SELECT t.id, t.upload_id, t.product_id, t.actor_key, t.status, t.expires_at,
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

  const fail = async (reason: string) => {
    await photos.markTryOn(row.id, { status: "failed", failureReason: reason });
    // The shopper gets the credits back: nothing was made.
    const day = new Date().toISOString().slice(0, 10);
    await usage.releaseCredits({ key: row.actor_key, kind: row.actor_key.startsWith("user:") ? "customer" : "guest" }, "try_on", day);
    log.warn({ tryOn: row.id, reason }, "try-on failed");
    return { ok: false, reason };
  };

  await photos.markTryOn(row.id, { status: "running" });

  const person = row.storage_key === null ? null : await files.getObject(row.storage_key);
  if (person === null) return fail("photo_gone");
  if (row.media_src === null || row.kind === null) return fail("piece_gone");

  const garmentUrl = new URL(row.media_src, serverEnv().APP_URL).toString();
  const garmentResponse = await fetch(garmentUrl).catch(() => null);
  if (garmentResponse === null || !garmentResponse.ok) return fail("piece_image");
  const garment = new Uint8Array(await garmentResponse.arrayBuffer());

  const key = env.FASHN_API_KEY;
  const driver: TryOnDriver = key === undefined ? createDrawnTryOnDriver() : createFashnDriver({ apiKey: key });
  const outcome = await driver.run({
    person: toDataUri(person.body, person.contentType),
    garment: toDataUri(garment, garmentResponse.headers.get("content-type") ?? "image/webp"),
    category: categoryFor(row.kind),
  });
  if (!outcome.ok) return fail(outcome.reason);

  const resultKey = tryOnKey(row.id);
  await files.putObject({ key: resultKey, body: outcome.image, contentType: outcome.contentType });
  const cost = driver.drawn
    ? await usage.record({ feature: "try_on", model: DRAWN_MODEL, surface: "fitting-room", actorKey: row.actor_key, usage: { units: 1 } })
    : await usage.record({ feature: "try_on", model: MODELS.tryOn, surface: "fitting-room", actorKey: row.actor_key, usage: { units: 1 } });
  await photos.markTryOn(row.id, { status: "done", resultKey, costMicros: cost });

  const stats = { tryOn: row.id, provider: driver.provider, drawn: driver.drawn, costMicros: cost, bytes: outcome.image.byteLength };
  log.info(stats, "try-on done");
  return { ok: true, ...stats };
}
