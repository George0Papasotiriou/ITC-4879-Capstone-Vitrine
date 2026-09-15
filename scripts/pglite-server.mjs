/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * PGlite PostgreSQL wire-protocol server with fixes for error recovery and connection handling.
 */

/**
 * PGlite's PostgreSQL wire-protocol server, with two protocol fixes: error
 * recovery (below) and one connection at a time (see createPgliteServer).
 *
 * The bug. In PostgreSQL's extended query protocol a client sends a statement
 * as separate messages — Parse, Bind, Execute — and ends it with Sync. If one
 * of them fails, the server replies with ErrorResponse, ignores everything up
 * to the Sync, and then sends exactly one ReadyForQuery. `pglite-socket`
 * 0.2.11 hands PGlite one message at a time, and PGlite answers a failing
 * message with ErrorResponse *and* ReadyForQuery, then answers the Sync with a
 * second ReadyForQuery. The client takes the extra ReadyForQuery as the end of
 * its next query, and from then on every query on that connection receives the
 * previous query's result.
 *
 * Found by the catalogue integration test: after a rejected INSERT the next
 * statement "succeeded" with an empty result and the error surfaced one query
 * later. A wire trace showed it plainly:
 *
 *   client  Bind  Execute  Sync
 *   server  BindComplete  ErrorResponse  ReadyForQuery  ReadyForQuery
 *
 * It shows up with clients that send Sync in a separate message from the
 * failing one, which postgres.js does whenever it first describes a statement —
 * so it affects the app and the tests, but not every quick experiment.
 *
 * The fix restores PostgreSQL's behaviour per connection. After a message in
 * an extended-protocol cycle produces an ErrorResponse, any ReadyForQuery that
 * came with it is dropped and the following messages are discarded, until the
 * Sync, whose single ReadyForQuery is passed through. Simple queries, which
 * legitimately end in ErrorResponse plus ReadyForQuery, are left alone.
 *
 * Used by the local stack (scripts/local.mjs) and the integration tests
 * (tests/integration/pglite-protocol.test.ts proves both fixes). Production uses a
 * real PostgreSQL and never loads this file.
 */

import { PGLiteSocketServer } from "@electric-sql/pglite-socket";

const MESSAGE = {
  bind: 0x42, // B
  close: 0x43, // C
  describe: 0x44, // D
  execute: 0x45, // E
  flush: 0x48, // H
  parse: 0x50, // P
  query: 0x51, // Q
  sync: 0x53, // S
  terminate: 0x58, // X
};
const EXTENDED = new Set([MESSAGE.bind, MESSAGE.close, MESSAGE.describe, MESSAGE.execute, MESSAGE.flush, MESSAGE.parse]);

const RESPONSE = { error: 0x45 /* E */, ready: 0x5a /* Z */ };

/** Split backend output into whole messages: one type byte, then a length that counts itself. */
function* messages(bytes) {
  let offset = 0;
  while (offset + 5 <= bytes.length) {
    const length = bytes.readInt32BE(offset + 1);
    const end = offset + 1 + length;
    if (length < 4 || end > bytes.length) {
      // Not a sequence of whole messages; pass the remainder through untouched.
      yield bytes.subarray(offset);
      return;
    }
    yield bytes.subarray(offset, end);
    offset = end;
  }
  if (offset < bytes.length) yield bytes.subarray(offset);
}

/**
 * The response to one extended-protocol message, with PGlite's premature
 * ReadyForQuery removed if the message failed. Returns the bytes to send and
 * whether the message failed.
 */
export function withoutPrematureReady(output) {
  const kept = [];
  let failed = false;
  for (const message of messages(output)) {
    if (message[0] === RESPONSE.error) failed = true;
    if (failed && message[0] === RESPONSE.ready) continue;
    kept.push(message);
  }
  return { bytes: failed ? Buffer.concat(kept) : output, failed };
}

