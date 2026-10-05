/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * The Fit Engine's model: a shopper's true size, how an item runs and how forgiving it is, as beliefs; fit as an ordinal outcome, and how each outcome teaches all three.
 */

import { cdf, truncatedMoments } from "@/lib/fit/size/gaussian";

/**
 * docs/adr/064 — a student-designed algorithm (rubric row 16).
 *
 * THE MODEL. A shopper has a true size t, on the size scale (one step per
 * size). An item runs large or small by an offset b: buying it in size s is
 * like buying size s + b of a "true to size" item. And an item is more or
 * less forgiving: a knit with stretch fits a wider range of bodies than a
 * tailored jacket. How it fits is decided by
 *
 *   z = (s + b − t) + ε,      ε ~ N(0, β²)
 *
 *   small  if z < −(m + τ)     the garment is smaller than the body
 *   fit    if |z| ≤ m + τ
 *   large  if z > m + τ
 *
 * m is the fit margin (how far off a size may be and still fit, for a
 * typical item), τ the item's own tolerance on top of it, and β the noise
 * (taste, a body that is not a chart). This is an ordinal probit model whose
 * thresholds ±(m + τ) belong to the item.
 *
 * Why τ: E12 found that one offset per item loses to simply quoting each
 * item's own record ("12% say small, 70% fit, 18% large"). An offset can say
 * which way an item runs but not that it fits few people either way — an
 * unforgiving cut. With τ the model can say both, and beats the record
 * (docs/report/evaluations/e12-fit.md).
 *
 * BELIEFS. b, τ and t are unknown, so each is a Gaussian belief N(μ, σ²).
 * Before an outcome z is Gaussian too:
 *
 *   z ~ N(μ_z, c²),   μ_z = s + μ_b − μ_t,   c² = β² + σ_b² + σ_t² + σ_τ²
 *
 * and, with the band's half-width h = m + μ_τ,
 *
 *   P(small) = Φ((−h − μ_z)/c),   P(large) = Φ((μ_z − h)/c),   P(fit) = 1 − both.
 *
 * LEARNING (assumed-density filtering). Each edge of the band is a linear
 * fact about the beliefs: "not too small" says d = z + m + τ > 0, "not too
 * large" says d = z − m − τ < 0. Seeing one cuts d's normal at zero; the cut
 * normal's mean moves by v·c and its variance shrinks by 1 − w (gaussian.ts);
 * moment matching spreads that back onto each belief in proportion to its
 * variance and with the sign it has in d — the TrueSkill update (Herbrich et
 * al., 2007) for a sum of Gaussians:
 *
 *   μ_k ← μ_k + a_k·(σ_k²/c)·v       σ_k² ← σ_k²·(1 − (σ_k²/c²)·w)
 *
 * with a = +1 for b, −1 for t, and ±1 for τ (+ on the small edge, − on the
 * large one). "Too small" is one cut (d < 0 on the small edge), "too large"
 * one (d > 0 on the large edge). "Fits" is both edges at once, which is not
 * one cut of one normal; each edge is learned from the same starting beliefs
 * and the two lessons are multiplied together, as the messages of
 * expectation propagation are (Minka, 2001): precisions add,
 *
 *   1/σ² = 1/σ₁² + 1/σ₂² − 1/σ₀²,    μ/σ² = μ₁/σ₁² + μ₂/σ₂² − μ₀/σ₀²
 *
 * so neither edge goes first (learning them in turn pulled a centred item
 * towards "runs small" every time it fitted). This treats the edges as if
 * each had its own noise — the approximation the filter makes; the noise β
 * is fitted on held-out outcomes with it in place (E12).
 *
 * So "too large" says the item runs large, the shopper is smaller than
 * thought, and the item is less forgiving; "fits" when it was expected to be
 * tight says the item forgives more. Before each outcome the offset's and
 * the shopper's variances grow by the drift² (a body changes, a brand's cut
 * drifts), so old evidence slowly counts for less; how forgiving a cut is
 * does not drift.
 *
 * Everything is in size steps, so one model serves EU shoe sizes and XS–XL.
 */

export type FitOutcome = "small" | "fit" | "large";
export const FIT_OUTCOMES: readonly FitOutcome[] = ["small", "fit", "large"];

export type Belief = { mean: number; variance: number };

/** What is believed about an item: how it runs (offset, + = runs large) and how forgiving it is (tolerance, + = forgives more). */
export type ItemBelief = { offset: Belief; tolerance: Belief };

