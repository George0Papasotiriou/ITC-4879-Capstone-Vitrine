/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * The Fit Engine's store on the shared database client, at request time.
 */

import { connection } from "next/server";

import { sql } from "@/lib/db/client";
import { createFitStore, type FitStore } from "@/lib/fit/size/store";

let store: FitStore | undefined;

/** docs/adr/064. One store per process, so the typical piece's tolerance is worked out once every ten minutes rather than per page. */
export async function fitStore(): Promise<FitStore> {
  await connection();
  return (store ??= createFitStore(sql));
}
