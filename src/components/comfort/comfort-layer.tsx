"use client";

/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Everything the comfort settings add to every page, mounted once in the layout.
 */

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

import { applyComfort, COMFORT_OPEN_EVENT, currentComfort, syncComfort, SYNCED_KEY } from "@/components/comfort/comfort-store";
import { PointByNumber } from "@/components/comfort/point-by-number";
import { ReadingGuide } from "@/components/comfort/reading-guide";
import { Shortcuts } from "@/components/comfort/shortcuts";

// The panel is loaded the first time someone asks for it, not with every page.
const ComfortPanel = dynamic(() => import("@/components/comfort/comfort-panel").then((module) => module.ComfortPanel), { ssr: false });

/**
 * docs/adr/032. The panel, the reading guide, the numbers and the shortcuts.
 * The attributes are applied once more after hydration, in case the page was
 * restored from the browser's back-forward cache with older ones.
 */
export function ComfortLayer() {
  const [panel, setPanel] = useState(false);

  // Until the panel has loaded, the first request to open it loads it open; from then on it listens itself.
  useEffect(() => {
    if (panel) return;
    const onOpen = () => setPanel(true);
    window.addEventListener(COMFORT_OPEN_EVENT, onOpen);
    return () => window.removeEventListener(COMFORT_OPEN_EVENT, onOpen);
  }, [panel]);

  useEffect(() => {
    applyComfort(currentComfort());
    // Once per browser session: a signed-in shopper's device and account meet (docs/adr/033).
    try {
      if (window.sessionStorage.getItem(SYNCED_KEY) === null) {
        window.sessionStorage.setItem(SYNCED_KEY, "1");
        void syncComfort();
      }
    } catch {
      // Without session storage the sync waits for the next sign-in or change.
    }
    const onShow = (event: PageTransitionEvent) => {
      if (event.persisted) applyComfort(currentComfort());
    };
    window.addEventListener("pageshow", onShow);
    return () => window.removeEventListener("pageshow", onShow);
  }, []);

  return (
    <>
      {panel ? <ComfortPanel startOpen /> : null}
      <ReadingGuide />
      <PointByNumber />
      <Shortcuts />
    </>
  );
}