export type FitParams = {
  /** Half-width of "fits" for a typical item, in size steps. */
  margin: number;
  /** Noise of a single outcome, in size steps. */
  noise: number;
  /** Prior spread of an unknown item's offset and tolerance, and of a shopper's true size around the first size they chose. */
  itemPrior: number;
  tolerancePrior: number;
  customerPrior: number;
  /** Growth of each belief's spread per outcome, in size steps. */
  drift: number;
};

export type FitProbabilities = Record<FitOutcome, number>;

/** The narrowest the band may become, as a share of the margin: an item can be unforgiving, never impossible to fit. */
export const MIN_HALF_WIDTH = 0.05;

/** An item nobody has said anything about; a stretchy fabric starts out more forgiving (`toleranceMean`, body.ts). */
export const unknownItem = (params: FitParams, toleranceMean = 0): ItemBelief => ({
  offset: { mean: 0, variance: params.itemPrior * params.itemPrior },
  tolerance: { mean: toleranceMean, variance: params.tolerancePrior * params.tolerancePrior },
});

const halfWidth = (params: FitParams, tolerance: number): number => Math.max(params.margin + tolerance, MIN_HALF_WIDTH * params.margin);

/** How likely each outcome is when this shopper takes this item in this size. */
export function predictFit(params: FitParams, size: number, item: ItemBelief, customer: Belief): FitProbabilities {
  const mean = size + item.offset.mean - customer.mean;
  const sd = Math.sqrt(params.noise * params.noise + item.offset.variance + customer.variance + item.tolerance.variance);
  const h = halfWidth(params, item.tolerance.mean);
  const small = cdf((-h - mean) / sd);
  const large = cdf((mean - h) / sd);
  return { small, fit: Math.max(0, 1 - small - large), large };
}

/** A belief after a step of drift: the same mean, a little less sure. */
export const drifted = (belief: Belief, drift: number): Belief => ({ mean: belief.mean, variance: belief.variance + drift * drift });

type Three = { offset: Belief; customer: Belief; tolerance: Belief };

/**
 * One edge of the band, learned. side +1 is the small edge (d = z + m + τ),
 * −1 the large edge (d = z − m − τ); `above` says d > 0 was seen, otherwise
 * d < 0.
 */
function cut(params: FitParams, size: number, beliefs: Three, side: 1 | -1, above: boolean): Three {
  const { offset, customer, tolerance } = beliefs;
  const mean = size + offset.mean - customer.mean + side * (params.margin + tolerance.mean);
  const c2 = params.noise * params.noise + offset.variance + customer.variance + tolerance.variance;
  const c = Math.sqrt(c2);
  // d > 0 is a standard normal above −μ_d/c; d < 0, below it.
  const alpha = -mean / c;
  const { v, w } = above ? truncatedMoments(alpha, Number.POSITIVE_INFINITY) : truncatedMoments(Number.NEGATIVE_INFINITY, alpha);
  const moved = (belief: Belief, sign: number): Belief => ({
    mean: belief.mean + sign * (belief.variance / c) * v,
    variance: belief.variance * (1 - (belief.variance / c2) * w),
  });
  return { offset: moved(offset, 1), customer: moved(customer, -1), tolerance: moved(tolerance, side) };
}

/**
 * One outcome, learned: the item's and the shopper's beliefs after seeing it.
 * Pure — the caller keeps the beliefs.
 */
export function updateFit(params: FitParams, size: number, item: ItemBelief, customer: Belief, outcome: FitOutcome): { item: ItemBelief; customer: Belief } {
  const start: Three = { offset: drifted(item.offset, params.drift), customer: drifted(customer, params.drift), tolerance: item.tolerance };
  const beliefs = outcome === "small" ? cut(params, size, start, 1, false) : outcome === "large" ? cut(params, size, start, -1, true) : bothEdges(params, size, start);
  return { item: { offset: beliefs.offset, tolerance: beliefs.tolerance }, customer: beliefs.customer };
}

/** "Fits": each edge learned from the same start, the two lessons multiplied together (precisions add). */
function bothEdges(params: FitParams, size: number, start: Three): Three {
  const small = cut(params, size, start, 1, true);
  const large = cut(params, size, start, -1, false);
  const combined = (from: Belief, a: Belief, b: Belief): Belief => {
    // A belief held exactly (no spread) learns nothing.
    if (from.variance === 0) return from;
    const p0 = 1 / from.variance;
    const pa = 1 / a.variance;
    const pb = 1 / b.variance;
    const precision = pa + pb - p0;
    return { mean: (pa * a.mean + pb * b.mean - p0 * from.mean) / precision, variance: 1 / precision };
  };
  return {
    offset: combined(start.offset, small.offset, large.offset),
    customer: combined(start.customer, small.customer, large.customer),
    tolerance: combined(start.tolerance, small.tolerance, large.tolerance),
  };
}

