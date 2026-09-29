"use client";

/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * The shop window itself: the set standing at true relative size, lit by a window that follows the pointer.
 */

import Image from "next/image";
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

import { layoutStage, type StagePiece } from "@/lib/display/stage";
import { cn } from "@/lib/ui/cn";

/**
 * docs/adr/040. The pieces are laid out by layoutStage for this window's own
 * shape, measured as it is drawn and again when it changes, so a phone and a
 * wide screen both show the set at true relative size. The light is a soft
 * patch of the lumen token that drifts towards the pointer; with reduced
 * motion (the system's or the shop's) it stays where it is. Each piece is a
 * button: arrow keys walk the window, Enter or a click chooses the piece and
 * takes the shopper to its card below, where it can be bought.
 */

/** Where the window's light falls on the wall, in percentages of the stage (the window is top right). */
const WINDOW_LIGHT = { x: 72, y: 38 };

export type StageItem = StagePiece & { title: string; label: string; image: { src: string; alt: string; whiteGround: boolean } | null };

export function DisplayStage({ items, windowLabel }: { items: readonly StageItem[]; windowLabel: string }) {
  const box = useRef<HTMLDivElement>(null);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const [aspect, setAspect] = useState(16 / 9);
  const [focusIndex, setFocusIndex] = useState(0);

  useEffect(() => {
    const element = box.current;
    if (element === null) return;
    const measure = () => {
      const { width, height } = element.getBoundingClientRect();
      if (width > 0 && height > 0) setAspect(width / height);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const layout = layoutStage(items, aspect);
  // Left to right, as the eye and the arrow keys go.
  const ordered = [...layout.pieces].sort((a, b) => (a.flat === b.flat ? a.leftPct - b.leftPct : a.flat ? 1 : -1));
  const itemOf = (id: string) => items.find((item) => item.id === id)!;

  const moveLight = (event: PointerEvent<HTMLDivElement>) => {
    const element = box.current;
    if (element === null || document.documentElement.dataset.motion === "reduce" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const rect = element.getBoundingClientRect();
    // The light comes through the window; the pointer only sways it a little, like a passer-by's shadow.
    const x = (event.clientX - rect.left) / rect.width - 0.5;
    const y = (event.clientY - rect.top) / rect.height - 0.5;
    element.style.setProperty("--light-x", `${Math.round(WINDOW_LIGHT.x + x * 16)}%`);
    element.style.setProperty("--light-y", `${Math.round(WINDOW_LIGHT.y + y * 10)}%`);
  };

  const choose = (id: string) => {
    const card = document.getElementById(`piece-${id}`);
    card?.scrollIntoView({ behavior: "smooth", block: "center" });
    card?.querySelector<HTMLElement>("[data-piece-title]")?.focus({ preventScroll: true });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    if (step === undefined && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    const next = event.key === "Home" ? 0 : event.key === "End" ? ordered.length - 1 : (index + step! + ordered.length) % ordered.length;
    setFocusIndex(next);
    buttons.current[next]?.focus();
  };

  return (
    <div
      ref={box}
      role="group"
      aria-label={windowLabel}
      onPointerMove={moveLight}
      className="rounded-sheet relative aspect-[5/4] w-full overflow-hidden sm:aspect-[16/9]"
      style={{ ["--light-x" as string]: `${WINDOW_LIGHT.x}%`, ["--light-y" as string]: `${WINDOW_LIGHT.y}%` }}
      data-agent-id="showcase:window"
    >
      {/* The wall, the floor and the light from the window: tokens only. */}
      <div aria-hidden="true" className="bg-plinth absolute inset-0" />
      <div aria-hidden="true" className="bg-dusk/[0.08] absolute inset-x-0 bottom-0 h-[16%]" />
      {/* The window the light comes through, high on the back wall. */}
      <div aria-hidden="true" className="bg-lumen-glow/50 absolute top-[7%] right-[9%] h-[36%] w-[22%] rounded-t-[999px] border-4 border-white/70">
        <span className="absolute inset-y-0 left-1/2 w-1 -translate-x-1/2 bg-white/70" />
        <span className="absolute inset-x-0 top-[55%] h-1 bg-white/70" />
      </div>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{ background: "radial-gradient(60% 55% at var(--light-x) var(--light-y), var(--color-lumen-glow), transparent 70%)", opacity: 0.55 }}
      />
      {ordered.map((piece, index) => {
        const item = itemOf(piece.id);
        return (
          <button
            key={piece.id}
            ref={(element) => {
              buttons.current[index] = element;
            }}
            type="button"
            id={`stage-piece-${piece.id}`}
            tabIndex={index === focusIndex ? 0 : -1}
            onFocus={() => setFocusIndex(index)}
            onKeyDown={(event) => onKeyDown(event, index)}
            onClick={() => choose(piece.id)}
            aria-label={item.label}
            className={cn(
              "group absolute cursor-pointer rounded-sm outline-offset-4",
              "motion-safe:animate-rise",
              // The blend belongs to the piece as a whole: its entrance makes it a layer of its own,
              // and only at this level does the studio's white fall away against the wall.
              // A rug is blended always: it lies on a light floor, and its photograph's margins should too.
              (item.image?.whiteGround === true || piece.flat) && "mix-blend-multiply",
            )}
            style={{
              left: `${piece.leftPct}%`,
              bottom: `${piece.bottomPct}%`,
              width: `${piece.widthPct}%`,
              height: `${Math.max(piece.heightPct, 2)}%`,
              zIndex: piece.z + 1,
              animationDelay: `${index * 70}ms`,
            }}
            data-agent-id={`showcase:piece:${piece.id}`}
          >
            {item.image === null ? (
              <span className="bg-dusk/10 absolute inset-0 rounded-sm" />
            ) : piece.flat ? (
              // A rug lies on the floor: its footprint, tipped back in perspective from its front edge.
              <span className="absolute inset-0 origin-bottom overflow-hidden rounded-sm [transform:perspective(700px)_rotateX(68deg)]">
                <Image src={item.image.src} alt="" fill sizes="60vw" className="object-cover" />
              </span>
            ) : (
              <Image
                src={item.image.src}
                alt=""
                fill
                sizes="(min-width: 768px) 30vw, 45vw"
                className="duration-quick ease-standard object-contain object-bottom transition-transform group-hover:-translate-y-1 group-focus-visible:-translate-y-1"
              />
            )}
            {piece.measured ? null : <span className="text-slate absolute -top-5 left-0 text-[10px]">≈</span>}
          </button>
        );
      })}
    </div>
  );
}
