"use client";

/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Spotlight: visibly plays Concierge UI commands, announces them and records undo steps.
 */

import { AnimatePresence, motion } from "motion/react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import type { UiCommand } from "@/lib/ai/ui-commands";
import { usePrefersReducedMotion } from "@/lib/ui/use-reduced-motion";

/**
 * The Spotlight (docs/PLAN.md 4.5, 2.5)
 *
 * The signature interaction. When the Concierge acts, a warm light travels from
 * the dock to whatever it is about to touch, names what it is doing in plain
 * words, performs the action, and leaves an undoable entry behind.
 *
 * Why it exists: an agent that changes the interface without showing you is
 * unsettling, and an agent you cannot correct is worse. The light answers "what
 * just happened and where", and the timeline answers "how do I take it back".
 * Everything the Concierge does is therefore visible and reversible — which is
 * what makes letting it drive acceptable at all (product principle 2).
 *
 * The whole sequence is decoration over a plain state change: with reduced
 * motion, or with JavaScript animation disabled, the action still runs, the
 * caption is still announced, and undo still works.
 */

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

/** What an executor returns so the action can be taken back. */
export type Undo = {
  /** Shown next to the entry: "Filtered to oak". */
  label: string;
  run: () => void | Promise<void>;
};

/**
 * How a command is actually performed. Executors are supplied per page,
 * because "set the filters" means something different on a listing than in the
 * Concierge dock. An executor returns an Undo, or nothing when the command
 * changed no state (highlighting is purely visual).
 */
export type CommandExecutor = (command: UiCommand) => Promise<Undo | void> | Undo | void;

export type Executors = Partial<Record<UiCommand["type"], CommandExecutor>>;

export type TimelineEntry = {
  id: string;
  caption: string;
  type: UiCommand["type"];
  at: number;
  undo?: Undo;
  undone: boolean;
};

type Phase = "idle" | "dimming" | "travelling" | "arrived" | "running" | "settling";

type Point = { x: number; y: number };

type SpotlightValue = {
  run: (commands: UiCommand[]) => Promise<void>;
  stop: () => void;
  skip: () => void;
  undo: (entryId: string) => Promise<void>;
  timeline: TimelineEntry[];
  clearTimeline: () => void;
  phase: Phase;
  isBusy: boolean;
  /** Present while the Concierge is acting: the caption being shown. */
  caption: string | null;
};

const SpotlightContext = createContext<SpotlightValue | null>(null);

export function useSpotlight(): SpotlightValue {
  const value = useContext(SpotlightContext);
  if (value === null) {
    throw new Error("useSpotlight must be used inside <SpotlightProvider>.");
  }
  return value;
}

/* -------------------------------------------------------------------------- */
/* Timing (docs/PLAN.md 4.5)                                                  */
/* -------------------------------------------------------------------------- */

const TIMING = {
  /** Page dims before the light sets off, so the eye is ready for it. */
  dim: 120,
  /** Glide from the dock to the target. */
  travel: 480,
  /** The target is outlined and named before anything changes. */
  dwellBeforeAction: 180,
  /** The result is left visible before the light lets go. */
  holdAfterAction: 900,
  /** The glow fades slowly rather than snapping off. */
  fade: 1200,
} as const;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/* -------------------------------------------------------------------------- */
/* Target geometry                                                            */
/* -------------------------------------------------------------------------- */

type TargetRect = { top: number; left: number; width: number; height: number };

/**
 * Finds the element a command points at. `agentId` is validated upstream to
 * `kind:id` with no quotes or brackets, so it cannot break out of the attribute
 * selector (see ui-commands.test.ts).
 */
