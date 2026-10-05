/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Job processor for "See it move": five seconds of video made from a finished try-on, kept as long as its photograph.
 */

import { serverEnv } from "@/env";
import { MODELS, type ModelEntry } from "@/lib/ai/models";
import { toDataUri } from "@/lib/ai/providers/fashn";
import { createUsageStore } from "@/lib/ai/usage";
import { sql } from "@/lib/db/client";
import { studioDriver } from "@/lib/fitting/driver";
import type { JobPayloads } from "@/lib/jobs/types";
import { loggerFor } from "@/lib/log";
import { tryOnVideoKey } from "@/lib/photos/photos";
import { createPhotoStore } from "@/lib/photos/store";
import { storage } from "@/lib/storage";

/**
 * docs/adr/063. The try-on's own picture goes to FASHN's Image to Video as a
 * data URI; the video comes back as a link, which is fetched at once and
 * stored beside the picture, gone when the photograph goes. FASHN keeps its
 * copy for up to three days (it has no shorter option for video), which the
 * shopper is told before asking. Credits are given back if nothing is made.
 */

const FIXTURE_MODEL: ModelEntry = { provider: "fixture", id: "fashn-fixture", pricing: { kind: "tokens", inputUsdPerMillion: 0, outputUsdPerMillion: 0 } };

export async function processTryOnVideo(payload: JobPayloads["try-on-video"], jobId: string) {
  const log = loggerFor({ job: "try-on-video", jobId });
  const env = serverEnv();
  const photos = createPhotoStore(sql);
  const usage = createUsageStore(sql, { mode: env.aiMode, killSwitch: env.AI_KILL_SWITCH, dailyBudgetEur: env.AI_DAILY_BUDGET_EUR });
  const files = await storage();

  const [row] = await sql<{ id: string; actor_key: string; result_key: string | null; video_status: string | null }[]>`
    SELECT t.id, t.actor_key, t.result_key, t.video_status FROM try_ons t
    JOIN uploads u ON u.id = t.upload_id AND u.deleted_at IS NULL
    WHERE t.id = ${payload.tryOnId} AND t.expires_at > now()
  `;
  if (row === undefined) return { ok: false, reason: "gone" };
  if (row.video_status === "done") return { ok: true, already: true };

  const fail = async (reason: string) => {
    await photos.markVideo(row.id, { status: "failed", failure: reason });
    await usage.releaseCredits({ key: row.actor_key, kind: row.actor_key.startsWith("user:") ? "customer" : "guest" }, "animate", new Date().toISOString().slice(0, 10));
    log.warn({ tryOn: row.id, reason }, "try-on video failed");
    return { ok: false, reason };
  };

  await photos.markVideo(row.id, { status: "running" });
  const picture = row.result_key === null ? null : await files.getObject(row.result_key);
  if (picture === null) return fail("picture_gone");

  const driver = studioDriver(env);
  const outcome = await driver.animate({ image: toDataUri(picture.body, picture.contentType) });
  if (!outcome.ok) return fail(outcome.reason);

  const videoKey = tryOnVideoKey(row.id, outcome.contentType);
  await files.putObject({ key: videoKey, body: outcome.image, contentType: outcome.contentType });
  const model = driver.provider === "fixture" ? FIXTURE_MODEL : MODELS.tryOnVideo;
  const cost = await usage.record({ feature: "animate", model, surface: "fitting-room", actorKey: row.actor_key, usage: { units: outcome.credits }, paid: driver.provider === "fashn" });
  await photos.markVideo(row.id, { status: "done", videoKey, costMicros: cost });
  log.info({ tryOn: row.id, provider: driver.provider, credits: outcome.credits, costMicros: cost, bytes: outcome.image.byteLength }, "try-on video done");
  return { ok: true, tryOn: row.id };
}
