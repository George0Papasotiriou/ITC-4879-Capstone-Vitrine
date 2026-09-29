/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * An order's changes as they happen, as Server-Sent Events, for the page showing it.
 */

import { z } from "zod";

import { accessibleOrder } from "@/lib/commerce/server";
import { subscribeOrder } from "@/lib/kv/live";

/**
 * docs/adr/039. Only for someone who may see the order (its link token as
 * `?token=`, or the signed-in owner). Each message is the new status; the page
 * then refreshes and reads the rest itself. A comment every 25 seconds keeps
 * proxies from closing a quiet stream, and the stream ends after ten minutes —
 * the browser's EventSource reconnects on its own if the page is still open.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KEEP_ALIVE_MS = 25_000;
const MAX_OPEN_MS = 10 * 60_000;

export async function GET(request: Request, { params }: RouteContext<"/api/orders/[id]/live">): Promise<Response> {
  const { id } = await params;
  const token = new URL(request.url).searchParams.get("token");
  if (!z.uuid().safeParse(id).success || (token !== null && !z.string().min(16).max(128).safeParse(token).success)) {
    return new Response("Bad request", { status: 400 });
  }
  const access = await accessibleOrder(id, token);
  if (access === null) return new Response("Not found", { status: 404 });

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
      send(`event: ready\ndata: ${JSON.stringify({ status: access.order.status })}\n\n`);
      const unsubscribe = await subscribeOrder(id, (change) => send(`event: order\ndata: ${JSON.stringify({ status: change.status })}\n\n`));
      const beat = setInterval(() => send(": still here\n\n"), KEEP_ALIVE_MS);
      const limit = setTimeout(() => stop(), MAX_OPEN_MS);
      stop = () => {
        clearInterval(beat);
        clearTimeout(limit);
        unsubscribe();
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
