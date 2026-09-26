/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * The motion tokens for animation driven from script, mirroring the ones in globals.css.
 */

/**
 * docs/adr/031. Most motion in the shop is CSS and reads the tokens in
 * globals.css. The few animations run from script — the flight to the cart,
 * the Spotlight — take the same values from here, so the whole shop keeps one
 * rhythm. A test checks the two lists agree.
 */

/** Milliseconds, as `--duration-*` in globals.css. */
export const DURATION = { instant: 90, quick: 160, calm: 280, stage: 560 } as const;

/** Arriving settles; leaving accelerates away. As `--ease-standard` and `--ease-exit`. */
export const EASE = {
  standard: "cubic-bezier(0.2, 0, 0, 1)",
  exit: "cubic-bezier(0.4, 0, 1, 1)",
  /** As `--ease-spring`: a critically damped settle with a 2% overshoot. */
  spring:
    "linear(0, 0.013 0.6%, 0.05 1.2%, 0.2 2.6%, 0.472 5.1%, 0.667 7.3%, 0.81 9.6%, 0.906 12%, 0.966 14.6%, 1.002 17.6%, 1.02 21.1%, 1.022 25.9%, 1.011 33.2%, 1.002 43.5%, 0.999 60%, 1)",
} as const;

/** For the `motion` library: the Spotlight's glide, and a quicker one for small things. */
export const SPRING = {
  glide: { type: "spring", stiffness: 170, damping: 26 },
  snap: { type: "spring", stiffness: 420, damping: 32 },
} as const;
