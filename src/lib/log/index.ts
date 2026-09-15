/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Structured JSON logger with request ids and redaction.
 */

import pino from "pino";

import { logConfig } from "@/env";
import { REQUEST_ID_HEADER } from "@/lib/log/request-id";

/**
 * Structured JSON logging for both `web` and `worker`.
 *
 * Output is single-line JSON everywhere except local development, where
 * pino-pretty is easier to read. Every line carries the service name, and every
 * line written while handling a request carries its request id.
 *
 * Privacy: user photos, message contents and secrets never reach the logger
 * (docs/PLAN.md 2.8). Log identifiers, not payloads — and the paths below are
 * redacted as a backstop in case one slips through.
 */

const config = logConfig();

const redactPaths = [
  "req.headers.authorization",
  "req.headers.cookie",
  "headers.authorization",
  "headers.cookie",
  "*.password",
  "*.secret",
  "*.token",
  "*.apiKey",
];

export const logger = pino({
  level: config.LOG_LEVEL,
  redact: { paths: redactPaths, censor: "[redacted]" },
  base: { service: config.VITRINE_SERVICE },
  ...(config.NODE_ENV === "development"
    ? { transport: { target: "pino-pretty", options: { colorize: true } } }
    : {}),
});

/** A child logger carrying a request or job identifier through a whole flow. */
export function loggerFor(bindings: Record<string, unknown>) {
  return logger.child(bindings);
}

/**
 * A logger bound to the current request, for route handlers and server
 * actions: `loggerForRequest(await headers())`.
 */
export function loggerForRequest(headers: Headers | { get(name: string): string | null }) {
  return logger.child({ requestId: headers.get(REQUEST_ID_HEADER) ?? undefined });
}
