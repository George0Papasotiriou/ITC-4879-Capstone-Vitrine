/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * The application's mailer, configured from the environment.
 */

import { serverEnv } from "@/env";
import { sql } from "@/lib/db/client";
import { createMailer, type Mailer } from "@/lib/email/mailer";
import { isShowcaseAddress } from "@/lib/showcase/plan";

let mailer: Mailer | undefined;

export function appMailer(): Mailer {
  // The showcase's addresses are a real domain someone else may own: their mail stays in the outbox.
  mailer ??= createMailer({ sql, resendApiKey: serverEnv().RESEND_API_KEY, from: serverEnv().EMAIL_FROM, keepInOutbox: isShowcaseAddress });
  return mailer;
}

/**
 * Whether this request may read the outbox, which holds live one-time links:
 * on the local stack anyone may (that is its purpose there); in production
 * only an admin, and the caller checks the role.
 */
export function outboxIsOpen(): boolean {
  return serverEnv().VITRINE_LOCAL;
}
