/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Local-only page hosting the evaluation E4 measurement bench for real room photos.
 */

import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { E4Harness } from "@/components/lab/e4-harness";
import { serverEnv } from "@/env";
import { requireLocale } from "@/i18n/params";

/**
 * The bench for evaluation E4 (docs/PLAN.md Phase 10). It is an instrument, not
 * a shop page: it exists on this machine and on the local stack, and a deployed
 * shop answers 404 for it. English only, and never linked from the storefront.
 */

export const metadata: Metadata = {
  title: "E4 measurement bench",
  robots: { index: false, follow: false },
};

/**
 * Rendered per request, never at build time: whether this page exists at all
 * depends on the environment it is running in, and the build has none.
 */
export const dynamic = "force-dynamic";

export default async function E4Page({ params }: PageProps<"/[locale]/lab/e4">) {
  await requireLocale(params);
  const env = serverEnv();
  if (env.NODE_ENV === "production" && env.VITRINE_LOCAL !== true) notFound();

  return (
    <main className="mx-auto w-full max-w-[1200px] px-6 py-10 md:px-10 md:py-16">
      <h1 className="font-display text-3xl">Evaluation E4: real rooms</h1>
      <p className="text-slate mt-3 max-w-[70ch]">
        Measures how wrong each method draws a piece, on real photographs with a measured object. Both methods are read from the same
        marks, so they can be compared directly. This page is not part of the shop.
      </p>
      <div className="mt-8">
        <E4Harness />
      </div>
    </main>
  );
}
