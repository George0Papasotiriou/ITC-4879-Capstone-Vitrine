"use client";

/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Where an AI picture is made and shown: the darkroom while it develops, then the picture, compared with the room it came from.
 */

import { useTranslations } from "next-intl";
import { useEffect, useId, useState } from "react";

import type { PicturePhase } from "@/components/pictures/use-picture";
import { cn } from "@/lib/ui/cn";

/**
 * docs/adr/053. The wait is part of the experience, so it is designed, not
 * hidden behind a spinner: the source — the room, or the piece's studio
 * photograph for a showroom scene — rests dim and soft in the frame while a
 * slow sheen of gilt light crosses it, and a line says what is being done.
 * The picture then develops (globals.css: animate-develop). A picture of the
 * shopper's own room can be compared with the room as it was: a slider wipes
 * between them, by pointer or by keyboard (it is a range input).
 */

const STAGES = ["light", "place", "shadows", "develop"] as const;
const STAGE_MS = 4500;

export function PictureStage({
  phase,
  source,
  result,
  compare,
  alt,
  aspect = "4 / 3",
  className,
}: {
  phase: PicturePhase;
  /** What rests in the frame while the picture is made: the room, or the piece's photograph. */
  source: string | null;
  result: string | null;
  /** Whether the result can be compared with the source (a picture of the shopper's own room). */
  compare: boolean;
  alt: string;
  aspect?: string;
  className?: string;
}) {
  const t = useTranslations("pictures.stage");
  const id = useId();
  const [stage, setStage] = useState(0);
  const [split, setSplit] = useState(100);
  const making = phase === "asking" || phase === "making";

  // Adjusted while rendering, as React advises for state that follows a prop: a new wait starts
  // at the first words, and a fresh picture is shown whole (the shopper slides back to their room).
  const [wasMaking, setWasMaking] = useState(making);
  if (making !== wasMaking) {
    setWasMaking(making);
    setStage(0);
  }
  const [shown, setShown] = useState(result);
  if (result !== shown) {
    setShown(result);
    setSplit(100);
  }

  // The words move on every few seconds, and stay on the last until the picture arrives.
  useEffect(() => {
    if (!making) return;
    const timer = setInterval(() => setStage((current) => Math.min(STAGES.length - 1, current + 1)), STAGE_MS);
    return () => clearInterval(timer);
  }, [making]);

  return (
    <figure className={cn("flex flex-col gap-3", className)} data-agent-id="picture:stage">
      <div className="bg-dusk ring-gilt/30 relative w-full overflow-hidden rounded-[10px] ring-1" style={{ aspectRatio: aspect }}>
        {source === null ? null : (
          // The shopper's own room or the shop's studio photograph, already on this page: a plain image, not the optimizer.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={source} alt="" aria-hidden="true" className={cn("absolute inset-0 size-full object-cover transition-[filter,transform] duration-[var(--duration-stage)]", result === null && "picture-resting")} />
        )}
        {making ? <span className="picture-sheen" aria-hidden="true" /> : null}

        {result === null ? null : (
          <div className="absolute inset-0" style={compare ? { clipPath: `inset(0 ${100 - split}% 0 0)` } : undefined}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={result} alt={alt} className="animate-develop size-full object-cover" data-agent-id="picture:result" />
          </div>
        )}

        {compare && result !== null ? (
          <>
            <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 w-px bg-white/85 shadow-[0_0_12px_rgba(0,0,0,0.45)]" style={{ left: `${split}%` }} />
            <label htmlFor={id} className="sr-only">
              {t("compare")}
            </label>
            <input
              id={id}
              type="range"
              min={0}
              max={100}
              value={split}
              onChange={(event) => setSplit(Number(event.currentTarget.value))}
              className="absolute inset-0 size-full cursor-ew-resize opacity-0"
              data-agent-id="picture:compare"
            />
            <span className="pointer-events-none absolute bottom-3 left-3 rounded-full bg-black/45 px-2.5 py-1 text-xs text-white backdrop-blur-sm">{t("before")}</span>
            <span className="pointer-events-none absolute right-3 bottom-3 rounded-full bg-black/45 px-2.5 py-1 text-xs text-white backdrop-blur-sm">{t("after")}</span>
          </>
        ) : null}

        {making ? (
          <figcaption className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-4 bg-gradient-to-t from-black/55 to-transparent px-5 pt-16 pb-4 text-white" aria-live="polite">
            <span className="font-display text-lg leading-tight" data-agent-id="picture:words">
              {t(`stages.${STAGES[stage]}`)}
            </span>
            <span className="text-mist shrink-0 text-xs">{t("time")}</span>
          </figcaption>
        ) : null}
      </div>
    </figure>
  );
}
