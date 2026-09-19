/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * The application's auth instance, configured from the environment on first use.
 */

import { serverEnv } from "@/env";
import { createAuth, type Auth } from "@/lib/auth/config";
import { db } from "@/lib/db/client";
import { appMailer } from "@/lib/email/server";
import { logger } from "@/lib/log";

let instance: Auth | undefined;

/**
 * Created on first use, like the database client: `next build` imports route
 * modules without the runtime environment, and must not need the secret.
 */
export function auth(): Auth {
  if (instance === undefined) {
    const env = serverEnv();
    const secret = env.BETTER_AUTH_SECRET;
    if (secret === undefined) {
      throw new Error("BETTER_AUTH_SECRET is not set. `pnpm local` generates one; in production it is required.");
    }
    instance = createAuth({
      db: db(),
      mailer: appMailer(),
      secret,
      baseURL: env.APP_URL,
      google:
        env.GOOGLE_CLIENT_ID !== undefined && env.GOOGLE_CLIENT_SECRET !== undefined
          ? { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET }
          : undefined,
      log: (level, message) => logger[level]({ auth: true }, message),
    });
  }
  return instance;
}

/** Whether "Continue with Google" can be offered. */
export function googleEnabled(): boolean {
  return serverEnv().GOOGLE_CLIENT_ID !== undefined;
}