export function createPgliteServer(options) {
  const server = new PGLiteSocketServer(options);
  const queue = server.queryQueue;
  if (queue === undefined || typeof queue.enqueue !== "function") {
    throw new Error("pglite-socket no longer exposes queryQueue.enqueue; review scripts/pglite-server.mjs.");
  }

  const enqueue = queue.enqueue.bind(queue);
  const clearQueueForHandler = queue.clearQueueForHandler.bind(queue);
  const db = options.db;

  /** Connections whose current extended-protocol cycle has failed, awaiting Sync. */
  const failedCycles = new Set();

  /*
   * Second fix: one connection at a time.
   *
   * PGlite is a single database session, and every socket connection shares
   * it. Unnamed prepared statements and portals, and transaction state, belong
   * to that session. pglite-socket queues individual messages, so two
   * connections querying at once interleave them — connection A's Parse and
   * Bind, then B's Parse (which replaces the unnamed statement), then A's
   * Execute — and A fails with `portal "" does not exist` or, worse, runs B's
   * statement. The integration tests hit this as soon as two retrievers ran in
   * parallel; the app would hit it under concurrent requests.
   *
   * So the session is lent to one connection for a whole cycle: from its first
   * message until a Sync or simple Query completes outside a transaction.
   * Other connections wait their turn, in arrival order. A connection that
   * disconnects mid-cycle gives its turn back.
   */
  let owner = null;
  const waiting = [];

  function acquire(handlerId) {
    if (owner === null || owner === handlerId) {
      owner = handlerId;
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => waiting.push({ handlerId, resolve, reject }));
  }

  function release() {
    owner = null;
    const next = waiting.shift();
    if (next !== undefined) {
      owner = next.handlerId;
      next.resolve();
    }
  }

  /** Sync, a simple Query, Terminate and startup messages each end a cycle; extended messages continue one. */
  const endsCycle = (type) => !EXTENDED.has(type);

  async function handleMessage(handlerId, message, onData) {
    const type = message[0];

    if (type === MESSAGE.terminate) failedCycles.delete(handlerId);

    if (type === MESSAGE.sync) {
      failedCycles.delete(handlerId);
      return enqueue(handlerId, message, onData);
    }

    if (!EXTENDED.has(type)) return enqueue(handlerId, message, onData);

    // PostgreSQL ignores the rest of a failed cycle; so does this server.
    if (failedCycles.has(handlerId)) return 0;

    const chunks = [];
    const count = await enqueue(handlerId, message, (data) => chunks.push(Buffer.from(data)));
    const { bytes, failed } = withoutPrematureReady(Buffer.concat(chunks));
    if (failed) failedCycles.add(handlerId);
    if (bytes.length > 0) onData(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
    return count;
  }

  /*
   * Messages from one connection are also handled strictly one after another.
   * pglite-socket starts a handler for every TCP data event without waiting for
   * the previous one, so a connection can have two messages in flight; if the
   * first had to wait for its turn, the second could overtake it.
   */
  const chains = new Map();

  queue.enqueue = (handlerId, message, onData) => {
    const previous = chains.get(handlerId) ?? Promise.resolve();
    const current = previous.then(async () => {
      await acquire(handlerId);
      try {
        return await handleMessage(handlerId, message, onData);
      } finally {
        if (owner === handlerId && endsCycle(message[0]) && !db.isInTransaction()) release();
      }
    });
    const settled = current.catch(() => {});
    chains.set(handlerId, settled);
    settled.then(() => {
      if (chains.get(handlerId) === settled) chains.delete(handlerId);
    });
    return current;
  };

  queue.clearQueueForHandler = (handlerId) => {
    for (let i = waiting.length - 1; i >= 0; i -= 1) {
      if (waiting[i].handlerId === handlerId) waiting.splice(i, 1)[0].reject(new Error("Handler disconnected"));
    }
    failedCycles.delete(handlerId);
    const result = clearQueueForHandler(handlerId);
    // An open transaction is rolled back next (clearTransactionIfNeeded); the
    // turn is only given back once that has happened.
    if (owner === handlerId && !db.isInTransaction()) release();
    return result;
  };

  const clearTransactionIfNeeded = queue.clearTransactionIfNeeded.bind(queue);
  queue.clearTransactionIfNeeded = async (handlerId) => {
    await clearTransactionIfNeeded(handlerId);
    if (owner === handlerId && !db.isInTransaction()) release();
  };

  return server;
}
