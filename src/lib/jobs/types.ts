/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Job names, payload types and queue constants shared by web and worker.
 */

import type { PushNotice } from "@/lib/push/notices";

/**
 * Job contracts shared by `web` (which enqueues) and `worker` (which runs).
 *
 * Adding a job means adding one entry here and one processor in
 * `src/worker/processors/`. The map is the single place that defines what a
 * job is called and what it carries, so a typo in either service is a compile
 * error rather than a job that silently never runs.
 */
export type JobPayloads = {
  /** Phase 1 liveness probe: proves web -> Redis -> worker end to end. */
  ping: { requestedAt: string; note?: string };
  /** Phase 8: rebuild the Taste Graph's neighbour lists and popularity (A2). Nightly in production. */
  "rebuild-taste-graph": { requestedAt: string; reason: "schedule" | "manual" | "simulation" };
  /** Phase 11: email the shoppers whose watched price has been reached (docs/adr/020). Nightly. */
  "price-watches": { requestedAt: string; reason: "schedule" | "manual" };
  /** Phase 9: run one try-on for a shopper who asked for it (docs/adr/023). */
  "try-on": { tryOnId: string; requestedAt: string };
  /** docs/adr/063: five seconds of video made from a finished try-on, for an account that asked for it. */
  "try-on-video": { tryOnId: string; requestedAt: string };
  /** docs/adr/063: a piece worn by the model a shopper picked, made once and kept for everyone. */
  "model-shot": { shotId: string; requestedAt: string };
  /** docs/adr/053: make one AI picture of a piece in a room, for a shopper who asked for it. */
  "picture-render": { pictureId: string; requestedAt: string };
  /** Phase 9: delete the photographs whose day is up, and the results made from them. Every 15 minutes. */
  "photo-expiry": { requestedAt: string; reason: "schedule" | "manual" };
  /** Phase 11: build the weekly PDF report and email the admins a link to it. Mondays. */
  "weekly-report": { requestedAt: string; reason: "schedule" | "manual"; /** Last day of the week to report on, YYYY-MM-DD; today when absent. */ endDay?: string };
  /** docs/adr/035: compress the next few ABO 3D scans into storage, until every piece that has one does. */
  "orders-expire": { requestedAt: string; reason: "schedule" | "manual" };
  "catalog-models": { requestedAt: string; reason: "schedule" | "manual"; /** How many scans this run takes on (default 8). */ limit?: number };
  /** docs/adr/058: build the shop's own models of the next pieces without a scan, so shoppers rarely wait for one. */
  "made-models": { requestedAt: string; reason: "schedule" | "manual"; /** How many models this run builds (default 30). */ limit?: number };
  /** docs/adr/044: one notification to the devices of the person it concerns (an order moved, a desk reply). */
  "push-send": { requestedAt: string; notice: PushNotice };
};

export type JobName = keyof JobPayloads;

/** One BullMQ queue per concern. Phase 1 needs only the default queue. */
export const QUEUE_NAMES = {
  default: "vitrine-default",
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

/** Which queue each job runs on. */
export const JOB_QUEUE: Record<JobName, QueueName> = {
  ping: QUEUE_NAMES.default,
  "rebuild-taste-graph": QUEUE_NAMES.default,
  "price-watches": QUEUE_NAMES.default,
  "weekly-report": QUEUE_NAMES.default,
  "try-on": QUEUE_NAMES.default,
  "try-on-video": QUEUE_NAMES.default,
  "model-shot": QUEUE_NAMES.default,
  "picture-render": QUEUE_NAMES.default,
  "photo-expiry": QUEUE_NAMES.default,
  "catalog-models": QUEUE_NAMES.default,
  "made-models": QUEUE_NAMES.default,
  "orders-expire": QUEUE_NAMES.default,
  "push-send": QUEUE_NAMES.default,
};

/**
 * The worker writes this key every 15 seconds with a 60 second TTL. `/api/health`
 * reads it to tell "worker is running" apart from "worker crashed 20 minutes ago".
 */
export const WORKER_HEARTBEAT_KEY = "vitrine:worker:heartbeat";
export const WORKER_HEARTBEAT_TTL_SECONDS = 60;
export const WORKER_HEARTBEAT_INTERVAL_MS = 15_000;
