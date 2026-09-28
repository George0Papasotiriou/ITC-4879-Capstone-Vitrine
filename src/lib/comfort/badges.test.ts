/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Tests for placing the point-by-number badges clear of the controls' words.
 */

import { describe, expect, it } from "vitest";

import { placeBadges, type Box } from "@/lib/comfort/badges";

const view = { width: 1280, height: 800 };
const badge = { width: 24, height: 18 };
const cover = (spot: { x: number; y: number }, box: Box) =>
  spot.x < box.left + box.width && box.left < spot.x + badge.width && spot.y < box.top + box.height && box.top < spot.y + badge.height;

describe("placeBadges", () => {
  it("puts a badge above its control's left end, where it hides none of its words", () => {
    const button = { left: 400, top: 300, width: 160, height: 44 };
    expect(placeBadges([button], view, badge)).toEqual([{ x: 400, y: 280 }]);
  });

  it("moves to the left when there is no room above (a header at the top of the screen), and below when the gap is too narrow", () => {
    const first = { left: 900, top: 10, width: 80, height: 44 };
    const second = { left: 1000, top: 10, width: 80, height: 44 };
    const [a, b] = placeBadges([first, second], view, badge);
    expect(a).toEqual({ x: 874, y: 23 });
    // Only 20 px between the buttons: a 24 px badge there would cover the first, so it goes below.
    expect(b).toEqual({ x: 1000, y: 56 });
    expect(cover(a!, first) || cover(a!, second) || cover(b!, first) || cover(b!, second)).toBe(false);
  });

  it("never covers another control or another badge, down a list of stacked links", () => {
    const links = Array.from({ length: 6 }, (_, index) => ({ left: 0, top: 100 + index * 30, width: 300, height: 26 }));
    const spots = placeBadges(links, view, badge);
    for (const [index, spot] of spots.entries()) {
      for (const link of links) expect(cover(spot, link), `badge ${index + 1}`).toBe(false);
      for (const [other, second] of spots.entries()) {
        if (other !== index) expect(Math.abs(spot.x - second.x) >= badge.width || Math.abs(spot.y - second.y) >= badge.height, `badges ${index + 1} and ${other + 1}`).toBe(true);
      }
    }
  });

  it("keeps every badge on screen, falling back to the corner only when boxed in", () => {
    // A control filling the whole screen has nowhere outside it.
    const [spot] = placeBadges([{ left: 0, top: 0, width: 1280, height: 800 }], view, badge);
    expect(spot!.x).toBeGreaterThanOrEqual(0);
    expect(spot!.y).toBeGreaterThanOrEqual(0);
  });
});

describe("placeBadges when boxed in", () => {
  it("sits on the end of the control rather than its first letters", () => {
    // A wide control with neighbours hard against it above, below and to each side.
    const control = { left: 100, top: 100, width: 300, height: 40 };
    const around = [
      { left: 100, top: 60, width: 300, height: 38 },
      { left: 100, top: 142, width: 300, height: 38 },
      { left: 40, top: 100, width: 58, height: 40 },
      { left: 402, top: 100, width: 58, height: 40 },
    ];
    const [spot] = placeBadges([control, ...around], view, badge);
    // Over the right end, never over the left third where the words start.
    expect(spot!.x).toBeGreaterThan(control.left + control.width / 2);
  });
});

describe("placeBadges on a form field", () => {
  it("goes on the field's right end, leaving its label above readable", () => {
    const select = { left: 48, top: 450, width: 684, height: 86, field: true };
    const [spot] = placeBadges([select], view, badge);
    expect(spot!.x).toBe(48 + 684 - badge.width);
    expect(spot!.y).toBe(450 - badge.height / 2);
  });
});
