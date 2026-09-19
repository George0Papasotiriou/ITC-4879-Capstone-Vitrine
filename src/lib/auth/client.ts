/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * The browser's side of Better Auth: sign-in, sign-up, passkeys, two-factor and sessions for client components.
 */

import { passkeyClient } from "@better-auth/passkey/client";
import { adminClient, twoFactorClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

import { ac, authRoles } from "@/lib/auth/access";

/**
 * Talks to /api/auth on the same origin. The plugins mirror the server's
 * (src/lib/auth/config.ts), so the client knows their endpoints and types.
 * Nothing here decides who may do what: every call is checked by the server.
 */
export const authClient = createAuthClient({
  plugins: [twoFactorClient(), passkeyClient(), adminClient({ ac, roles: authRoles })],
});

/**
 * Better Auth's error codes, turned into the message keys the forms show. Any
 * code not listed falls back to a general "something went wrong" with the
 * suggestion to try again, rather than showing a raw code to a shopper.
 */
export function authErrorKey(code: string | undefined, status: number | undefined): string {
  if (status === 429) return "errorTooMany";
  switch (code) {
    case "INVALID_EMAIL_OR_PASSWORD":
    case "INVALID_PASSWORD":
      return "errorCredentials";
    case "EMAIL_NOT_VERIFIED":
      return "errorNotVerified";
    case "USER_ALREADY_EXISTS":
    case "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL":
      return "errorExists";
    case "PASSWORD_TOO_SHORT":
      return "errorPasswordShort";
    case "PASSWORD_TOO_LONG":
      return "errorPasswordLong";
    case "INVALID_EMAIL":
      return "errorEmail";
    case "INVALID_TOKEN":
    case "TOKEN_EXPIRED":
      return "errorLinkExpired";
    case "INVALID_CODE":
    case "INVALID_BACKUP_CODE":
      return "errorCode";
    case "ACCOUNT_TEMPORARILY_LOCKED":
    case "TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE":
      return "errorTooMany";
    case "INVALID_TWO_FACTOR_COOKIE":
      return "errorTwoFactorExpired";
    case "SESSION_NOT_FRESH":
      return "errorNotFresh";
    case "BANNED_USER":
      return "errorBanned";
    case "AUTH_CANCELLED":
    case "AUTHENTICATION_FAILED":
    case "REGISTRATION_CANCELLED":
    case "ERROR_CEREMONY_ABORTED":
      return "errorPasskeyCancelled";
    case "PREVIOUSLY_REGISTERED":
    case "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED":
      return "errorPasskeyExists";
    default:
      return "errorGeneric";
  }
}
