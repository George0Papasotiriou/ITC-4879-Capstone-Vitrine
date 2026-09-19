/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Chart geometry for the dashboards: round axis ticks and bar positions, drawn on the server as SVG.
 */

/**
 * The dashboards draw their charts on the server as SVG (docs/adr/018): no
 * chart library and no JavaScript in the browser. This module does the only
 * arithmetic they need, so it can be tested: an axis that ends on a round
 * number, and where each bar goes.
 */

/**
 * Tick values from 0 to a round number at or above `max`, about `count`
 * steps. The step is 1, 2, 2.5 or 5 times a power of ten, which is what
 * people read easily (0, 250, 500, 750, 1000 rather than 0, 237, 474…).
 */
export function niceTicks(max: number, count = 4): number[] {
  if (!(max > 0)) return [0, 1];
  const rough = max / count;
  const power = 10 ** Math.floor(Math.log10(rough));
  const step = ([1, 2, 2.5, 5, 10].find((factor) => factor * power >= rough) ?? 10) * power;
  const top = Math.ceil(max / step) * step;
  // Rounded to the step's precision, so 0.1 + 0.2 does not print as 0.30000000000000004.
  const digits = Math.max(0, -Math.floor(Math.log10(step)) + 1);
  return Array.from({ length: Math.round(top / step) + 1 }, (_, index) => Number((index * step).toFixed(digits)));
}

export type Bar = { x: number; width: number; y: number; height: number };

/**
 * Bars for `values` across `width`, rising from the bottom of `height`,
 * scaled so that `top` (the last tick) reaches the top. A small gap separates
 * bars, never less than one unit; a non-zero value is at least one unit tall
 * so a quiet day still shows it happened.
 */
export function barLayout(values: readonly number[], { width, height, top, gap = 0.2 }: { width: number; height: number; top: number; gap?: number }): Bar[] {
  if (values.length === 0) return [];
  const slot = width / values.length;
  const spacing = Math.max(1, slot * gap);
  const barWidth = Math.max(1, slot - spacing);
  return values.map((value, index) => {
    const scaled = top <= 0 ? 0 : (Math.max(0, value) / top) * height;
    const barHeight = value > 0 ? Math.max(1, scaled) : 0;
    return { x: index * slot + spacing / 2, width: barWidth, y: height - barHeight, height: barHeight };
  });
}
