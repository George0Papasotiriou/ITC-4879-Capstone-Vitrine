/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * "This order just changed": a message from whichever process moved it to every page showing it.
 */

import { kv } from "@/lib/kv";
import type { KeyValue } from "@/lib/kv/types";

/**
 * docs/adr/039. An order moves in the web server (the Stripe webhook, the
 * desk) or in the worker (payments expired after their hold). The page a
 * shopper is looking at learns of it through Redis publish/subscribe and a
 * Server-Sent Events stream (`/api/orders/[id]/live`), and refreshes — so
 * "Paid" appears the moment the bank confirms, without the page asking every
 * two seconds. The message carries only the order's new status: the page reads
 * everything else from the database with its own access check.
 */

const channel = (orderId: string) => `vt:order:${orderId}`;

export async function publishOrderChange(orderId: string, status: string, store: KeyValue = kv()): Promise<void> {
  try {
    await store.publish(channel(orderId), JSON.stringify({ status, at: new Date().toISOString() }));
  } catch {
    // A missed message only means the page shows the change on its next refresh.
  }
}

export function subscribeOrder(orderId: string, listener: (change: { status: string; at: string }) => void, store: KeyValue = kv()): Promise<() => void> {
  return store.subscribe(channel(orderId), (message) => {
    try {
      listener(JSON.parse(message) as { status: string; at: string });
    } catch {
      // Not a message of ours.
    }
  });
}

/**
 * Room boards (docs/adr/056): every change to a board, and who has it open.
 * A change carries nothing of the board: each page reads the board again with
 * its own link's rights. Presence is said on the same channel — "here" every
 * twenty seconds while a page is open, "left" when it closes — so every
 * process serving the board can count the people looking at it.
 */
export type BoardMessage = { type: "changed" } | { type: "here"; viewer: string } | { type: "left"; viewer: string };

const boardChannel = (boardId: string) => `vt:board:${boardId}`;

export async function publishBoard(boardId: string, message: BoardMessage, store: KeyValue = kv()): Promise<void> {
  try {
    await store.publish(boardChannel(boardId), JSON.stringify(message));
  } catch {
    // A missed change shows on the page's next read; a missed "here" on the next beat.
  }
}

export function subscribeBoard(boardId: string, listener: (message: BoardMessage) => void, store: KeyValue = kv()): Promise<() => void> {
  return store.subscribe(boardChannel(boardId), (message) => {
    try {
      listener(JSON.parse(message) as BoardMessage);
    } catch {
      // Not a message of ours.
    }
  });
}
