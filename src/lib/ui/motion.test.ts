/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Unit tests for the motion system: script and stylesheet keep one rhythm, the flight's arc, and reduced motion in both places.
 */

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { arcPoints } from "@/lib/ui/fly-to-cart";
import { DURATION, EASE } from "@/lib/ui/motion";

const css = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");
const token = (name: string) => css.match(new RegExp(`--${name}:\\s*([^;]+);`))?.[1]?.trim();

describe("one rhythm for the whole shop", () => {
  it("gives script the same durations and curves as the stylesheet", () => {
    for (const [name, ms] of Object.entries(DURATION)) expect(token(`duration-${name}`)).toBe(`${ms}ms`);
    expect(token("ease-standard")).toBe(EASE.standard);
    expect(token("ease-exit")).toBe(EASE.exit);
    expect(token("ease-spring")).toBe(EASE.spring);
  });

  it("makes every exit faster than its entrance", () => {
    // Each overlay leaves on a shorter duration than it arrives on (docs/adr/031).
    for (const utility of ["animate-overlay", "animate-sheet-right", "animate-sheet-bottom", "animate-toast", "animate-dock"]) {
      const block = css.slice(css.indexOf(`@utility ${utility} {`));
      const open = block.match(/data-state="open"\] \{ animation: [\w-]+ var\(--duration-(\w+)\)/)?.[1];
      const closed = block.match(/data-state="closed"\] \{ animation: [\w-]+ var\(--duration-(\w+)\)/)?.[1];
      expect(open, utility).toBeDefined();
      expect(DURATION[closed as keyof typeof DURATION], utility).toBeLessThan(DURATION[open as keyof typeof DURATION]);
    }
  });

  it("switches motion off for reduced motion, whether the system or the shopper asked", () => {
    expect(css).toContain(':root[data-motion="reduce"] *');
    expect(css).toContain(':root[data-motion="reduce"]::view-transition-group(*)');
    expect(css).toContain(':root:not([data-motion="full"])::view-transition-group(*)');
    // The one loop in the shop is the listening light; skeletons no longer pulse.
    expect(css.match(/infinite/g)?.length).toBe(1);
  });
});

describe("the flight to the cart", () => {
  const from = { x: 100, y: 500 };
  const to = { x: 900, y: 40 };

  it("starts at the piece and lands on the cart", () => {
    const points = arcPoints(from, to);
    expect(points[0]).toEqual(from);
    expect(points.at(-1)!.x).toBeCloseTo(to.x, 6);
    expect(points.at(-1)!.y).toBeCloseTo(to.y, 6);
  });

  it("lifts above the straight line, then drops into the cart", () => {
    const points = arcPoints(from, to, 20);
    const middle = points[10]!;
    const straight = (from.y + to.y) / 2;
    expect(middle.y).toBeLessThan(straight);
    // Moves steadily across: never doubles back.
    for (let index = 1; index < points.length; index += 1) expect(points[index]!.x).toBeGreaterThan(points[index - 1]!.x);
  });

  it("keeps a long flight's lift modest", () => {
    const far = arcPoints({ x: 0, y: 800 }, { x: 3000, y: 800 }, 2);
    // The curve's top is half the control lift at most: 160px caps the control point.
    expect(800 - far[1]!.y).toBeLessThanOrEqual(80);
  });
});
