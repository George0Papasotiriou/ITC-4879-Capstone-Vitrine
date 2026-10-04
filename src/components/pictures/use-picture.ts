"use client";

/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Asking for an AI picture and following it until it is ready, even across a visit to another page.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import type { PictureResponse, PictureView } from "@/app/api/pictures/route";
import type { SceneStyle } from "@/lib/pictures/pictures";

/**
 * docs/adr/053, docs/adr/060. One picture at a time per studio: ask (`scene`,
 * `own` with a photograph, or `again` in a room the shopper already gave),
 * then follow it every two seconds until it is done or failed. A scene
 * someone already made comes back done at once.
 *
 * A picture now takes up to a few minutes (the model thinks, and a picture
 * the check sends back is made again), so the shopper may leave and come
 * back: the picture being made is remembered for this tab (session storage,
 * never the address), and following resumes when the studio opens again.
 */

export type PicturePhase = "idle" | "asking" | "making" | "done" | "failed" | "refused";

export type PictureState = {
  phase: PicturePhase;
  picture: PictureView | null;
  /** Why it was refused or failed, as the route says it. */
  reason: string | null;
  /** Pictures the shopper may still make today, when known. */
  left: number | null;
  /** When the current wait began, for the stage's words. */
  since: number | null;
};

const FOLLOW_MS = 2000;
/** Six minutes: past that the page says something went wrong rather than wait for ever. */
const MAX_FOLLOWS = 180;
const PENDING_KEY = "vt_picture_pending";

/** The picture being made in this tab, by the piece it is for. */
function readPending(): Record<string, string> {
  try {
    const value = JSON.parse(window.sessionStorage.getItem(PENDING_KEY) ?? "{}") as unknown;
    return typeof value === "object" && value !== null ? (value as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function writePending(slug: string, id: string | null) {
  try {
    const pending = readPending();
    if (id === null) delete pending[slug];
    else pending[slug] = id;
    window.sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending));
  } catch {
    // Without session storage the picture is still made; it is simply not resumed.
  }
}

async function fetchPicture(id: string): Promise<PictureView | null> {
  const response = await fetch(`/api/pictures?id=${id}`, { cache: "no-store" }).catch(() => null);
  const body = (await response?.json().catch(() => null)) as PictureResponse | null;
  return body?.ok === true && "picture" in body ? body.picture : null;
}

const post = (body: unknown) => fetch("/api/pictures", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

export function usePicture(initialLeft: number | null, options: { resume?: string } = {}) {
  const [state, setState] = useState<PictureState>({ phase: "idle", picture: null, reason: null, left: initialLeft, since: null });
  const following = useRef(0);

  useEffect(() => () => void (following.current += 1), []);

  const follow = useCallback(async (picture: PictureView, slug: string | null) => {
    const ticket = ++following.current;
    let current = picture;
    for (let step = 0; step < MAX_FOLLOWS && (current.status === "queued" || current.status === "running"); step += 1) {
      await new Promise((resolve) => setTimeout(resolve, FOLLOW_MS));
      if (ticket !== following.current) return;
      current = (await fetchPicture(current.id)) ?? current;
    }
    if (ticket !== following.current) return;
    if (slug !== null && (current.status === "done" || current.status === "failed")) writePending(slug, null);
    setState((previous) => ({
      ...previous,
      phase: current.status === "done" ? "done" : "failed",
      picture: current,
      reason: current.status === "done" ? null : (current.reason ?? "timeout"),
      since: null,
    }));
  }, []);

  // A picture this tab asked for and left before it was ready: followed again.
  const resumeSlug = options.resume;
  useEffect(() => {
    if (resumeSlug === undefined) return;
    const id = readPending()[resumeSlug];
    if (id === undefined) return;
    let alive = true;
    void fetchPicture(id).then((picture) => {
      if (!alive) return;
      if (picture === null) return writePending(resumeSlug, null);
      setState((previous) => ({ ...previous, phase: picture.status === "done" ? "done" : picture.status === "failed" ? "failed" : "making", picture, reason: picture.status === "failed" ? picture.reason : null, since: Date.now() }));
      if (picture.status === "queued" || picture.status === "running") void follow(picture, resumeSlug);
      else writePending(resumeSlug, null);
    });
    return () => void (alive = false);
  }, [resumeSlug, follow]);

  const handle = useCallback(
    async (slug: string, request: Promise<Response>) => {
      following.current += 1;
      setState((previous) => ({ ...previous, phase: "asking", reason: null, since: Date.now() }));
      const response = await request.catch(() => null);
      const body = (await response?.json().catch(() => null)) as PictureResponse | null;
      if (body === null || !body.ok || !("picture" in body)) {
        setState((previous) => ({ ...previous, phase: "refused", reason: body !== null && !body.ok ? body.reason : "generic", since: null }));
        return;
      }
      const left = "left" in body ? body.left : null;
      const done = body.picture.status === "done";
      setState((previous) => ({ ...previous, phase: done ? "done" : "making", picture: body.picture, left: left ?? previous.left, since: done ? null : previous.since }));
      if (!done) {
        writePending(slug, body.picture.id);
        await follow(body.picture, slug);
      }
    },
    [follow],
  );

  /** The piece in a showroom of one style. */
  const scene = useCallback((productSlug: string, style: SceneStyle) => handle(productSlug, post({ kind: "scene", productSlug, style })), [handle]);

  /** The piece in the shopper's own room: `room` from the planner's picture (exact), `quick` from a photograph. */
  const own = useCallback(
    (productSlug: string, kind: "room" | "quick", file: Blob, consent: boolean) => {
      const form = new FormData();
      form.set("kind", kind);
      form.set("productSlug", productSlug);
      form.set("consent", consent ? "yes" : "no");
      form.set("file", file, kind === "room" ? "planner.jpg" : "room.jpg");
      return handle(productSlug, fetch("/api/pictures", { method: "POST", body: form }));
    },
    [handle],
  );

  /** The piece in a room photograph the shopper already gave the shop, and still has: no new upload, no new consent. */
  const again = useCallback((productSlug: string, uploadId: string) => handle(productSlug, post({ kind: "quick", productSlug, uploadId })), [handle]);

  /** Shows a picture that is already made (a scene from the page, or one from this visit), without asking for anything. */
  const show = useCallback((picture: PictureView) => {
    following.current += 1;
    setState((previous) => ({ ...previous, phase: "done", picture, reason: null, since: null }));
  }, []);

  const reset = useCallback(() => {
    following.current += 1;
    setState((previous) => ({ ...previous, phase: "idle", picture: null, reason: null, since: null }));
  }, []);

  return { state, scene, own, again, show, reset };
}
