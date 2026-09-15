"use client";

/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Design specimen demo of the window-light hero animation.
 */

import { motion } from "motion/react";
import { useState } from "react";

import { ProductImage } from "@/components/commerce/product-image";
import { specimenImage } from "@/lib/specimen/images";
import { Button } from "@/components/ui/button";
import { SPECIMEN_CATALOG } from "@/lib/specimen/catalog";
import { usePrefersReducedMotion } from "@/lib/ui/use-reduced-motion";

/**
 * The window light (docs/PLAN.md 4.5, moment 1)
 *
 * The only motion in Vitrine that nobody triggers. On the first load of the
 * home page, Lumen sweeps once across the hero plinth and settles within 1.2
 * seconds — the moment a shop window's lighting comes on at dusk.
 *
 * It runs once. Nothing in the interface loops except the Lumen dot while the
 * Concierge is listening, because a page that keeps moving is a page you cannot
 * read.
 */

const HERO = SPECIMEN_CATALOG.find((product) => product.category === "lighting");

export function WindowLight() {
  const prefersReducedMotion = usePrefersReducedMotion();
  const [runId, setRunId] = useState(0);
  const sweeping = !prefersReducedMotion;

  return (
    <div className="flex flex-col gap-4">
      <div className="bg-plinth rounded-plinth relative aspect-[16/10] max-w-2xl overflow-hidden">
        {HERO === undefined ? null : (
          <div className="on-plinth absolute inset-8">
            <ProductImage image={specimenImage(HERO)!} sizes="(min-width: 768px) 42rem, 90vw" />
          </div>
        )}

        {/* The sweep: a wide, soft band of Lumen crossing once, left to right.
            Skipped entirely under reduced motion — the plinth is simply lit. */}
        {sweeping ? (
          <motion.div
            key={runId}
            aria-hidden="true"
            initial={{ x: "-60%", opacity: 0 }}
            animate={{ x: "160%", opacity: [0, 0.85, 0.85, 0] }}
            transition={{ duration: 1.2, ease: [0.2, 0, 0, 1], times: [0, 0.2, 0.7, 1] }}
            className="absolute inset-y-0 w-1/2"
            style={{
              background:
                "linear-gradient(100deg, transparent, var(--color-lumen), transparent)",
              filter: "blur(38px)",
              mixBlendMode: "soft-light",
            }}
          />
        ) : null}
      </div>

      <div className="flex items-center gap-4">
        <Button size="sm" variant="secondary" onClick={() => setRunId((n) => n + 1)}>
          Play it again
        </Button>
        <p className="text-slate text-sm">
          {prefersReducedMotion
            ? "Reduced motion is on, so the sweep is skipped and the plinth is simply lit."
            : "Runs once on first load, settles within 1.2 seconds."}
        </p>
      </div>
    </div>
  );
}
