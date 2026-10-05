# Vitrine — AI-native e-shop (ITC 4949 Capstone)
# Copyright (c) 2026 George Papasotiriou. All rights reserved.
# Author: George Papasotiriou <g.papasotiriou@acg.edu>
# Project started: 2026-09-12
#
# The Fit Engine's ordinal model and its assumed-density learning — the same code as src/lib/fit/size/ordinal.ts.

"""The Fit Engine's model (docs/adr/064); the derivation is in ordinal.ts.

z = (s + b - t) + eps, eps ~ N(0, noise^2); small if z < -(margin + tau),
large if z > margin + tau, fit between. b (how the item runs), tau (how
forgiving it is) and t (the customer's true size) are Gaussian beliefs,
learned by moment matching after each outcome, one edge of the fit band at a
time (both edges, from the same start, for a fit).
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from .gaussian import cdf, truncated_moments

OUTCOMES = ("small", "fit", "large")


@dataclass(frozen=True)
class FitParams:
    margin: float
    noise: float
    item_prior: float
    tolerance_prior: float
    customer_prior: float
    drift: float

    def as_json(self) -> dict[str, float]:
        return {
            "margin": self.margin,
            "noise": self.noise,
            "itemPrior": self.item_prior,
            "tolerancePrior": self.tolerance_prior,
            "customerPrior": self.customer_prior,
            "drift": self.drift,
        }

    @staticmethod
    def from_json(values: dict[str, float]) -> "FitParams":
        return FitParams(values["margin"], values["noise"], values["itemPrior"], values["tolerancePrior"], values["customerPrior"], values["drift"])


Belief = tuple[float, float]  # (mean, variance)
Item = tuple[Belief, Belief]  # (offset, tolerance)

# The narrowest the fit band may become, as a share of the margin: an item can be unforgiving, never impossible to fit.
MIN_HALF_WIDTH = 0.05


def unknown_item(params: FitParams, tolerance_mean: float = 0.0) -> Item:
    return (0.0, params.item_prior * params.item_prior), (tolerance_mean, params.tolerance_prior * params.tolerance_prior)


def half_width(params: FitParams, tolerance_mean: float) -> float:
    return max(params.margin + tolerance_mean, MIN_HALF_WIDTH * params.margin)


def predict(params: FitParams, size: float, item: Item, customer: Belief) -> tuple[float, float, float]:
    """(P(small), P(fit), P(large))."""
    offset, tolerance = item
    mean = size + offset[0] - customer[0]
    sd = math.sqrt(params.noise * params.noise + offset[1] + customer[1] + tolerance[1])
    h = half_width(params, tolerance[0])
    small = cdf((-h - mean) / sd)
    large = cdf((mean - h) / sd)
    return small, max(0.0, 1.0 - small - large), large


def _cut(params: FitParams, size: float, offset: Belief, customer: Belief, tolerance: Belief, side: int, above: bool) -> tuple[Belief, Belief, Belief]:
    """One side of the fit band, learned. side +1: d = z + margin + tau (the small edge); side -1: d = z - margin - tau (the large edge). above: d > 0 was seen, else d < 0."""
    mean = size + offset[0] - customer[0] + side * (params.margin + tolerance[0])
    c2 = params.noise * params.noise + offset[1] + customer[1] + tolerance[1]
    c = math.sqrt(c2)
    alpha = -mean / c
    v, w = truncated_moments(alpha, math.inf) if above else truncated_moments(-math.inf, alpha)

    def moved(belief: Belief, sign: int) -> Belief:
        return belief[0] + sign * (belief[1] / c) * v, belief[1] * (1.0 - (belief[1] / c2) * w)

    return moved(offset, 1), moved(customer, -1), moved(tolerance, side)


def _both_edges(params: FitParams, size: float, offset: Belief, customer: Belief, tolerance: Belief) -> tuple[Belief, Belief, Belief]:
    """A "fits": both edges learned from the same starting beliefs, their lessons multiplied together (precisions add)."""
    first = _cut(params, size, offset, customer, tolerance, 1, True)
    second = _cut(params, size, offset, customer, tolerance, -1, False)

    def combined(start: Belief, a: Belief, b: Belief) -> Belief:
        if start[1] == 0.0:
            return start
        p0, pa, pb = 1.0 / start[1], 1.0 / a[1], 1.0 / b[1]
        precision = pa + pb - p0
        return (pa * a[0] + pb * b[0] - p0 * start[0]) / precision, 1.0 / precision

    return combined(offset, first[0], second[0]), combined(customer, first[1], second[1]), combined(tolerance, first[2], second[2])


def update(params: FitParams, size: float, item: Item, customer: Belief, outcome: str) -> tuple[Item, Belief]:
    """The item's and the customer's beliefs after one outcome. Drift widens the offset and the customer, not the tolerance."""
    drift2 = params.drift * params.drift
    offset = (item[0][0], item[0][1] + drift2)
    tolerance = item[1]
    t = (customer[0], customer[1] + drift2)
    if outcome == "small":
        offset, t, tolerance = _cut(params, size, offset, t, tolerance, 1, False)
    elif outcome == "large":
        offset, t, tolerance = _cut(params, size, offset, t, tolerance, -1, True)
    else:
        offset, t, tolerance = _both_edges(params, size, offset, t, tolerance)
    return (offset, tolerance), t


def _golden(f, lo: float, hi: float, steps: int = 60) -> float:
    phi = (math.sqrt(5.0) - 1.0) / 2.0
    x1 = hi - phi * (hi - lo)
    x2 = lo + phi * (hi - lo)
    f1, f2 = f(x1), f(x2)
    for _ in range(steps):
        if f1 < f2:
            lo, x1, f1 = x1, x2, f2
            x2 = lo + phi * (hi - lo)
            f2 = f(x2)
        else:
            hi, x2, f2 = x2, x1, f1
            x1 = hi - phi * (hi - lo)
            f1 = f(x1)
    return (lo + hi) / 2.0


def item_from_counts(params: FitParams, small: float, true_to_size: float, large: float, tolerance_mean: float = 0.0) -> Item:
    """An item from reviewers' fit remarks: MAP of (offset, tolerance) by coordinate ascent, spreads by Laplace."""
    prior = unknown_item(params, tolerance_mean)
    if small + true_to_size + large == 0:
        return prior
    spread = math.sqrt(params.noise * params.noise + params.customer_prior * params.customer_prior)
    b_var, tau_var = prior[0][1], prior[1][1]

    def log_posterior(b: float, tau: float) -> float:
        h = half_width(params, tau)
        p_small = max(cdf((-h - b) / spread), 1e-300)
        p_large = max(cdf((b - h) / spread), 1e-300)
        p_fit = max(1.0 - p_small - p_large, 1e-300)
        return (
            small * math.log(p_small)
            + true_to_size * math.log(p_fit)
            + large * math.log(p_large)
            - (b * b) / (2.0 * b_var)
            - (tau - tolerance_mean) ** 2 / (2.0 * tau_var)
        )

    reach = params.margin + 4.0 * spread
    b, tau = 0.0, tolerance_mean
    for _ in range(12):
        b = _golden(lambda x: log_posterior(x, tau), -reach, reach)
        tau = _golden(lambda x: log_posterior(b, x), -(1.0 - MIN_HALF_WIDTH) * params.margin, reach)
    h = 1e-3
    f0 = log_posterior(b, tau)
    f_bb = (log_posterior(b + h, tau) - 2.0 * f0 + log_posterior(b - h, tau)) / (h * h)
    f_tt = (log_posterior(b, tau + h) - 2.0 * f0 + log_posterior(b, tau - h)) / (h * h)
    f_bt = (log_posterior(b + h, tau + h) - log_posterior(b + h, tau - h) - log_posterior(b - h, tau + h) + log_posterior(b - h, tau - h)) / (4.0 * h * h)
    det = f_bb * f_tt - f_bt * f_bt
    if f_bb < 0 and det > 0:
        var_b = min(b_var, -f_tt / det)
        var_tau = min(tau_var, -f_bb / det)
    else:
        var_b, var_tau = b_var, tau_var
    return (b, var_b), (tau, var_tau)
