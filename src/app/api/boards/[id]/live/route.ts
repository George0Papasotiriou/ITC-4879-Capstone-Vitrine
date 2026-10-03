/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * A room board as it changes, and how many people have it open, as Server-Sent Events.
 */

import { randomUUID } from "node:crypto";

import { z } from "zod";

import { currentUser } from "@/lib/auth/session";
import { boardAccess } from "@/lib/boards/server";
import { publishBoard, subscribeBoard } from "@/lib/kv/live";

/**
 * docs/adr/056, after the live order (docs/adr/039). Anyone with a link may
 * follow along. "changed" tells the page to read the board again with its own
 * rights; "presence" is how many people have it open. Each stream says "here"
 * on the board's channel when it opens and every twenty seconds, and "left"
 * when it closes; it counts every page heard from in the last 45 seconds —
 * across processes, since the channel is Redis's in production. The stream
 * ends after ten minutes and the browser opens a new one.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HERE_EVERY_MS = 20_000;
const GONE_AFTER_MS = 45_000;
const MAX_OPEN_MS = 10 * 60_000;

export async function GET(request: Request, { params }: RouteContext<"/api/boards/[id]/live">): Promise<Response> {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return new Response("Bad request", { status: 400 });
  const found = await boardAccess(id, new URL(request.url).searchParams.get("k"), await currentUser());
  if (found === null) return new Response("Not found", { status: 404 });

  const me = randomUUID();
  const seen = new Map<string, number>([[me, Date.now()]]);
  const encoder = new TextEncoder();
  let stop = () => {};
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (text: string) => {
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          stop();
        }
      };
      let told = 0;
      const tellPresence = () => {
        const now = Date.now();
        for (const [viewer, at] of seen) if (now - at > GONE_AFTER_MS) seen.delete(viewer);
        if (seen.size !== told) {
          told = seen.size;
          send(`event: presence\ndata: ${JSON.stringify({ count: told })}\n\n`);
        }
      };
      send(`event: ready\ndata: {}\n\n`);
      const unsubscribe = await subscribeBoard(id, (message) => {
        if (message.type === "changed") send(`event: changed\ndata: {}\n\n`);
        else if (message.type === "here") {
          const isNew = !seen.has(message.viewer);
          seen.set(message.viewer, Date.now());
          // A newcomer is answered at once, so they count everyone already here without waiting for the beat.
          if (isNew && message.viewer !== me) void publishBoard(id, { type: "here", viewer: me });
          tellPresence();
        } else {
          seen.delete(message.viewer);
          tellPresence();
        }
      });
      await publishBoard(id, { type: "here", viewer: me });
      tellPresence();
      const beat = setInterval(() => {
        void publishBoard(id, { type: "here", viewer: me });
        send(": still here\n\n");
        tellPresence();
      }, HERE_EVERY_MS);
      const limit = setTimeout(() => stop(), MAX_OPEN_MS);
      stop = () => {
        clearInterval(beat);
        clearTimeout(limit);
        unsubscribe();
        void publishBoard(id, { type: "left", viewer: me });
        try {
          controller.close();
        } catch {
          // Already closed by the browser.
        }
        stop = () => {};
      };
      request.signal.addEventListener("abort", () => stop());
    },
    cancel() {
      stop();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
