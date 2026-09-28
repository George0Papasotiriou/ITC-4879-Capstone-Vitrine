/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Where the point-by-number badges go: beside each control, never over its words or another's.
 */

/**
 * docs/adr/032, placement revised in docs/adr/034. A badge laid over a
 * control's top-left corner hid its first letters ("Add to cart" read as
 * "d to cart"). Each badge now tries, in order, four places *outside* its
 * control — above its left end, then to its left, then below its left end,
 * then to its right — and takes the first that stays on screen and covers
 * neither another control nor a badge already placed. When all four are
 * taken it sits on the control's top-right corner — over the end of the
 * control, where there is padding rather than the start of its words — and
 * only when even that is taken does it fall back to the top-left corner,
 * nudged along until it clears the other badges. Controls are placed in
 * reading order, so earlier numbers get the first choice.
 *
 * A form field is the exception: above it is its label, whose first letters
 * matter just as much, so a field's badge goes on its right end first (over
 * the empty end of the box or its arrow).
 */

export type Box = { left: number; top: number; width: number; height: number };
/** A control's box; `field` for a text field, list or select, whose label sits above it. */
export type Control = Box & { field?: boolean };
export type Spot = { x: number; y: number };

/** Where a control's words begin: its left end, 40 px or a third of it, whichever is less. */
const startOf = (box: Box): Box => ({ ...box, width: Math.min(40, box.width / 3) });

const overlaps = (a: Box, b: Box) => a.left < b.left + b.width && b.left < a.left + a.width && a.top < b.top + b.height && b.top < a.top + a.height;

export function placeBadges(controls: readonly Control[], view: { width: number; height: number }, badge: { width: number; height: number }, gap = 2): Spot[] {
  const placed: Box[] = [];
  const inView = (box: Box) => box.left >= 0 && box.top >= 0 && box.left + box.width <= view.width && box.top + box.height <= view.height;

  return controls.map((control, index) => {
    const at = (x: number, y: number): Box => ({ left: x, top: y, width: badge.width, height: badge.height });
    const candidates = [
      at(control.left, control.top - badge.height - gap),
      at(control.left - badge.width - gap, control.top + (control.height - badge.height) / 2),
      at(control.left, control.top + control.height + gap),
      at(control.left + control.width + gap, control.top + (control.height - badge.height) / 2),
    ];
    const free = candidates.find(
      (spot) => inView(spot) && !placed.some((other) => overlaps(spot, other)) && !controls.some((other, position) => position !== index && overlaps(spot, other)),
    );
    const endCorner = at(control.left + control.width - badge.width, control.top - badge.height / 2);
    // The end corner may lean over a neighbour, but never over the start of its words.
    const endFree = inView(endCorner) && !placed.some((other) => overlaps(endCorner, other)) && !controls.some((other, position) => position !== index && overlaps(endCorner, startOf(other)));
    let chosen = control.field === true && endFree ? endCorner : (free ?? (endFree ? endCorner : undefined));
    if (chosen === undefined) {
      // The old corner, clamped to the screen, moved right until it clears the badges already there.
      chosen = at(Math.max(0, Math.min(view.width - badge.width, control.left - badge.width / 3)), Math.max(0, Math.min(view.height - badge.height, control.top - badge.height / 2)));
      for (let step = 0; step < 6 && placed.some((other) => overlaps(chosen!, other)); step += 1) {
        chosen = at(Math.min(view.width - badge.width, chosen.left + badge.width + gap), chosen.top);
      }
    }
    placed.push(chosen);
    return { x: Math.round(chosen.left), y: Math.round(chosen.top) };
  });
}
