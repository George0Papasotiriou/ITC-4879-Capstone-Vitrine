/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Better Auth configuration: email and password with verification, passkeys, TOTP two-factor, roles and Google.
 */

import { passkey } from "@better-auth/passkey";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { admin, twoFactor } from "better-auth/plugins";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { uuidv7 } from "uuidv7";

import { ac, authRoles } from "@/lib/auth/access";
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from "@/lib/auth/policy";
import { accounts, passkeys, sessions, twoFactors, users, verifications } from "@/lib/db/schema";
import type * as schema from "@/lib/db/schema";
import type { Mailer } from "@/lib/email/mailer";
import { emailLocale, resetPassword, verifyEmail } from "@/lib/email/templates";

/**
 * Accounts (docs/PLAN.md Phase 5 step 1, docs/adr/016).
 *
 * WHAT A SHOPPER GETS
 * - Email and password, with the address confirmed by a link before the first
 *   sign-in. Passwords of at least 10 characters, hashed with scrypt.
 * - Passkeys: sign in with the phone's or computer's own lock (WebAuthn); only
 *   the public key is stored.
 * - Two-step sign-in with an authenticator app (TOTP) and one-time backup codes.
 * - "Continue with Google", once George adds the Google credentials.
 * - A list of signed-in devices, each of which can be signed out.
 *
 * SECURITY CHOICES
 * - Sessions live in an httpOnly, SameSite=Lax cookie ("vt.session_token"),
 *   Secure whenever the site is served over HTTPS.
 * - Rate limits on every auth route in production, tighter on sign-in, sign-up
 *   and email sending (Better Auth's defaults: 3 per 10 s and 3 per minute per
 *   address).
 * - Resetting a password signs out every other device.
 * - A sign-up with an address that already exists answers exactly like a new
 *   one, so the form cannot be used to find out who has an account.
 * - Roles are checked on the server for every action (src/lib/auth/session.ts);
 *   Better Auth's own admin endpoints are limited to admins (access.ts).
 * - No telemetry is sent to Better Auth's authors.
 *
 * Built by a factory so the integration tests can run the real configuration
 * against the test database with a stand-in mailer.
 */

export type AuthDependencies = {
  db: PostgresJsDatabase<typeof schema>;
  mailer: Pick<Mailer, "sendEmail">;
  secret: string;
  /** Public origin, e.g. https://vitrine.up.railway.app. */
  baseURL: string;
  google?: { clientId: string; clientSecret: string };
  /** Rate limiting; Better Auth enables it in production only unless told. */
  rateLimit?: boolean;
  log?: (level: "debug" | "info" | "warn" | "error", message: string) => void;
};

/**
 * The language of an email, read from the page the person will land on
 * ("/el/account…"): the callback Better Auth puts in every link it sends.
 */
export function localeOfLink(url: string): "en" | "el" {
  try {
    const link = new URL(url);
    const callback = link.searchParams.get("callbackURL") ?? link.searchParams.get("redirectTo") ?? "";
    return emailLocale(/^\/(en|el)(?:\/|$|\?)/.exec(callback)?.[1]);
  } catch {
    return "en";
  }
}

export function createAuth({ db, mailer, secret, baseURL, google, rateLimit, log }: AuthDependencies) {
  const origin = new URL(baseURL);

  const deliver = (kind: string, to: string, send: () => ReturnType<Mailer["sendEmail"]>) =>
    send().catch((error: unknown) => log?.("error", `${kind} email could not be recorded: ${error instanceof Error ? error.message : String(error)}`));

  return betterAuth({
    appName: "Vitrine",
    baseURL: origin.origin,
    secret,
    trustedOrigins: [origin.origin],
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: { user: users, session: sessions, account: accounts, verification: verifications, twoFactor: twoFactors, passkey: passkeys },
    }),
    advanced: {
      cookiePrefix: "vt",
      database: { generateId: () => uuidv7() },
    },
    telemetry: { enabled: false },
    logger: log === undefined ? undefined : { level: "warn", log: (level, message) => log(level, message) },
    rateLimit: rateLimit === undefined ? undefined : { enabled: rateLimit },

    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      minPasswordLength: MIN_PASSWORD_LENGTH,
      maxPasswordLength: MAX_PASSWORD_LENGTH,
      revokeSessionsOnPasswordReset: true,
      resetPasswordTokenExpiresIn: 60 * 60,
      // Not awaited: answering at once, whether or not the address exists,
      // keeps the timing from telling anyone who has an account.
      sendResetPassword: async ({ user, url }) => {
        const locale = localeOfLink(url);
        void deliver("reset_password", user.email, () =>
          mailer.sendEmail({ to: user.email, kind: "reset_password", locale, content: resetPassword(locale, { name: user.name, url }) }),
        );
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: true,
      autoSignInAfterVerification: true,
      expiresIn: 60 * 60,
      sendVerificationEmail: async ({ user, url }) => {
        const locale = localeOfLink(url);
        await deliver("verify_email", user.email, () =>
          mailer.sendEmail({ to: user.email, kind: "verify_email", locale, content: verifyEmail(locale, { name: user.name, url }) }),
        );
      },
    },
    account: {
      // Google may join an existing account only for the address it has verified.
      accountLinking: { enabled: true, trustedProviders: ["google"] },
    },
    socialProviders: google === undefined ? {} : { google: { clientId: google.clientId, clientSecret: google.clientSecret, prompt: "select_account" } },

    plugins: [
      twoFactor({ issuer: "Vitrine" }),
      passkey({ rpID: origin.hostname, rpName: "Vitrine", origin: origin.origin }),
      admin({ ac, roles: authRoles, defaultRole: "customer", adminRoles: ["admin"] }),
      // Last, as Better Auth requires: lets server actions set the session cookie.
      nextCookies(),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
