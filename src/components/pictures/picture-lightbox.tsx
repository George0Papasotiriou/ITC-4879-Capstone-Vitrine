"use client";

/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * An AI picture at full size: the whole frame, or every pixel of it, to look at the stitching and the grain.
 */

import { useTranslations } from "next-intl";
import { useRef, useState } from "react";

import { DialogContent, DialogRoot } from "@/components/ui/dialog";
import { cn } from "@/lib/ui/cn";

/**
 * docs/adr/060. The pictures are made at 2K so they can be looked at closely,
 * the way a shopper inspects a product photograph before buying. Two views:
 * the whole picture fitted to the screen, and actual size, where the picture
 * scrolls (by finger, wheel or arrow keys) and opens at the spot that was
 * clicked. A button switches between them, so nothing depends on a gesture.
 */
export function PictureLightbox({ open, onOpenChange, src, alt, label }: { open: boolean; onOpenChange: (open: boolean) => void; src: string; alt: string; label: string | null }) {
  const t = useTranslations("pictures.stage");
  const [actual, setActual] = useState(false);
  const frame = useRef<HTMLDivElement>(null);

  /** Actual size, with the clicked spot brought to the middle of the frame. */
  const zoomAt = (event: { clientX: number; clientY: number; currentTarget: HTMLImageElement }) => {
    if (actual) return setActual(false);
    const box = event.currentTarget.getBoundingClientRect();
    const fx = (event.clientX - box.left) / box.width;
    const fy = (event.clientY - box.top) / box.height;
    setActual(true);
    requestAnimationFrame(() => {
      const view = frame.current;
      const image = view?.querySelector("img");
      if (view === null || image == null) return;
      view.scrollTo({ left: fx * image.naturalWidth - view.clientWidth / 2, top: fy * image.naturalHeight - view.clientHeight / 2 });
    });
  };

  return (
    <DialogRoot
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) setActual(false);
      }}
    >
      <DialogContent title={alt} hideTitle className="bg-dusk w-[min(96vw,1800px)] max-w-none p-3 text-white md:p-4">
        <div
          ref={frame}
          tabIndex={0}
          className={cn("relative h-[min(calc(85dvh-8rem),1200px)] w-full rounded-[8px] bg-black/40 outline-none focus-visible:ring-2 focus-visible:ring-white", actual ? "overflow-auto" : "grid place-items-center overflow-hidden")}
          data-agent-id="picture:lightbox"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src}
            alt={alt}
            onClick={zoomAt}
            className={cn(actual ? "max-w-none cursor-zoom-out" : "max-h-full max-w-full cursor-zoom-in object-contain")}
          />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          {label === null ? null : <span className="text-mist text-xs">{label}</span>}
          <span className="flex-1" />
          <button
            type="button"
            onClick={() => setActual((value) => !value)}
            aria-pressed={actual}
            className="min-h-11 rounded-full bg-white/10 px-4 text-sm transition-colors hover:bg-white/20"
            data-agent-id="picture:actual-size"
          >
            {actual ? t("fit") : t("actualSize")}
          </button>
        </div>
      </DialogContent>
    </DialogRoot>
  );
}
