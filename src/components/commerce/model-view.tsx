"use client";

/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Seeing a piece in 3D, measuring it on screen, and standing it in the room you are in.
 */

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { DialogContent, DialogRoot } from "@/components/ui/dialog";
import { useHydrated } from "@/components/ui/use-hydrated";
import { cn } from "@/lib/ui/cn";
import { usePrefersReducedMotion } from "@/lib/ui/use-reduced-motion";

/**
 * docs/adr/025, docs/adr/035, docs/adr/058.
 *
 * Every placeable piece has a model: its own 3D scan (ABO), or the model the
 * shop makes of it from its measurements, words and photograph — and, once
 * bought, a model an AI made from its photograph. The dialog says which,
 * before anything else, in a chip and a sentence: the shop does not pass a
 * drawing off as a scan. Whatever the model, `ar-scale="fixed"` means what
 * appears on the floor is the size the piece would be, and "Show size" draws
 * its width, depth and height on the model itself, read from the model.
 *
 * Presentation: Khronos's PBR Neutral tone mapping (made for showing products
 * in their true colours), a neutral studio environment, a three-quarter
 * opening view, the camera kept above the floor, the piece's photograph as
 * the poster while the model loads.
 *
 * `@google/model-viewer` is imported only when the dialog opens: it is the
 * largest script in the shop, and a shopper who never asks for 3D never pays
 * for it.
 */

/**
 * The script is fetched once per page, however many viewers ask for it, and
 * every asker waits on the same promise. A guard held in a ref would not do:
 * in development React runs an effect twice, and the second run would skip an
 * import whose first run had already been cancelled — leaving the dialog
 * saying "bringing up the model" for ever.
 */
let loading: Promise<unknown> | null = null;
const loadViewer = () => (loading ??= import("@google/model-viewer"));

export type ModelOrigin = "scan" | "ai" | "made";

type Point = { x: number; y: number; z: number };
type ViewerElement = HTMLElement & {
  loaded: boolean;
  cameraOrbit: string;
  resetTurntableRotation(theta?: number): void;
  getDimensions(): Point;
  getBoundingBoxCenter(): Point;
  queryHotspot(name: string): { canvasPosition: Point } | null;
};

export type ModelViewProps = {
  slug: string;
  productId: string;
  title: string;
  dims: { w: number; d: number; h: number };
  /** Opened straight away by the Concierge's open_viewer (?view=ar or ?view=model). */
  startOpen?: boolean;
  /** Where the model comes from; a scan's file is `scan`, anything else is fetched from /api/models/<slug>. */
  origin: ModelOrigin;
  scan?: string;
  /** The piece's studio photograph, shown while the model loads. */
  poster?: string;
  /** A bed is dressed in bedding to read as a bed; the dialog says it is not included. */
  dressed?: boolean;
};

/** The three edges the size is drawn on: the front bottom edge (width), the right bottom edge (depth), the front right upright (height). */
const EDGES = ["w", "d", "h"] as const;

