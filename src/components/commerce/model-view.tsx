"use client";

/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Seeing a piece in 3D, and standing it in the room you are in.
 */

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { DialogContent, DialogRoot } from "@/components/ui/dialog";
import { useHydrated } from "@/components/ui/use-hydrated";
import { usePrefersReducedMotion } from "@/lib/ui/use-reduced-motion";

/**
 * docs/adr/025.
 *
 * The viewer is a stand-in shape at the piece's real width, depth and height,
 * and the dialog says so before anything else: the shop does not pretend to
 * have a scan of a sofa it has only photographed. What it does have is the
 * measurements, and `ar-scale="fixed"` means the thing that appears on the
 * floor is the size the thing would be.
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
 * saying "bringing up the shape" for ever.
 */
let loading: Promise<unknown> | null = null;
const loadViewer = () => (loading ??= import("@google/model-viewer"));

export type ModelViewProps = {
  slug: string;
  productId: string;
  title: string;
  dims: { w: number; d: number; h: number };
  /** Opened straight away by the Concierge's open_viewer (?view=ar or ?view=model). */
  startOpen?: boolean;
};

export function ModelView({ slug, productId, title, dims, startOpen = false }: ModelViewProps) {
  const t = useTranslations("product.model");
  const hydrated = useHydrated();
  const reduced = usePrefersReducedMotion();
  const [open, setOpen] = useState(startOpen);
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");

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

  return (
    <DialogRoot open={open} onOpenChange={setOpen}>
      <Button variant="secondary" disabled={!hydrated} onClick={() => setOpen(true)} data-agent-id={`action:view-3d:${productId}`}>
        {t("open")}
      </Button>

      {!open ? null : (
        <DialogContent title={t("title", { title })} description={t("standIn")} className="max-w-3xl">
          {/* Tall enough to turn the piece around, short enough that its size stays on screen under it. */}
          <div className="bg-plinth rounded-plinth flex max-h-[46vh] w-full items-center justify-center overflow-hidden" style={{ aspectRatio: "3 / 2" }} data-agent-id={`model:${slug}`}>
            {state === "ready" ? (
              <model-viewer
                src={`/api/models/${slug}`}
                alt={t("alt", { title })}
                ar
                ar-modes="webxr scene-viewer"
                // The point of the whole feature: what appears on the floor is the size it would be.
                ar-scale="fixed"
                camera-controls
                touch-action="pan-y"
                auto-rotate={!reduced}
                interaction-prompt={reduced ? "none" : "auto"}
                shadow-intensity="1"
                shadow-softness="0.8"
                exposure="1.1"
                style={{ width: "100%", height: "100%" }}
                data-agent-id="model:viewer"
              >
                <button slot="ar-button" className="border-hairline rounded-plinth absolute bottom-4 left-1/2 -translate-x-1/2 border bg-white px-4 py-2 text-sm" data-agent-id="action:view-in-space">
                  {t("inYourSpace")}
                </button>
              </model-viewer>
            ) : (
              <p className="text-slate p-6 text-center text-sm" role="status">
                {state === "failed" ? t("failed") : t("loading")}
              </p>
            )}
          </div>
          <p className="text-slate mt-4 text-sm" data-agent-id="model:size">
            {t("size", dims)}
          </p>
        </DialogContent>
      )}
    </DialogRoot>
  );
}
