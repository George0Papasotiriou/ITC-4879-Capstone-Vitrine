"use client";

/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * The reading guide: a clear band that follows the pointer or the focus, with the page dimmed above and below it.
 */

import { useEffect, useRef } from "react";

import { useComfort } from "@/components/comfort/comfort-store";

/**
 * docs/adr/032. A reading ruler, as people with dyslexia or low vision use on
 * paper: the line being read stays clear, everything above and below is
 * dimmed, so the eye does not slip to the next line. It follows the pointer,
 * and the keyboard focus for someone who does not use one. Two fixed bands
 * moved with transform only: nothing in the page lays out again.
 */
export function ReadingGuide() {
  const comfort = useComfort();
  return comfort.guide === "on" ? <Guide /> : null;
}

function Guide() {
  const above = useRef<HTMLDivElement>(null);
  const below = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let frame = 0;
    let y = window.innerHeight / 3;
    const place = () => {
      // The clear band is about three lines tall at the current text size.
      const band = parseFloat(getComputedStyle(document.documentElement).fontSize) * 4.2;
      if (above.current !== null) above.current.style.transform = `translateY(${y - band / 2 - window.innerHeight}px)`;
      if (below.current !== null) below.current.style.transform = `translateY(${y + band / 2}px)`;
    };
    const moveTo = (next: number) => {
      y = next;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(place);
    };
    const onPointer = (event: PointerEvent) => moveTo(event.clientY);
    const onFocus = (event: FocusEvent) => {
      if (!(event.target instanceof HTMLElement)) return;
      const box = event.target.getBoundingClientRect();
      moveTo(box.top + box.height / 2);
    };
    place();
    window.addEventListener("pointermove", onPointer, { passive: true });
    window.addEventListener("focusin", onFocus);
    window.addEventListener("resize", place);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", onPointer);
      window.removeEventListener("focusin", onFocus);
      window.removeEventListener("resize", place);
    };
  }, []);

  return (
    <div aria-hidden="true" data-agent-id="comfort:guide">
      <div ref={above} className="reading-guide-band top-0 h-dvh" />
      <div ref={below} className="reading-guide-band top-0 h-dvh" />
    </div>
  );
}
