"use client";

/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Reports consented product views and visible dwell time to the Taste Graph.
 */

import { useEffect } from "react";

import { ENGAGED_DWELL_SECONDS } from "@/lib/reco/graph";

/**
 * Tells the Taste Graph that a product page was seen, and for how long.
 *
 * Only with consent: the readable `vt_personalize` cookie must be set, and the
 * server independently refuses to record without the anonymous id. The dwell
 * time counts only while the tab is visible, and is sent once, when the page is
 * hidden or left, with `sendBeacon` so it survives navigation.
 *
 * The session id is random, kept in sessionStorage, and so ends with the tab —
 * the same notion of a session the behavioural edges use.
 */

export function consented(): boolean {
  return document.cookie.split("; ").includes("vt_personalize=1");
}

export function sessionId(): string {
  try {
    let id = sessionStorage.getItem("vt_sid");
    if (id === null) {
      id = crypto.randomUUID();
      sessionStorage.setItem("vt_sid", id);
    }
    return id;
  } catch {
    return "no-session-storage";
  }
}

function send(body: Record<string, unknown>, beacon = false): void {
  const payload = JSON.stringify(body);
  if (beacon && typeof navigator.sendBeacon === "function") {
    navigator.sendBeacon("/api/interactions", new Blob([payload], { type: "application/json" }));
    return;
  }
  void fetch("/api/interactions", { method: "POST", headers: { "content-type": "application/json" }, body: payload, keepalive: true }).catch(() => {});
}

export function TrackInterest({ productId }: { productId: string }) {
  useEffect(() => {
    if (!consented()) return;
    const session = sessionId();
    send({ productId, kind: "view", sessionId: session });

    let visibleSince: number | null = document.visibilityState === "visible" ? performance.now() : null;
    let visibleMs = 0;
    let sent = false;

    const flush = () => {
      if (visibleSince !== null) {
        visibleMs += performance.now() - visibleSince;
        visibleSince = null;
      }
      const seconds = Math.round(visibleMs / 1000);
      // Short glances say nothing; only engaged time is worth a request.
      if (!sent && seconds >= Math.min(10, ENGAGED_DWELL_SECONDS)) {
        sent = true;
        send({ productId, kind: "dwell", sessionId: session, dwellSeconds: Math.min(3600, seconds) }, true);
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
      else visibleSince = performance.now();
    };

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", flush);
    return () => {
      flush();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", flush);
    };
  }, [productId]);

  return null;
}
