/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Shared layout for short information pages.
 */

import type { ReactNode } from "react";

import { ListenButton } from "@/components/comfort/listen-button";

/**
 * The shape of a short information page (shipping, privacy, contact, credits):
 * a heading, an introduction in the display size, and body paragraphs at a
 * reading measure.
 */
export function InfoPage({ title, intro, children }: { title: string; intro: string; children: ReactNode }) {
  return (
    <main className="mx-auto w-full max-w-[1440px] px-6 py-10 md:px-10 md:py-16">
      <article className="max-w-[65ch]">
        <h1 className="font-display text-3xl">{title}</h1>
        {/* Read aloud, the whole page from its introduction (docs/adr/032). */}
        <ListenButton targets={["info-intro", "info-body"]} className="mt-4" />
        <p id="info-intro" className="mt-6 text-lg">{intro}</p>
        <div id="info-body" className="text-slate mt-6 flex flex-col gap-4 leading-relaxed">{children}</div>
      </article>
    </main>
  );
}
