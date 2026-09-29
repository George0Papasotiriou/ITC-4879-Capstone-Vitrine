/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Asking the worker to send a notification, so a request never waits on a push service.
 */

import { serverEnv } from "@/env";
import { enqueue } from "@/lib/jobs/queue";
import { logger } from "@/lib/log";
import type { PushNotice } from "@/lib/push/notices";

/** docs/adr/044. Nothing happens without the VAPID keys; a notification that cannot be queued is logged, never thrown. */
export async function queuePush(notice: PushNotice): Promise<void> {
  if (serverEnv().vapid === null) return;
  try {
    await enqueue("push-send", { requestedAt: new Date().toISOString(), notice });
  } catch (error) {
    logger.warn({ err: error, notice: notice.type }, "push notification not queued");
  }
}