export type FitCounts = { small: number; trueToSize: number; large: number };

/** Golden-section search for the maximum of a function with one peak on [lo, hi]. */
function goldenMax(f: (x: number) => number, lo: number, hi: number, steps = 60): number {
  const phi = (Math.sqrt(5) - 1) / 2;
  let x1 = hi - phi * (hi - lo);
  let x2 = lo + phi * (hi - lo);
  let f1 = f(x1);
  let f2 = f(x2);
  for (let step = 0; step < steps; step += 1) {
    if (f1 < f2) {
      lo = x1;
      x1 = x2;
      f1 = f2;
      x2 = lo + phi * (hi - lo);
      f2 = f(x2);
    } else {
      hi = x2;
      x2 = x1;
      f2 = f1;
      x1 = hi - phi * (hi - lo);
      f1 = f(x1);
    }
  }
  return (lo + hi) / 2;
}

/**
 * An item from what reviewers said about its fit — the Amazon.com counts of
 * ADR-061 — when nobody's size is known.
 *
 * Reviewers mostly buy their usual size, so for them s − t ≈ 0 and z ≈ b + ε',
 * with ε' wider than ε by the spread of how well "their usual size" matches
 * (the customer prior). The offset and tolerance that best explain the
 * counts maximise the log-posterior
 *
 *   ℓ(b, τ) = n_s·log Φ((−h − b)/S) + n_f·log(Φ((h − b)/S) − Φ((−h − b)/S)) + n_l·log Φ((b − h)/S)
 *             − b²/2σ_b² − (τ − τ₀)²/2σ_τ²,        h = m + τ,  S² = β² + σ_c²
 *
 * Each term is the log of a normal probability of an interval whose ends are
 * linear in (b, τ), which is concave (Prékopa), so ℓ has one peak and
 * coordinate ascent — b by golden section with τ held, then τ with b held,
 * twelve rounds — reaches it. The spreads come from the curvature at the
 * peak (Laplace's approximation: the diagonal of −(∇²ℓ)⁻¹, measured by
 * central differences) and never exceed the priors: few remarks leave the
 * item near its prior and barely surer than it was.
 */
export function itemFromCounts(params: FitParams, counts: FitCounts, toleranceMean = 0): ItemBelief {
  const prior = unknownItem(params, toleranceMean);
  if (counts.small + counts.trueToSize + counts.large === 0) return prior;
  const spread = Math.sqrt(params.noise * params.noise + params.customerPrior * params.customerPrior);
  const logPosterior = (b: number, tau: number) => {
    const h = halfWidth(params, tau);
    const small = Math.max(cdf((-h - b) / spread), 1e-300);
    const large = Math.max(cdf((b - h) / spread), 1e-300);
    const fit = Math.max(1 - small - large, 1e-300);
    return (
      counts.small * Math.log(small) +
      counts.trueToSize * Math.log(fit) +
      counts.large * Math.log(large) -
      (b * b) / (2 * prior.offset.variance) -
      ((tau - toleranceMean) * (tau - toleranceMean)) / (2 * prior.tolerance.variance)
    );
  };
  const reach = params.margin + 4 * spread;
  let b = 0;
  let tau = toleranceMean;
  for (let round = 0; round < 12; round += 1) {
    b = goldenMax((x) => logPosterior(x, tau), -reach, reach);
    tau = goldenMax((x) => logPosterior(b, x), -(1 - MIN_HALF_WIDTH) * params.margin, reach);
  }
  const h = 1e-3;
  const f0 = logPosterior(b, tau);
  const fbb = (logPosterior(b + h, tau) - 2 * f0 + logPosterior(b - h, tau)) / (h * h);
  const ftt = (logPosterior(b, tau + h) - 2 * f0 + logPosterior(b, tau - h)) / (h * h);
  const fbt = (logPosterior(b + h, tau + h) - logPosterior(b + h, tau - h) - logPosterior(b - h, tau + h) + logPosterior(b - h, tau - h)) / (4 * h * h);
  const det = fbb * ftt - fbt * fbt;
  const peaked = fbb < 0 && det > 0;
  return {
    offset: { mean: b, variance: peaked ? Math.min(prior.offset.variance, -ftt / det) : prior.offset.variance },
    tolerance: { mean: tau, variance: peaked ? Math.min(prior.tolerance.variance, -fbb / det) : prior.tolerance.variance },
  };
}
