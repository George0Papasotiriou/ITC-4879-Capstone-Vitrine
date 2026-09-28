"use client";

/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Loads the instant search pop-up the first time it is asked for, and opens it.
 */

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";

import { openInstantSearch, SEARCH_OPEN_EVENT, type SearchOpenDetail } from "@/components/search/search-events";

// Not in every page's first download: fetched on the first request to search.
const InstantSearch = dynamic(() => import("@/components/search/instant-search").then((module) => module.InstantSearch), { ssr: false });

/** docs/adr/034. */
export function InstantSearchLayer() {
  const [open, setOpen] = useState<{ query: string } | null>(null);
  // Where focus was when the pop-up opened: the header link, or wherever "/" was pressed.
  const returnTo = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const onOpen = (event: Event) => {
      const detail = (event as CustomEvent<SearchOpenDetail>).detail;
      returnTo.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setOpen({ query: detail?.query ?? "" });
    };
    window.addEventListener(SEARCH_OPEN_EVENT, onOpen);
    return () => window.removeEventListener(SEARCH_OPEN_EVENT, onOpen);
  }, []);

  const close = () => {
    setOpen(null);
    // The dialog was opened without a trigger of its own, so focus is put back by hand, after it has gone.
    const target = returnTo.current;
    window.requestAnimationFrame(() => {
      if (target?.isConnected === true && (document.activeElement === null || document.activeElement === document.body)) target.focus();
    });
  };

  return open === null ? null : <InstantSearch initialQuery={open.query} onClose={close} />;
}

/**
 * Wraps the header's search link: a plain click opens the pop-up instead of
 * the page, while a click with a modifier (a new tab, a new window) and every
 * visit without JavaScript still follow the link to /search.
 */
export function InstantSearchTrigger({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="contents"
      onClickCapture={(event) => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        openInstantSearch();
      }}
    >
      {children}
    </span>
  );
}
