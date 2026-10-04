/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Request-scoped access to AI pictures for pages and route handlers.
 */

import { connection } from "next/server";

import { serverEnv } from "@/env";
import { sql } from "@/lib/db/client";
import { createPictureStore, type PictureStore } from "@/lib/pictures/store";

let store: PictureStore | undefined;

/** The picture store, at request time (docs/adr/053). */
export async function pictureStore(): Promise<PictureStore> {
  await connection();
  return (store ??= createPictureStore(sql, { fixtures: serverEnv().PICTURES_PROVIDER === "fixture" }));
}
