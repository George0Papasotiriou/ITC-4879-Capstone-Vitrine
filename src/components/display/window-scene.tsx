"use client";

/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * The shop window on the page: the 3D room, a real button over every piece, the placard, and the 2D window where 3D cannot run.
 */

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent } from "react";

import { DisplayStage, type StageItem } from "@/components/display/display-stage";
import { Placard, type PlacardPiece } from "@/components/display/placard";
import { MOODS, type MoodId } from "@/lib/display/moods";
import type { TemplateId } from "@/lib/optimize/templates";
import { cn } from "@/lib/ui/cn";
import { usePrefersReducedMotion } from "@/lib/ui/use-reduced-motion";

import type { Hotspot, WindowEngine } from "./engine";

/**
 * docs/adr/048.
 *
 * THE ENGINE OUTLIVES THE PAGE. Choosing another window is a navigation, and
 * the page around the window is rendered afresh (src/app/[locale]/template.tsx
 * mounts pages anew). The 3D room should not be: so the engine and its canvas
 * are kept for a few seconds after the window unmounts, and the next window
 * adopts them — the same room, re-dressed, the light easing to the new hour.
 * Leave the page and they are released.
 *
 * EVERY PIECE IS A BUTTON. The canvas is a picture to assistive technology;
 * over it, each piece has a real, focusable button laid on its projected
 * outline (moved every frame the camera moves, by writing styles directly —
 * no React render per frame). Arrow keys walk the pieces, Enter or a click
 * opens its placard and brings the camera to it, Escape goes back. The list
 * of pieces in words below the window says the same, for screen readers.
 *
 * WHERE 3D CANNOT RUN — no WebGL 2, Save-Data, or a lost context — the 2D
 * window (display-stage.tsx) is shown, with a note.
 */

export type WindowPiece = {
  id: string;
  label: string;
  role: string | null;
  kind: string;
  quantity: number;
  model: string | null;
  /** The photograph through the shop's image optimizer, for rugs, pictures and cut-outs. */
  photo: string | null;
  dims: { x: number; y: number; z: number } | null;
  placard: PlacardPiece;
  stage: StageItem;
};

/** The hours a shopper can choose, in the order of a day. */
const LIGHTS = ["dawn", "afternoon", "golden-hour", "dusk"] as const satisfies readonly MoodId[];

type Kept = { engine: WindowEngine; release: number | null };
let kept: Kept | null = null;
let loading: Promise<typeof import("./engine")> | null = null;

function webglAvailable(): boolean {
  try {
    const probe = document.createElement("canvas");
    return probe.getContext("webgl2") !== null;
  } catch {
    return false;
  }
}

