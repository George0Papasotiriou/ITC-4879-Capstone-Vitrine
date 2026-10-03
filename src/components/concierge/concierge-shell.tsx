"use client";

/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * The Concierge's light shell on every page: whether it is open, and asking it something, before its engine has loaded.
 */

import dynamic from "next/dynamic";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

/**
 * docs/adr/034. The chat engine (the AI SDK, the Spotlight, the dock and its
 * parts) is most of the JavaScript a page would otherwise download, and most
 * visits never open the Concierge. So every page gets only this: the open
 * state the header, the bar and the shortcuts toggle, and an `ask` that
 * queues what the home page's prompt sends. The engine is fetched the first
 * time it is wanted — or a moment earlier, when a pointer or focus arrives
 * on something that opens it (`warm`) — and then stays mounted, so the
 * conversation survives navigation as before.
 */

/** `photoId`: a photograph the shopper attached, already through the photo route (docs/adr/051). */
export type AskOptions = { spoken?: boolean; photoId?: string };
type Ask = (text: string, options?: AskOptions) => void;
/** What a loaded engine hands the shell: its ask, and a way to start listening. */
export type EngineHandle = { ask: Ask; listen: () => void };

type ShellValue = {
  open: boolean;
  setOpen: (open: boolean) => void;
  ask: Ask;
  /** Opens the dock and starts listening, as the dock's own Speak button does (docs/adr/026). */
  listen: () => void;
  /** Starts fetching the engine without opening anything: for hover and focus on what opens it. */
  warm: () => void;
};

const ShellContext = createContext<ShellValue | null>(null);

export function useConciergeShell(): ShellValue {
  const value = useContext(ShellContext);
  if (value === null) throw new Error("useConciergeShell must be used inside <ConciergeShell>.");
  return value;
}

const loadEngine = () => import("@/components/concierge/concierge-engine");
const ConciergeEngine = dynamic(() => loadEngine().then((module) => module.ConciergeEngine), { ssr: false });

export function ConciergeShell({ children }: { children: ReactNode }) {
  const [open, setOpenState] = useState(false);
  const [wanted, setWanted] = useState(false);
  const engine = useRef<EngineHandle | null>(null);
  const queued = useRef<Parameters<Ask>[]>([]);
  const listenQueued = useRef(false);

  const setOpen = useCallback((next: boolean) => {
    if (next) setWanted(true);
    setOpenState(next);
  }, []);

  const ask = useCallback<Ask>((text, options) => {
    if (engine.current !== null) {
      engine.current.ask(text, options);
      return;
    }
    // Sent by the engine as soon as it has loaded.
    queued.current.push([text, options]);
    setWanted(true);
    setOpenState(true);
  }, []);

  const listen = useCallback(() => {
    if (engine.current !== null) {
      engine.current.listen();
      return;
    }
    listenQueued.current = true;
    setWanted(true);
    setOpenState(true);
  }, []);

  const attach = useCallback((handle: EngineHandle) => {
    engine.current = handle;
    for (const [text, options] of queued.current.splice(0)) handle.ask(text, options);
    if (listenQueued.current) {
      listenQueued.current = false;
      handle.listen();
    }
    return () => {
      if (engine.current === handle) engine.current = null;
    };
  }, []);

  const warm = useCallback(() => void loadEngine().catch(() => undefined), []);

  /**
   * Marks the document once the page has hydrated and the Concierge's controls
   * are live. Until then they are in the HTML but inert — rendered on the
   * server, their handlers attached later. Anything that needs to know the
   * difference (end-to-end tests today) waits for `html[data-concierge-ready]`;
   * the engine itself marks `html[data-concierge-engine]` when it has loaded.
   */
  useEffect(() => {
    document.documentElement.dataset["conciergeReady"] = "true";
    return () => {
      delete document.documentElement.dataset["conciergeReady"];
    };
  }, []);

  const value = useMemo<ShellValue>(() => ({ open, setOpen, ask, listen, warm }), [open, setOpen, ask, listen, warm]);
  return (
    <ShellContext.Provider value={value}>
      {children}
      {wanted ? <ConciergeEngine open={open} setOpen={setOpen} attach={attach} /> : null}
    </ShellContext.Provider>
  );
}
