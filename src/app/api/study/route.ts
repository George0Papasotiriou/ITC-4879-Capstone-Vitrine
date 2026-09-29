/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * The user study's recorder: a participant code, a task, and whether it started or how it ended.
 */

import { uuidv7 } from "uuidv7";
import { z } from "zod";

import { sharedRateLimiter } from "@/lib/kv/rate-limit";
import { sql } from "@/lib/db/client";
import { clientAddress } from "@/lib/geo/ip-country";
import { PARTICIPANT_CODE, STUDY_EVENTS, STUDY_TASKS } from "@/lib/study/tasks";

/**
 * docs/adr/037. Nothing but the code the moderator gave out, the task and the
 * event; the time is the server's, so a device's clock cannot change a
 * result. Limited per address.
 */

export const runtime = "nodejs";

const perAddress = sharedRateLimiter({ name: "study", limit: 60, windowMs: 60_000 });

const bodySchema = z.object({
  participant: z.string().regex(PARTICIPANT_CODE),
  task: z.enum(STUDY_TASKS),
  event: z.enum(STUDY_EVENTS),
});

export async function POST(request: Request): Promise<Response> {
  if (!(await perAddress(clientAddress(request.headers) ?? "unknown"))) return Response.json({ ok: false, reason: "slow_down" }, { status: 429 });
  const body = bodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return Response.json({ ok: false, reason: "invalid_request" }, { status: 400 });
  await sql`INSERT INTO study_events (id, participant, task, event, occurred_at) VALUES (${uuidv7()}, ${body.data.participant}, ${body.data.task}, ${body.data.event}, now())`;
  return Response.json({ ok: true });
}