function findTarget(agentId: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-agent-id="${agentId}"]`);
}

function rectOf(element: HTMLElement): TargetRect {
  const r = element.getBoundingClientRect();
  return { top: r.top, left: r.left, width: r.width, height: r.height };
}

function centreOf(rect: TargetRect): Point {
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

/** Where the light sets off from: the dock, or the bottom-right corner. */
function sourcePoint(): Point {
  const dock = document.querySelector<HTMLElement>("[data-spotlight-source]");
  if (dock !== null) return centreOf(rectOf(dock));
  return { x: window.innerWidth - 64, y: window.innerHeight - 64 };
}

function agentIdOf(command: UiCommand): string | null {
  return "agentId" in command ? command.agentId : null;
}

/* -------------------------------------------------------------------------- */
/* Provider                                                                   */
/* -------------------------------------------------------------------------- */

export function SpotlightProvider({
  children,
  executors,
}: {
  children: ReactNode;
  executors?: Executors;
}) {
  const router = useRouter();
  const prefersReducedMotion = usePrefersReducedMotion();
  // Announcements are spoken by screen readers, so they are localised like any
  // other visible string; a Greek storefront must not announce in English.
  const t = useTranslations("concierge");

  const [phase, setPhase] = useState<Phase>("idle");
  const [caption, setCaption] = useState<string | null>(null);
  const [target, setTarget] = useState<TargetRect | null>(null);
  const [orb, setOrb] = useState<{ from: Point; to: Point } | null>(null);
  const [timeline, setTimeline] = useState<TimelineEntry[]>([]);
  const [announcement, setAnnouncement] = useState("");

  /** Set by Stop; checked between commands so a queue halts promptly. */
  const stopped = useRef(false);
  /** Set by Esc; collapses the current command's animation to its end state. */
  const skipped = useRef(false);
  const busy = useRef(false);

  const stop = useCallback(() => {
    stopped.current = true;
    skipped.current = true;
  }, []);

  const skip = useCallback(() => {
    skipped.current = true;
  }, []);

  /**
   * Marks the document once the command bus is live.
   *
   * Until this provider hydrates, the Concierge's controls are present in the
   * HTML but inert — they render server-side and their handlers attach later.
   * Anything that needs to know the difference (end-to-end tests today, and a
   * dock that should not invite a click it will drop) can wait for
   * `html[data-concierge-ready]`.
   */
  useEffect(() => {
    document.documentElement.dataset["conciergeReady"] = "true";
    return () => {
      delete document.documentElement.dataset["conciergeReady"];
    };
  }, []);

  /** Esc skips the current step; it never cancels the action itself, because a
   *  half-applied filter would be worse than a fast one. */
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && busy.current) skip();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [skip]);

  /** Manual interaction pauses the Concierge (docs/PLAN.md 2.5). */
  useEffect(() => {
    function onPointerDown() {
      if (busy.current) stop();
    }
    window.addEventListener("pointerdown", onPointerDown, { capture: true });
    return () =>
      window.removeEventListener("pointerdown", onPointerDown, { capture: true });
  }, [stop]);

  const defaultExecutors = useMemo<Executors>(
    () => ({
      navigate: (command) => {
        if (command.type !== "navigate") return;
        router.push(command.href);
      },
      // Highlighting and scrolling change no state, so they record no undo.
      highlight: () => undefined,
      scroll_to: (command) => {
        const id = agentIdOf(command);
        if (id === null) return;
        findTarget(id)?.scrollIntoView({
          behavior: prefersReducedMotion ? "auto" : "smooth",
          block: "center",
        });
      },
    }),
    [router, prefersReducedMotion],
  );

  /**
   * Executors are read through a ref rather than captured in a closure. A
   * sequence runs several commands in one loop, and the first of them usually
   * changes the state the next one needs to read — capturing would hand command
   * two the state from before command one ran, and its undo would restore the
   * wrong thing.
   */
  const executorsRef = useRef<Executors | undefined>(executors);
  useEffect(() => {
    executorsRef.current = executors;
  }, [executors]);

  const runOne = useCallback(
    async (command: UiCommand): Promise<void> => {
      skipped.current = false;
      setCaption(command.caption);
      // Announced as soon as the Concierge commits to the action, so a screen
      // reader user hears it at the same moment a sighted user sees the light.
      setAnnouncement(command.caption);

      const agentId = agentIdOf(command);
      const element = agentId === null ? null : findTarget(agentId);
      const rect = element === null ? null : rectOf(element);

      // Dim first, then travel. With reduced motion there is no travel at all:
      // the outline and caption appear at once (4.5).
      setTarget(rect);
      setPhase("dimming");
      if (!prefersReducedMotion && !skipped.current) await sleep(TIMING.dim);

      if (rect !== null && !prefersReducedMotion && !skipped.current) {
        setOrb({ from: sourcePoint(), to: centreOf(rect) });
        setPhase("travelling");
        await sleep(TIMING.travel);
      }

      setOrb(null);
      setPhase("arrived");
      if (!prefersReducedMotion && !skipped.current) {
        await sleep(TIMING.dwellBeforeAction);
      }

      setPhase("running");
      const executor =
        executorsRef.current?.[command.type] ?? defaultExecutors[command.type];
      let undo: Undo | undefined;

      try {
        const result = await executor?.(command);
        if (result != null) undo = result;
      } catch (error) {
        setAnnouncement(t("announceFailed", { caption: command.caption }));
        // An executor that throws must not strand the overlay on screen.
        setPhase("idle");
        setTarget(null);
        setCaption(null);
        throw error;
      }

      setTimeline((entries) => [
        ...entries,
        {
          id: `${Date.now()}-${entries.length}`,
          caption: command.caption,
          type: command.type,
          at: Date.now(),
          undo,
          undone: false,
        },
      ]);

      if (undo !== undefined) {
        setAnnouncement(t("announceUndoable", { caption: command.caption }));
      }

      setPhase("settling");
      if (!skipped.current) {
        await sleep(prefersReducedMotion ? 0 : TIMING.holdAfterAction);
      }
    },
    [defaultExecutors, prefersReducedMotion, t],
  );

  const run = useCallback(
    async (commands: UiCommand[]): Promise<void> => {
      if (busy.current) return;
      busy.current = true;
      stopped.current = false;

      try {
        for (const command of commands) {
          if (stopped.current) break;
          await runOne(command);
        }
      } finally {
        busy.current = false;
        setPhase("idle");
        setTarget(null);
        setOrb(null);
        setCaption(null);
      }
    },
    [runOne],
  );

  /** Mirrors the timeline so `undo` can read it without being re-created on
   *  every entry, which would re-render every timeline row. */
  const timelineRef = useRef<TimelineEntry[]>([]);
  useEffect(() => {
    timelineRef.current = timeline;
  }, [timeline]);

  const undo = useCallback(async (entryId: string): Promise<void> => {
    const entry = timelineRef.current.find((candidate) => candidate.id === entryId);
    if (entry === undefined || entry.undone || entry.undo === undefined) return;

    await entry.undo.run();

    setTimeline((entries) =>
      entries.map((candidate) =>
        candidate.id === entryId ? { ...candidate, undone: true } : candidate,
      ),
    );
    setAnnouncement(t("announceUndone", { caption: entry.caption }));
  }, [t]);

  const clearTimeline = useCallback(() => setTimeline([]), []);

  const value = useMemo<SpotlightValue>(
    () => ({
      run,
      stop,
      skip,
      undo,
      timeline,
      clearTimeline,
      phase,
      isBusy: phase !== "idle",
      caption,
    }),
    [run, stop, skip, undo, timeline, clearTimeline, phase, caption],
  );

  return (
    <SpotlightContext.Provider value={value}>
      {children}
      <SpotlightOverlay
        phase={phase}
        target={target}
        orb={orb}
        caption={caption}
        reducedMotion={prefersReducedMotion}
      />
      {/* Every action is announced here. The timeline below the dock is the
          visual equivalent; neither is a substitute for the other. */}
      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {announcement}
      </div>
    </SpotlightContext.Provider>
  );
}

/* -------------------------------------------------------------------------- */
/* Overlay                                                                    */
/* -------------------------------------------------------------------------- */

function SpotlightOverlay({
  phase,
  target,
  orb,
  caption,
  reducedMotion,
}: {
  phase: Phase;
  target: TargetRect | null;
  orb: { from: Point; to: Point } | null;
  caption: string | null;
  reducedMotion: boolean;
}) {
  const dimming = phase !== "idle";
  const ringVisible = target !== null && (phase === "arrived" || phase === "running" || phase === "settling");

  return (
    <div className="pointer-events-none fixed inset-0 z-50" aria-hidden="true">
      {/* Dim without a target: a plain veil. */}
      <AnimatePresence>
        {dimming && target === null ? (
          <motion.div
            key="veil"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: TIMING.dim / 1000 }}
            className="bg-dusk/[0.08] absolute inset-0"
          />
        ) : null}
      </AnimatePresence>

      {/* The ring dims the page and outlines the target in one element: a very
          large box-shadow spread darkens everything outside it, so there is no
          four-panel overlay to keep in sync and nothing for the compositor to
          re-layout. */}
      <AnimatePresence>
        {target !== null && dimming ? (
          <motion.div
            key="ring"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{
              duration: (phase === "settling" ? TIMING.fade : TIMING.dim) / 1000,
            }}
            style={{
              top: target.top - 6,
              left: target.left - 6,
              width: target.width + 12,
              height: target.height + 12,
              boxShadow: [
                "0 0 0 9999px color-mix(in oklab, var(--color-dusk) 8%, transparent)",
                ringVisible
                  ? "0 0 0 2px var(--color-dusk), 0 0 28px 6px var(--color-lumen-glow)"
                  : null,
              ]
                .filter((shadow) => shadow !== null)
                .join(", "),
            }}
            className="rounded-plinth absolute"
          />
        ) : null}
      </AnimatePresence>

      {/* The travelling light. x and y are sprung separately and at slightly
          different stiffness, which bends the path into the shallow arc the
          design calls for without hand-authoring a curve. */}
      <AnimatePresence>
        {orb !== null && !reducedMotion ? (
          <motion.div
            key="orb"
            initial={{ x: orb.from.x, opacity: 0 }}
            animate={{ x: orb.to.x, opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ type: "spring", stiffness: 170, damping: 26 }}
            className="absolute top-0 left-0"
          >
            <motion.div
              initial={{ y: orb.from.y, scale: 0.5 }}
              animate={{ y: orb.to.y, scale: 1 }}
              transition={{ type: "spring", stiffness: 210, damping: 22 }}
            >
              <div
                className="bg-lumen -translate-x-1/2 -translate-y-1/2 rounded-full"
                style={{ width: 160, height: 160, filter: "blur(44px)", opacity: 0.75 }}
              />
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {/* The caption names the action in plain words, positioned under the
          target unless that would fall off the bottom of the screen. */}
      <AnimatePresence>
        {caption !== null && target !== null && ringVisible ? (
          <motion.div
            key="caption"
            initial={{ opacity: 0, y: reducedMotion ? 0 : -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16 }}
            style={{
              top:
                target.top + target.height + 44 > window.innerHeight
                  ? target.top - 40
                  : target.top + target.height + 12,
              left: Math.max(12, Math.min(target.left, window.innerWidth - 260)),
            }}
            className="bg-dusk text-glass rounded-plinth absolute px-3 py-1.5 text-sm"
          >
            <span className="bg-lumen mr-2 inline-block size-1.5 rounded-full align-middle" />
            {caption}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
