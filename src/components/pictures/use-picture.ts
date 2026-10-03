"use client";

/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Asking for an AI picture and following it until it is ready.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import type { PictureResponse, PictureView } from "@/app/api/pictures/route";
import type { SceneStyle } from "@/lib/pictures/pictures";

/**
 * docs/adr/053. One picture at a time per studio: ask (`scene`, or `own` with
 * a photograph), then follow it every 1.5 s until it is done or failed. A
 * scene someone already made comes back done at once. Leaving the page stops
 * the following; the picture is still made and is there next time.
 */

export type PicturePhase = "idle" | "asking" | "making" | "done" | "failed" | "refused";

export type PictureState = {
  phase: PicturePhase;
  picture: PictureView | null;
  /** Why it was refused or failed, as the route says it. */
  reason: string | null;
  /** Pictures the shopper may still make today, when known. */
  left: number | null;
};

const FOLLOW_MS = 1500;
/** About two minutes: past that the page says something went wrong rather than wait for ever. */
const MAX_FOLLOWS = 80;

export function usePicture(initialLeft: number | null) {
  const [state, setState] = useState<PictureState>({ phase: "idle", picture: null, reason: null, left: initialLeft });
  const following = useRef(0);

  useEffect(() => () => void (following.current += 1), []);

  const follow = useCallback(async (picture: PictureView) => {
    const ticket = ++following.current;
    let current = picture;
    for (let step = 0; step < MAX_FOLLOWS && (current.status === "queued" || current.status === "running"); step += 1) {
      await new Promise((resolve) => setTimeout(resolve, FOLLOW_MS));
      if (ticket !== following.current) return;
      const response = await fetch(`/api/pictures?id=${current.id}`, { cache: "no-store" }).catch(() => null);
      const body = (await response?.json().catch(() => null)) as PictureResponse | null;
      if (body?.ok === true && "picture" in body) current = body.picture;
    }
    if (ticket !== following.current) return;
    setState((previous) => ({
      ...previous,
      phase: current.status === "done" ? "done" : "failed",
      picture: current,
      reason: current.status === "done" ? null : (current.reason ?? "timeout"),
    }));
  }, []);

  const handle = useCallback(
    async (request: Promise<Response>) => {
      setState((previous) => ({ ...previous, phase: "asking", reason: null }));
      const response = await request.catch(() => null);
      const body = (await response?.json().catch(() => null)) as PictureResponse | null;
      if (body === null || !body.ok || !("picture" in body)) {
        setState((previous) => ({ ...previous, phase: "refused", reason: body !== null && !body.ok ? body.reason : "generic" }));
        return;
      }
      const left = "left" in body ? body.left : null;
      setState((previous) => ({ ...previous, phase: body.picture.status === "done" ? "done" : "making", picture: body.picture, left: left ?? previous.left }));
      if (body.picture.status !== "done") await follow(body.picture);
    },
    [follow],
  );

  /** The piece in a showroom of one style. */
  const scene = useCallback(
    (productSlug: string, style: SceneStyle) =>
      handle(fetch("/api/pictures", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "scene", productSlug, style }) })),
    [handle],
  );

  /** The piece in the shopper's own room: `room` from the planner's picture (exact), `quick` from a photograph. */
  const own = useCallback(
    (productSlug: string, kind: "room" | "quick", file: Blob, consent: boolean) => {
      const form = new FormData();
      form.set("kind", kind);
      form.set("productSlug", productSlug);
      form.set("consent", consent ? "yes" : "no");
      form.set("file", file, kind === "room" ? "planner.jpg" : "room.jpg");
      return handle(fetch("/api/pictures", { method: "POST", body: form }));
    },
    [handle],
  );

  /** Shows a picture that is already made (a scene from the page), without asking for anything. */
  const show = useCallback((picture: PictureView) => {
    following.current += 1;
    setState((previous) => ({ ...previous, phase: "done", picture, reason: null }));
  }, []);

  const reset = useCallback(() => {
    following.current += 1;
    setState((previous) => ({ ...previous, phase: "idle", picture: null, reason: null }));
  }, []);

  return { state, scene, own, show, reset };
}