export function ModelView({ slug, productId, title, dims, startOpen = false, origin, scan, poster, dressed = false }: ModelViewProps) {
  const t = useTranslations("product.model");
  const hydrated = useHydrated();
  const reduced = usePrefersReducedMotion();
  const [open, setOpen] = useState(startOpen);
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  const [showSize, setShowSize] = useState(false);
  const [measured, setMeasured] = useState<{ box: { min: Point; max: Point }; cm: { w: number; d: number; h: number } } | null>(null);
  const [full, setFull] = useState(false);
  const stage = useRef<HTMLDivElement>(null);
  const viewer = useRef<ViewerElement | null>(null);
  const lines = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    // The custom element registers itself; nothing from the module is used here.
    void loadViewer().then(
      () => {
        if (alive) setState("ready");
      },
      () => {
        if (alive) setState("failed");
      },
    );
    return () => {
      alive = false;
    };
  }, [open]);

  // Once the model is in, its own bounding box: the size drawn on it is the model's, not a number copied from the listing.
  const onLoad = useCallback(() => {
    const element = viewer.current;
    if (element === null) return;
    const size = element.getDimensions();
    const centre = element.getBoundingBoxCenter();
    setMeasured({
      box: { min: { x: centre.x - size.x / 2, y: centre.y - size.y / 2, z: centre.z - size.z / 2 }, max: { x: centre.x + size.x / 2, y: centre.y + size.y / 2, z: centre.z + size.z / 2 } },
      cm: { w: Math.round(size.x * 100), d: Math.round(size.z * 100), h: Math.round(size.y * 100) },
    });
  }, []);

  const attach = useCallback(
    (element: HTMLElement | null) => {
      viewer.current?.removeEventListener("load", onLoad);
      viewer.current = element as ViewerElement | null;
      viewer.current?.addEventListener("load", onLoad);
      if (viewer.current?.loaded === true) onLoad();
    },
    [onLoad],
  );

  // The dimension lines follow the camera: each frame the camera moves, the hotspots' screen positions are read again.
  useEffect(() => {
    const element = viewer.current;
    if (!showSize || measured === null || element === null) return;
    const draw = () => {
      const svg = lines.current;
      if (svg === null) return;
      for (const edge of EDGES) {
        const from = element.queryHotspot(`hotspot-${edge}-from`)?.canvasPosition;
        const to = element.queryHotspot(`hotspot-${edge}-to`)?.canvasPosition;
        const line = svg.querySelector<SVGLineElement>(`[data-edge="${edge}"]`);
        if (line === null || from === undefined || to === undefined) continue;
        line.setAttribute("x1", String(from.x));
        line.setAttribute("y1", String(from.y));
        line.setAttribute("x2", String(to.x));
        line.setAttribute("y2", String(to.y));
      }
    };
    element.addEventListener("camera-change", draw);
    const first = window.requestAnimationFrame(draw);
    return () => {
      element.removeEventListener("camera-change", draw);
      window.cancelAnimationFrame(first);
    };
  }, [showSize, measured]);

  useEffect(() => {
    const change = () => setFull(document.fullscreenElement !== null && document.fullscreenElement === stage.current);
    document.addEventListener("fullscreenchange", change);
    return () => document.removeEventListener("fullscreenchange", change);
  }, []);

  // Measuring is easiest from the front three-quarter view: the camera goes back there when the size is shown.
  const toggleSize = () => {
    const next = !showSize;
    setShowSize(next);
    if (next && viewer.current !== null) {
      // Auto-rotate turns the model on a turntable; a drag moves the camera. Both go back to the opening view.
      viewer.current.resetTurntableRotation(0);
      viewer.current.cameraOrbit = "-32deg 72deg auto";
    }
  };

  const toggleFull = () => {
    if (document.fullscreenElement !== null) void document.exitFullscreen();
    else void stage.current?.requestFullscreen?.().catch(() => undefined);
  };

  const description = origin === "scan" ? t("scan") : origin === "ai" ? t("ai") : t("made");
  const alt = origin === "scan" ? t("scanAlt", { title }) : origin === "ai" ? t("aiAlt", { title }) : t("madeAlt", { title });
  const hotspots = measured === null ? [] : edgesOf(measured.box);

  return (
    <DialogRoot open={open} onOpenChange={setOpen}>
      <Button variant="secondary" disabled={!hydrated} onClick={() => setOpen(true)} data-agent-id={`action:view-3d:${productId}`}>
        {t("open")}
      </Button>

      {!open ? null : (
        <DialogContent title={t("title", { title })} description={description} className="max-w-4xl">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className="border-hairline text-dusk rounded-full border px-2.5 py-0.5 text-xs font-medium" data-agent-id="model:origin" data-origin={origin}>
              {t(`origin.${origin}`)}
            </span>
            {dressed ? <span className="text-slate text-xs">{t("bedding")}</span> : null}
          </div>
          {/* Tall enough to turn the piece around, short enough that its size stays on screen under it. */}
          <div
            ref={stage}
            className={cn("bg-plinth rounded-plinth relative flex w-full items-center justify-center overflow-hidden", full ? "h-full max-h-none" : "aspect-[4/5] max-h-[56vh] sm:aspect-[3/2]")}
            data-agent-id={`model:${slug}`}
          >
            {state === "ready" ? (
              <model-viewer
                ref={attach}
                src={scan ?? `/api/models/${slug}`}
                alt={alt}
                poster={poster}
                ar
                ar-modes="webxr scene-viewer quick-look"
                // The point of the whole feature: what appears on the floor is the size it would be.
                ar-scale="fixed"
                camera-controls
                camera-orbit="-32deg 72deg auto"
                // Never under the floor: the camera stops just above the horizon.
                max-camera-orbit="auto 88deg auto"
                touch-action="pan-y"
                auto-rotate={!reduced && !showSize}
                auto-rotate-delay="2500"
                rotation-per-second="18deg"
                interaction-prompt={reduced ? "none" : "auto"}
                tone-mapping="neutral"
                environment-image="neutral"
                shadow-intensity="1"
                shadow-softness="0.9"
                exposure="1"
                style={{ width: "100%", height: "100%" }}
                data-agent-id="model:viewer"
                data-model-kind={origin === "scan" ? "scan" : origin === "ai" ? "ai" : "made"}
              >
                {showSize
                  ? hotspots.map((spot) => (
                      <div
                        key={spot.name}
                        slot={`hotspot-${spot.name}`}
                        data-position={`${spot.at.x} ${spot.at.y} ${spot.at.z}`}
                        data-normal="0 1 0"
                        className={spot.label === null ? "size-0" : "border-hairline text-dusk pointer-events-none rounded-full border bg-white/95 px-2 py-0.5 text-xs font-medium whitespace-nowrap tabular-nums shadow-sm"}
                        data-agent-id={spot.label === null ? undefined : `model:size-${spot.edge}`}
                      >
                        {spot.label === null || measured === null ? null : t(spot.label, { cm: measured.cm[spot.edge] })}
                      </div>
                    ))
                  : null}
                {/* Inside the viewer, so the size labels (its hotspots) sit above the lines, as in model-viewer's own example. */}
                {showSize && measured !== null ? (
                  <svg ref={lines} aria-hidden="true" className="text-dusk pointer-events-none absolute inset-0 size-full">
                    {EDGES.map((edge) => (
                      <line key={edge} data-edge={edge} stroke="currentColor" strokeWidth="1.5" strokeDasharray="5 4" />
                    ))}
                  </svg>
                ) : null}
                <button slot="ar-button" className="border-hairline rounded-plinth absolute bottom-4 left-1/2 -translate-x-1/2 border bg-white px-4 py-2 text-sm" data-agent-id="action:view-in-space">
                  {t("inYourSpace")}
                </button>
              </model-viewer>
            ) : (
              <p className="text-slate p-6 text-center text-sm" role="status">
                {state === "failed" ? t("failed") : t("loading")}
              </p>
            )}
            {full && state === "ready" ? (
              <Button size="sm" variant="secondary" onClick={toggleFull} className="absolute top-3 right-3" data-agent-id="model:fullscreen-exit">
                {t("exitFullscreen")}
              </Button>
            ) : null}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
            {state === "ready" ? (
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" onClick={toggleSize} aria-pressed={showSize} disabled={measured === null} data-agent-id="model:show-size">
                  {showSize ? t("hideSize") : t("showSize")}
                </Button>
                <Button size="sm" variant="secondary" onClick={toggleFull} data-agent-id="model:fullscreen">
                  {t("fullscreen")}
                </Button>
              </div>
            ) : null}
            <p className="text-slate text-sm" data-agent-id="model:size">
              {t("size", dims)}
            </p>
          </div>
        </DialogContent>
      )}
    </DialogRoot>
  );
}

/**
 * The hotspots for the three dimension lines, in the model's own metres: each
 * line's two ends, set a few centimetres off the piece so they do not run
 * through it, and a label at its middle.
 */
function edgesOf({ min, max }: { min: Point; max: Point }) {
  const gap = 0.04;
  const front = max.z + gap;
  const right = max.x + gap;
  const floor = min.y;
  const ends: Record<(typeof EDGES)[number], [Point, Point]> = {
    w: [
      { x: min.x, y: floor, z: front },
      { x: max.x, y: floor, z: front },
    ],
    d: [
      { x: right, y: floor, z: max.z },
      { x: right, y: floor, z: min.z },
    ],
    h: [
      { x: right, y: floor, z: front },
      { x: right, y: max.y, z: front },
    ],
  };
  const labels = { w: "dimW", d: "dimD", h: "dimH" } as const;
  return EDGES.flatMap((edge) => {
    const [from, to] = ends[edge];
    const middle = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2, z: (from.z + to.z) / 2 };
    return [
      { name: `${edge}-from`, edge, at: from, label: null },
      { name: `${edge}-to`, edge, at: to, label: null },
      { name: `${edge}-label`, edge, at: middle, label: labels[edge] },
    ];
  });
}
