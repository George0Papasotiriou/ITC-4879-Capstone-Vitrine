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

import { PictureLightbox } from "@/components/pictures/picture-lightbox";
import type { PicturePhase } from "@/components/pictures/use-picture";
import { cn } from "@/lib/ui/cn";

/**
 * docs/adr/053, docs/adr/060. The wait is part of the experience, so it is
 * designed and honest: the source — the room, or the piece's photograph for
 * a showroom picture — rests dim and soft in the frame while a slow sheen of
 * gilt light crosses it, and a line says what is really happening, in the
 * order it happens (the model studies the piece, matches the room's light,
 * places it, develops the picture, and the shop checks it against the piece),
 * timed from when the picture was asked for, so a shopper who comes back
 * mid-wait sees where it is. The picture then develops (globals.css).
 *
 * The finished picture carries one quiet label in its corner — "AI picture" —
 * the shop's honesty rule and the EU AI Act's for generated images; nothing
 * else on it gives it away. It opens full size, and a picture of the
 * shopper's own room can be compared with the room as it was: a slider wipes
 * between them, by pointer or keyboard (it is a range input).
 */

/** The steps, and from how many seconds into the wait each is shown. */
const STAGES = [
  ["study", 0],
  ["light", 9],
  ["place", 20],
  ["develop", 34],
  ["check", 52],
  ["second", 95],
] as const;

export function PictureStage({
  phase,
  source,
  result,
  full,
  compare,
  alt,
  label,
  since,
  aspect = "4 / 3",
  className,
}: {
  phase: PicturePhase;
  /** What rests in the frame while the picture is made: the room, or the piece's photograph. */
  source: string | null;
  result: string | null;
  /** The picture at full size, for the full-size view; the shown one when absent. */
  full?: string | null;
  /** Whether the result can be compared with the source (a picture of the shopper's own room). */
  compare: boolean;
  alt: string;
  /** The words in the picture's corner ("AI picture · Approximate size"). */
  label: string | null;
  /** When the wait began (ms), so the words match how far it has gone. */
  since?: number | null;
  aspect?: string;
  className?: string;
}) {
  const t = useTranslations("pictures.stage");
  const id = useId();
  const [now, setNow] = useState(() => Date.now());
  const [split, setSplit] = useState(100);
  const [zoom, setZoom] = useState(false);
  const making = phase === "asking" || phase === "making";

  // A fresh picture is shown whole (the shopper slides back to their room), as React advises for state that follows a prop.
  const [shown, setShown] = useState(result);
  if (result !== shown) {
    setShown(result);
    setSplit(100);
  }

  // The words move on with the clock while the picture is made.
  useEffect(() => {
    if (!making) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [making]);
  const seconds = since == null ? 0 : Math.max(0, (now - since) / 1000);
  const stage = [...STAGES].reverse().find(([, from]) => seconds >= from)?.[0] ?? "study";

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
            <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 w-px bg-white/85 shadow-[0_0_12px_color-mix(in_oklab,var(--color-black)_45%,transparent)]" style={{ left: `${split}%` }} />
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
            {/* The picture is shown from the left up to the slider; the room as it was shows to its right. */}
            <span className="pointer-events-none absolute bottom-3 left-3 rounded-full bg-black/45 px-2.5 py-1 text-xs text-white backdrop-blur-sm" data-agent-id="picture:label-after">
              {t("after")}
            </span>
            <span className="pointer-events-none absolute right-3 bottom-3 rounded-full bg-black/45 px-2.5 py-1 text-xs text-white backdrop-blur-sm" data-agent-id="picture:label-before">
              {t("before")}
            </span>
          </>
        ) : null}

        {result !== null && label !== null ? (
          <span
            className={cn("pointer-events-none absolute left-3 rounded-full bg-black/40 px-2.5 py-1 text-[11px] tracking-[0.02em] text-white/90 backdrop-blur-sm", compare ? "top-3" : "bottom-3")}
            data-agent-id="picture:label"
          >
            {label}
          </span>
        ) : null}
        {result !== null ? (
          <button
            type="button"
            onClick={() => setZoom(true)}
            className="absolute top-3 right-3 grid size-11 place-items-center rounded-full bg-black/40 text-white backdrop-blur-sm transition-colors hover:bg-black/60 focus-visible:outline-2 focus-visible:outline-white"
            aria-label={t("fullSize")}
            data-agent-id="picture:zoom"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
              <path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7" />
            </svg>
          </button>
        ) : null}

        {making ? (
          <figcaption className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-4 bg-gradient-to-t from-black/60 to-transparent px-5 pt-16 pb-4 text-white" aria-live="polite">
            <span className="font-display text-lg leading-tight" data-agent-id="picture:words">
              {t(`stages.${stage}`)}
            </span>
            <span className="text-mist shrink-0 text-xs tabular-nums">{t("time")}</span>
          </figcaption>
        ) : null}
      </div>
      {result === null ? null : <PictureLightbox open={zoom} onOpenChange={setZoom} src={full ?? result} alt={alt} label={label} />}
    </figure>
  );
}
