# Vitrine — AI-native e-shop (ITC 4949 Capstone)
# Copyright (c) 2026 George Papasotiriou. All rights reserved.
# Author: George Papasotiriou <g.papasotiriou@acg.edu>
# Project started: 2026-09-12
#
# The normal distribution's functions the Fit Engine needs — the same code as src/lib/fit/size/gaussian.ts, line for line.

"""The normal functions of the Fit Engine (docs/adr/064).

erfc is Numerical Recipes' Chebyshev fit ("erfcc", fractional error below
1.2e-7) rather than math.erfc, so that the shop's TypeScript and this
evaluation compute the very same numbers (src/lib/fit/size/parity.test.ts).
"""

from __future__ import annotations

import math

SQRT2 = math.sqrt(2.0)
INV_SQRT_2PI = 1.0 / math.sqrt(2.0 * math.pi)
TINY = 1e-12


def erfc(x: float) -> float:
    z = abs(x)
    t = 1.0 / (1.0 + 0.5 * z)
    r = t * math.exp(
        -z * z
        - 1.26551223
        + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277))))))))
    )
    return r if x >= 0 else 2.0 - r


def pdf(x: float) -> float:
    return INV_SQRT_2PI * math.exp(-0.5 * x * x)


def cdf(x: float) -> float:
    return 0.5 * erfc(-x / SQRT2)


def truncated_moments(a: float, b: float) -> tuple[float, float]:
    """A standard normal cut to [a, b]: its mean (v) and 1 minus its variance (w)."""
    pa = 0.0 if a == -math.inf else pdf(a)
    pb = 0.0 if b == math.inf else pdf(b)
    ca = 0.0 if a == -math.inf else cdf(a)
    cb = 1.0 if b == math.inf else cdf(b)
    z = cb - ca
    if z < TINY:
        near = b if a == -math.inf else a if b == math.inf else (a if abs(a) < abs(b) else b)
        return near, 1.0
    apa = 0.0 if a == -math.inf else a * pa
    bpb = 0.0 if b == math.inf else b * pb
    v = (pa - pb) / z
    w = v * v - (apa - bpb) / z
    return v, min(1.0, max(0.0, w))
