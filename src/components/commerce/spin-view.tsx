"use client";

/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Turning a piece round: its turntable photographs, by drag or by arrow keys.
 */

import Image from "next/image";
import { useTranslations } from "next-intl";
import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

import { Button } from "@/components/ui/button";
import { DialogContent, DialogRoot } from "@/components/ui/dialog";
import { useHydrated } from "@/components/ui/use-hydrated";
import { sameOriginImage } from "@/lib/catalog/media-url";

/**
 * docs/adr/035. Real photographs taken all the way round the piece (the ABO
 * turntable sequences, 24 kept of 72), so what turns is the piece itself, not
 * a model of it. It never turns on its own: a drag turns it by as much as the
 * finger moves, and the arrow keys a step at a time, so it works by keyboard
 * and screen reader too (a slider, said as an angle). Only the first
 * photograph loads with the dialog; the rest are fetched the first time the
 * piece is turned.
 */

/** Pixels of drag per frame: a full turn is a comfortable sweep across the photograph. */
const PIXELS_PER_FRAME = 14;

export function SpinView({ frames: sources, title, productId }: { frames: readonly string[]; title: string; productId: string }) {
  const t = useTranslations("product.spin");
  const hydrated = useHydrated();
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const drag = useRef<{ x: number; start: number } | null>(null);
  const preloaded = useRef(false);

  // Every frame from the shop itself, sized once by the image optimizer, so preloading and showing use the same address.
  const frames = sources.map((src) => sameOriginImage(src, 828));
  const count = frames.length;
  const degrees = Math.round((index / count) * 360);
  const go = (next: number) => {
    if (!preloaded.current) {
      preloaded.current = true;
      // The browser caches them; the next frames then appear without a wait.
      for (const src of frames) {
        const image = new window.Image();
        image.src = src;
      }
    }
    setIndex(((next % count) + count) % count);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[event.key];
    if (step !== undefined) {
      event.preventDefault();
      go(index + step);
    } else if (event.key === "Home") {
      event.preventDefault();
      go(0);
    } else if (event.key === "End") {
      event.preventDefault();
      go(count - 1);
    }
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX, start: index };
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current === null) return;
    // Dragging right turns the piece towards you from its left, as a turntable would.
    go(drag.current.start - Math.round((event.clientX - drag.current.x) / PIXELS_PER_FRAME));
  };
  const onPointerUp = () => {
    drag.current = null;
  };

  return (
    <DialogRoot open={open} onOpenChange={setOpen}>
      <Button variant="secondary" disabled={!hydrated} onClick={() => setOpen(true)} data-agent-id={`action:spin:${productId}`}>
        {t("open")}
      </Button>
      {!open ? null : (
        <DialogContent title={t("title", { title })} description={t("description")} className="max-w-3xl">
          <div
            role="slider"
            tabIndex={0}
            aria-label={t("label")}
            aria-valuemin={0}
            aria-valuemax={count - 1}
            aria-valuenow={index}
            aria-valuetext={t("angle", { degrees })}
            onKeyDown={onKeyDown}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            className="bg-plinth rounded-plinth relative aspect-square max-h-[60vh] w-full cursor-grab touch-pan-y overflow-hidden select-none active:cursor-grabbing"
            data-agent-id={`spin:${productId}`}
          >
            <Image
              src={frames[index]!}
              alt={t("frameAlt", { title, degrees })}
              fill
              sizes="(min-width: 768px) 700px, 100vw"
              // Already the optimizer's address (or the shop's own file).
              unoptimized
              draggable={false}
              className="pointer-events-none object-contain mix-blend-multiply"
            />
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm">
            <p className="text-slate tabular-nums" aria-hidden="true" data-agent-id="spin:angle">
              {t("angle", { degrees })}
            </p>
            <div className="flex gap-2">
              <Button variant="tertiary" size="sm" onClick={() => go(index - 1)} data-agent-id="spin:left">
                {t("left")}
              </Button>
              <Button variant="tertiary" size="sm" onClick={() => go(index + 1)} data-agent-id="spin:right">
                {t("right")}
              </Button>
            </div>
          </div>
          <p className="text-slate mt-2 text-xs">{t("source")}</p>
        </DialogContent>
      )}
    </DialogRoot>
  );
}