function saveData(): boolean {
  return (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData === true;
}

/**
 * Whether this browser can draw the room, decided once and remembered. Read
 * through useSyncExternalStore: the server and the first render agree on
 * "pending", and the answer arrives just after hydration.
 */
let capability: "3d" | "flat" | null = null;
const capabilityNow = () => (capability ??= webglAvailable() && !saveData() ? "3d" : "flat");
const unchanging = () => () => {};
const pending = () => "pending" as const;

const COARSE = "(pointer: coarse)";
function subscribePointer(onChange: () => void) {
  const media = window.matchMedia(COARSE);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

export function WindowScene({
  displayKey,
  template,
  mood,
  pieces,
  windowLabel,
}: {
  displayKey: string;
  template: TemplateId;
  mood: MoodId;
  pieces: readonly WindowPiece[];
  windowLabel: string;
}) {
  const t = useTranslations("showcase");
  const reduced = usePrefersReducedMotion();
  const frame = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const engine = useRef<WindowEngine | null>(null);
  const capable = useSyncExternalStore(unchanging, capabilityNow, pending);
  const [lost, setLost] = useState(false);
  const mode = lost ? "flat" : capable;
  const [state, setState] = useState<"loading" | "ready">("loading");
  const [progress, setProgress] = useState(0);
  const [chosen, setChosen] = useState<string | null>(null);
  // The hour the shopper chose to see the room in; null keeps the theme's own (reset with each window).
  const [light, setLight] = useState<{ key: string; mood: MoodId } | null>(null);
  const lightNow = light !== null && light.key === displayKey ? light.mood : mood;
  const [focusIndex, setFocusIndex] = useState(0);
  const touch = useSyncExternalStore(subscribePointer, () => window.matchMedia(COARSE).matches, () => false);
  const order = pieces.map((piece) => piece.id);

  const placeHotspots = useCallback((spots: Hotspot[]) => {
    for (const spot of spots) {
      const button = buttons.current.get(spot.id);
      if (button === undefined) continue;
      button.style.transform = `translate3d(${Math.round(spot.left)}px, ${Math.round(spot.top)}px, 0)`;
      button.style.width = `${Math.max(24, Math.round(spot.width))}px`;
      button.style.height = `${Math.max(24, Math.round(spot.height))}px`;
      button.dataset.placed = spot.visible ? "true" : "false";
    }
  }, []);

  // Adopt the kept engine, or make one; hand it back on the way out.
  useEffect(() => {
    if (mode !== "3d") return;
    let cancelled = false;
    const surface = frame.current;
    const holder = host.current;
    if (surface === null || holder === null) return;
    (async () => {
      loading ??= import("./engine");
      const { createWindowEngine } = await loading;
      if (cancelled) return;
      if (kept !== null && kept.release !== null) {
        window.clearTimeout(kept.release);
        kept.release = null;
      }
      kept ??= { engine: createWindowEngine({ reducedMotion: reduced }), release: null };
      const current = kept.engine;
      engine.current = current;
      if (process.env.NODE_ENV !== "production") (window as Window & { vitrineWindow?: WindowEngine }).vitrineWindow = current;
      holder.appendChild(current.canvas);
      current.attach(surface, {
        progress: setProgress,
        state: (next) => {
          if (next === "lost") setLost(true);
          else setState(next);
        },
        hotspots: placeHotspots,
        frame: ({ yaw }) => surface.style.setProperty("--glass-yaw", yaw.toFixed(4)),
      });
    })().catch(() => setLost(true));
    return () => {
      cancelled = true;
      engine.current?.detach();
      engine.current = null;
      if (kept !== null) {
        const leaving = kept;
        leaving.release = window.setTimeout(() => {
          leaving.engine.dispose();
          if (kept === leaving) kept = null;
        }, 4000);
      }
    };
    // The engine is made once per mount; motion changes are passed on below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, placeHotspots]);

  // Dress the window whenever the display changes.
  const dressed = useRef<string | null>(null);
  useEffect(() => {
    if (mode !== "3d") return;
    const tryShow = () => {
      const current = engine.current;
      if (current === null) return false;
      if (dressed.current === displayKey) return true;
      dressed.current = displayKey;
      setChosen(null);
      void current.show({
        key: displayKey,
        template,
        mood: MOODS[mood],
        pieces: pieces.map((piece) => ({ id: piece.id, role: piece.role, kind: piece.kind, quantity: piece.quantity, model: piece.model, image: piece.photo, dims: piece.dims })),
      });
      return true;
    };
    if (tryShow()) return;
    // The engine is still loading: try again shortly.
    const timer = window.setInterval(() => {
      if (tryShow()) window.clearInterval(timer);
    }, 120);
    return () => window.clearInterval(timer);
  }, [mode, displayKey, template, mood, pieces]);

  useEffect(() => {
    engine.current?.setReducedMotion(reduced);
  }, [reduced]);

  const relight = (next: MoodId) => {
    setLight({ key: displayKey, mood: next });
    engine.current?.setMood(MOODS[next]);
  };

  const choose = (id: string | null) => {
    setChosen(id);
    engine.current?.focus(id);
    if (id === null) {
      const index = order.indexOf(chosen ?? "");
      buttons.current.get(order[index] ?? order[0] ?? "")?.focus({ preventScroll: true });
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key === "Escape" && chosen !== null) {
      event.preventDefault();
      choose(null);
      return;
    }
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    if (step === undefined && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    const next = event.key === "Home" ? 0 : event.key === "End" ? order.length - 1 : (index + step! + order.length) % order.length;
    setFocusIndex(next);
    buttons.current.get(order[next]!)?.focus();
  };

  if (mode === "flat") {
    return (
      <div className="flex h-full flex-col">
        <div className="bg-plinth relative min-h-0 flex-1">
          <DisplayStage items={pieces.map((piece) => piece.stage)} windowLabel={windowLabel} />
        </div>
        <p className="text-mist px-1 pt-2 text-xs">{t("flat")}</p>
      </div>
    );
  }

  const placardPiece = chosen === null ? null : (pieces.find((piece) => piece.id === chosen)?.placard ?? null);

  return (
    <div
      ref={frame}
      role="group"
      aria-label={windowLabel}
      className="window-resting relative h-full w-full touch-pan-y overflow-hidden select-none"
      data-agent-id="showcase:window"
      data-state={state}
    >
      <div ref={host} className={cn("absolute inset-0 transition-opacity duration-700", state === "ready" ? "opacity-100" : "opacity-90")} />

      {/* The glass in front of the room, with its sheen. */}
      <div aria-hidden="true" className="window-glass pointer-events-none absolute inset-0 z-10" />

      {/* A real button over every piece. */}
      {pieces.map((piece, index) => (
        <button
          key={piece.id}
          ref={(element) => {
            if (element === null) buttons.current.delete(piece.id);
            else buttons.current.set(piece.id, element);
          }}
          type="button"
          id={`stage-piece-${piece.id}`}
          tabIndex={index === focusIndex ? 0 : -1}
          aria-label={piece.label}
          aria-expanded={chosen === piece.id}
          onFocus={() => setFocusIndex(index)}
          onKeyDown={(event) => onKeyDown(event, index)}
          onClick={() => {
            if (engine.current?.dragged() === true) return;
            choose(chosen === piece.id ? null : piece.id);
          }}
          className="group absolute top-0 left-0 z-20 cursor-pointer rounded-lg outline-offset-2 data-[placed=false]:pointer-events-none"
          style={{ transform: "translate3d(-9999px, 0, 0)", width: 24, height: 24 }}
          data-agent-id={`showcase:piece:${piece.id}`}
        >
          <span className="pointer-events-none absolute -top-9 left-1/2 hidden -translate-x-1/2 rounded-full bg-white/92 px-3 py-1 text-xs text-dusk whitespace-nowrap shadow-sm group-hover:block group-focus-visible:block">
            {piece.placard.title.length > 42 ? `${piece.placard.title.slice(0, 40)}…` : piece.placard.title}
          </span>
        </button>
      ))}

      {placardPiece === null ? null : <Placard piece={placardPiece} onClose={() => choose(null)} />}

      {/* The hour: see the same pieces in morning light, at golden hour, in the evening with the lamps lit. */}
      <div
        role="group"
        aria-label={t("light")}
        className={cn("absolute top-3 right-3 z-20 flex gap-1 rounded-full bg-dusk/55 p-1 backdrop-blur-md transition-opacity duration-500", state === "ready" ? "opacity-100" : "pointer-events-none opacity-0")}
        data-agent-id="showcase:light"
      >
        {LIGHTS.map((entry) => (
          <button
            key={entry}
            type="button"
            aria-pressed={lightNow === entry}
            onClick={() => relight(entry)}
            className={cn(
              "min-h-8 rounded-full px-2.5 text-xs transition-colors sm:px-3",
              lightNow === entry ? "bg-gilt text-dusk" : "text-white/80 hover:bg-white/10 hover:text-white",
            )}
            data-agent-id={`showcase:light:${entry}`}
          >
            {t(`lights.${entry}`)}
          </button>
        ))}
      </div>

      {/* Loading: a hairline along the bottom of the frame, and a word for screen readers. */}
      <div aria-hidden="true" className={cn("bg-gilt absolute bottom-0 left-0 z-20 h-px transition-[width,opacity] duration-300", state === "ready" ? "opacity-0" : "opacity-100")} style={{ width: `${Math.round(progress * 100)}%` }} />
      <p role="status" className="sr-only">
        {state === "loading" ? t("dressing") : ""}
      </p>

      <p className={cn("pointer-events-none absolute bottom-3 left-4 z-10 text-xs text-white/85 transition-opacity duration-700 [text-shadow:0_1px_2px_color-mix(in_oklab,var(--color-dusk)_60%,transparent)]", state === "ready" && chosen === null ? "opacity-100" : "opacity-0")}>
        {touch ? t("hintTouch") : t("hint")}
      </p>
    </div>
  );
}
