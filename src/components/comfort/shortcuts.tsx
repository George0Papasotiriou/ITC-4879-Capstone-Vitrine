"use client";

/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Keyboard shortcuts: one key to search, to the Concierge, to the numbers and to the comfort settings.
 */

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

import { openComfortPanel, useComfort } from "@/components/comfort/comfort-store";
import { requestNumbers } from "@/components/comfort/point-by-number";
import { useConcierge } from "@/components/concierge/concierge-provider";
import { useRouter } from "@/i18n/navigation";

// The list itself (a dialog) is loaded the first time it is asked for, not on every page.
const ShortcutsHelp = dynamic(() => import("@/components/comfort/shortcuts-help").then((module) => module.ShortcutsHelp), { ssr: false });

/**
 * docs/adr/032. Single keys, because a shortcut that needs three fingers is no
 * shortcut for someone using one. WCAG 2.1.4 asks that single-key shortcuts
 * can be switched off, so they can: in the comfort settings. They never fire
 * while someone is typing, and never with a modifier held, so they cannot
 * clash with the browser's or a screen reader's own keys.
 */

export const SHORTCUTS = [
  { key: "/", action: "search" },
  { key: "c", action: "concierge" },
  { key: "n", action: "numbers" },
  { key: "a", action: "comfort" },
  { key: "?", action: "help" },
] as const;

function typing(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || target.matches("input, textarea, select, [role='textbox'], [role='combobox']"));
}

/** Focuses the page's search field, or opens the search page and focuses it there. */
function focusSearch(go: () => void) {
  const field = document.querySelector<HTMLInputElement>("main input[type='search']");
  if (field !== null) {
    field.focus();
    return;
  }
  go();
  const started = Date.now();
  const wait = window.setInterval(() => {
    const arrived = document.querySelector<HTMLInputElement>("main input[type='search']");
    if (arrived !== null || Date.now() - started > 4_000) window.clearInterval(wait);
    arrived?.focus();
  }, 100);
}

export function Shortcuts() {
  const comfort = useComfort();
  const { open, setOpen } = useConcierge();
  const router = useRouter();
  const [help, setHelp] = useState(false);

  useEffect(() => {
    if (comfort.shortcuts !== "on") return;
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
      // Not while a dialog is open (one still leaving does not count).
      if (typing(event.target) || document.querySelector("[role='dialog'][data-state='open']") !== null) return;
      switch (event.key) {
        case "/":
          event.preventDefault();
          focusSearch(() => router.push("/search"));
          break;
        case "c":
          event.preventDefault();
          setOpen(!open);
          break;
        case "n":
          event.preventDefault();
          requestNumbers({ show: "toggle" });
          break;
        case "a":
          event.preventDefault();
          openComfortPanel();
          break;
        case "?":
          event.preventDefault();
          setHelp(true);
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [comfort.shortcuts, open, router, setOpen]);

  return help ? <ShortcutsHelp onClose={() => setHelp(false)} /> : null;
}
