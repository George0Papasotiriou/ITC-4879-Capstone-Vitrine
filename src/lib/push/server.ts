/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * The push subscription store for pages and route handlers.
 */

import { connection } from "next/server";

import { sql } from "@/lib/db/client";
import { createPushStore, type PushStore } from "@/lib/push/store";

let store: PushStore | undefined;

export async function pushStore(): Promise<PushStore> {
  await connection();
  return (store ??= createPushStore(sql));
}
