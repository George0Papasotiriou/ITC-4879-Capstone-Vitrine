/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Creates the storage driver selected by the environment.
 */

import { serverEnv } from "@/env";
import type { StorageDriver } from "@/lib/storage/types";

/**
 * Storage, independent of the driver (ADR-008).
 *
 * The driver is created once per process. The S3 SDK is only loaded when the
 * s3 driver is selected, so the local stack never pulls it in.
 */
let driver: Promise<StorageDriver> | undefined;

export function storage(): Promise<StorageDriver> {
  driver ??= (async () => {
    const env = serverEnv();
    if (env.storageDriver === "s3") {
      const { createS3Driver } = await import("@/lib/storage/s3");
      return createS3Driver(env);
    }
    const { createLocalDriver } = await import("@/lib/storage/local");
    return createLocalDriver(env);
  })();
  return driver;
}

export type { StorageDriver } from "@/lib/storage/types";
