/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * What the shop knows about how a piece fits: reviewers' fit remarks and the shop's own kept and returned sizes, turned into the Fit Engine's belief about the piece.
 */

import { stretchAllowance } from "@/lib/fit/size/body";
import { itemFromCounts, updateFit, type FitCounts, type FitOutcome, type FitParams, type ItemBelief } from "@/lib/fit/size/ordinal";

/**
 * docs/adr/064. Two kinds of evidence, oldest first:
 *
 * 1. REVIEWERS' REMARKS (Amazon.com, ADR-061): how many reviews say the piece
 *    runs small, true to size or large. They are found by phrases in review
 *    text, and reviewers mention fit far more often when it went wrong (the
 *    clothes' remarks are 58% "true to size" on average, against 74% "fit"
 *    among RentTheRunway's rentals), so the shop reads them in two guarded
 *    ways:
 *    - at most REMARKS_WORTH of them count: beyond a hundred, the shares
 *      matter, not the number, and phrase-matching is too rough to make the
 *      engine near certain;
 *    - how forgiving a piece is, is read against the typical piece's remarks
 *      (`typicalTolerance`): over-reported misfits narrow every piece alike,
 *      so only the difference is kept.
 *    A stretchy fabric starts out more forgiving (body.ts).
 *
 * 2. THE SHOP'S OWN ORDERS: a size returned as too small or too big says so;
 *    a size kept past the 14-day return window fitted (the signal Sembium et
 *    al., 2017, learned from at Amazon). Returns for other reasons say
 *    nothing about fit and are left out. Each buyer's body is unknown, so
 *    each outcome is learned with a buyer who chose their own size (the
 *    customer prior) — the same rule as in E12.
 */

export const REMARKS_WORTH = 100;

/** Remarks scaled so they count as at most REMARKS_WORTH. */
export function remarksCounted(counts: FitCounts): FitCounts {
  const total = counts.small + counts.trueToSize + counts.large;
  if (total <= REMARKS_WORTH) return counts;
  const scale = REMARKS_WORTH / total;
  return { small: counts.small * scale, trueToSize: counts.trueToSize * scale, large: counts.large * scale };
}

/** The tolerance remarks give the typical piece: the mean over the catalogue's pieces with remarks. */
export function typicalTolerance(params: FitParams, catalogue: readonly FitCounts[]): number {
  const withRemarks = catalogue.filter((counts) => counts.small + counts.trueToSize + counts.large > 0);
  if (withRemarks.length === 0) return 0;
  return withRemarks.reduce((sum, counts) => sum + itemFromCounts(params, remarksCounted(counts)).tolerance.mean, 0) / withRemarks.length;
}

/** One sized line of a past order, as the Fit Engine learns from it. */
export type SizedOutcome = { sizeIndex: number; outcome: FitOutcome };

/** A line's outcome: a size return says which way; kept past the window, it fitted; anything else, nothing yet. */
export function outcomeOf(line: { returnReason: string | null; deliveredAt: Date | null; windowClosed: boolean }): FitOutcome | null {
  const code = line.returnReason?.split(":")[0]?.trim();
  if (code === "too_small") return "small";
  if (code === "too_big") return "large";
  if (line.returnReason !== null) return null;
  return line.deliveredAt !== null && line.windowClosed ? "fit" : null;
}

export type ItemEvidence = { remarks: FitCounts | null; typicalTolerance: number; stretch: number; outcomes: readonly SizedOutcome[] };

/** The piece as the shop believes it fits: remarks first (read against the typical piece), then each of the shop's outcomes in order. */
export function itemBelief(params: FitParams, evidence: ItemEvidence): ItemBelief {
  const start = stretchAllowance(evidence.stretch);
  let item: ItemBelief;
  if (evidence.remarks === null) {
    item = itemFromCounts(params, { small: 0, trueToSize: 0, large: 0 }, start);
  } else {
    const read = itemFromCounts(params, remarksCounted(evidence.remarks));
    item = { offset: read.offset, tolerance: { mean: read.tolerance.mean - evidence.typicalTolerance + start, variance: read.tolerance.variance } };
  }
  const buyer = params.customerPrior * params.customerPrior;
  for (const { sizeIndex, outcome } of evidence.outcomes) {
    item = updateFit(params, sizeIndex, item, { mean: sizeIndex, variance: buyer }, outcome).item;
  }
  return item;
}

export type FitLean = "small" | "true" | "large";
export type FitCut = "close" | "usual" | "forgiving";

/**
 * The piece in words, for the size finder: which way it runs and how
 * forgiving it is, once the belief is clear of the noise — a lean or a
 * tolerance at least a tenth of a size from the typical piece's, and at
 * least twice its own spread. A tenth of a size is a fifth of the fit
 * margin's half-width: enough to move a body near a size's limit into the
 * next size.
 */
export function describeItem(item: ItemBelief): { lean: FitLean; cut: FitCut } {
  const clear = (belief: { mean: number; variance: number }, threshold: number) => Math.abs(belief.mean) >= threshold && Math.abs(belief.mean) >= 2 * Math.sqrt(belief.variance);
  const lean: FitLean = clear(item.offset, 0.1) ? (item.offset.mean < 0 ? "small" : "large") : "true";
  const cut: FitCut = clear(item.tolerance, 0.1) ? (item.tolerance.mean < 0 ? "close" : "forgiving") : "usual";
  return { lean, cut };
}
