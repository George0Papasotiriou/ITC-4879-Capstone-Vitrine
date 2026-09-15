/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Request id validation and generation.
 */

import { uuidv7 } from "uuidv7";

/**
 * Request identifiers.
 *
 * Every request carries an id from the moment it enters the proxy, and every
 * log line written while handling it includes that id — so "the checkout
 * failed at 14:02" becomes one query rather than a search through interleaved
 * logs from every other request that second.
 *
 * An incoming `x-request-id` is kept when it is well-formed, so an id minted by
 * a load balancer in front of the app follows the request through. Anything
 * else is replaced: the header is attacker-controlled, and an unvalidated value
 * would let a client write arbitrary text into the logs (log forging), including
 * newlines that fake whole log entries.
 */
export const REQUEST_ID_HEADER = "x-request-id";

const WELL_FORMED = /^[A-Za-z0-9-]{8,64}$/;

export function resolveRequestId(incoming: string | null | undefined): string {
  if (incoming !== null && incoming !== undefined && WELL_FORMED.test(incoming)) {
    return incoming;
  }
  // UUIDv7, not v4: time-ordered, so ids sort in the order requests arrived,
  // which is also the project's id convention (CLAUDE.md).
  return uuidv7();
}
