"use client";

/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * One arrangement becoming another: pieces that stay glide to their new places, new ones rise in.
 */

import { useLayoutEffect, useRef, type ReactNode } from "react";

import { DURATION, EASE } from "@/lib/ui/motion";
import { prefersReducedMotion } from "@/lib/ui/use-reduced-motion";

/**
 * docs/adr/031. FLIP — First, Last, Invert, Play. After every change to the
 * items inside (children marked `data-flip-key`), each item that was there
 * before is measured where it now is, moved back by transform to where it
 * was, and let go: it glides to its new place. Items that are new rise in.
 *
 * Why not view transitions, which the tile-to-product morph uses: a listing's
 * new contents often arrive a moment after the click, in an update the view
 * transition does not cover, and then nothing would move. FLIP runs whenever
 * the new arrangement arrives. Transform and opacity only, measured relative
 * to the group, so scrolling in between changes nothing.
 */

type Place = { x: number; y: number; width: number; height: number };

/** On the spring; a browser that cannot animate with a `linear()` curve gets the standard one. */
function animate(element: HTMLElement, keyframes: Keyframe[], options: KeyframeAnimationOptions) {
  try {
    element.animate(keyframes, { ...options, easing: EASE.spring });
  } catch {
    element.animate(keyframes, { ...options, easing: EASE.standard });
  }
}

export function FlipGroup({ children, className, agentId }: { children: ReactNode; className?: string; agentId?: string }) {
  const group = useRef<HTMLDivElement>(null);
  const places = useRef(new Map<string, Place>());

  const measure = (): Map<string, { place: Place; element: HTMLElement }> => {
    const found = new Map<string, { place: Place; element: HTMLElement }>();
    const root = group.current;
    if (root === null) return found;
    const origin = root.getBoundingClientRect();
    for (const element of root.querySelectorAll<HTMLElement>("[data-flip-key]")) {
      const box = element.getBoundingClientRect();
      found.set(element.dataset.flipKey!, { element, place: { x: box.left - origin.left, y: box.top - origin.top, width: box.width, height: box.height } });
    }
    return found;
  };

  // After every commit: compare with where things were, play the difference, remember where they are.
  useLayoutEffect(() => {
    const now = measure();
    const before = places.current;
    const root = group.current;
    if (before.size > 0 && root !== null && !prefersReducedMotion()) {
      let moved = 0;
      for (const [key, { element, place }] of now) {
        const was = before.get(key);
        if (was === undefined) {
          animate(element, [{ opacity: 0, transform: "translateY(8px)" }, { opacity: 1, transform: "none" }], { duration: DURATION.calm, delay: DURATION.instant, fill: "backwards" });
          moved += 1;
          continue;
        }
        const dx = was.x - place.x;
        const dy = was.y - place.y;
        const sx = place.width > 0 ? was.width / place.width : 1;
        const sy = place.height > 0 ? was.height / place.height : 1;
        if (Math.abs(dx) < 1 && Math.abs(dy) < 1 && Math.abs(sx - 1) < 0.01 && Math.abs(sy - 1) < 0.01) continue;
        element.style.transformOrigin = "0 0";
        animate(element, [{ transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})` }, { transform: "none" }], { duration: DURATION.calm });
        moved += 1;
      }
      // For tests and the curious: how many rearrangements have played.
      if (moved > 0) root.dataset.flips = String(Number(root.dataset.flips ?? 0) + 1);
    }
    places.current = new Map([...now].map(([key, { place }]) => [key, place]));
  });

  // A resized window moves everything without a change of contents: remember the new places quietly.
  useLayoutEffect(() => {
    const root = group.current;
    if (root === null) return;
    const observer = new ResizeObserver(() => {
      places.current = new Map([...measure()].map(([key, { place }]) => [key, place]));
    });
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={group} className={className} data-agent-id={agentId}>
      {children}
    </div>
  );
}
