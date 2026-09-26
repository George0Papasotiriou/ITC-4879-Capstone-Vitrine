/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * The piece flying into the cart: a copy of its photograph travels on an arc to the cart count.
 */

import { DURATION, EASE } from "@/lib/ui/motion";
import { prefersReducedMotion } from "@/lib/ui/use-reduced-motion";

/**
 * docs/adr/031. Adding to the cart is the shop's most important action, and
 * until now its only answer was a sheet. The flight shows where the piece
 * went: a copy of its photograph lifts off, travels on a shallow arc and lands
 * in the cart, and the count there ticks up as it lands.
 *
 * The browser's own Web Animations API does it: transform and opacity only, on
 * a copy fixed above the page, removed when it lands. No library, nothing
 * moves in the layout, and the page stays usable throughout. With reduced
 * motion, or when no cart is visible (checkout hides it), nothing flies and
 * the count simply changes.
 */

/** The visible cart count the flight lands on: the header on wide screens, the bottom bar on phones. */
function visibleTarget(): HTMLElement | null {
  const candidates = [...document.querySelectorAll<HTMLElement>("[data-cart-target]")];
  return (
    candidates.find((element) => {
      const box = element.getBoundingClientRect();
      return box.width > 0 && box.height > 0 && box.bottom > 0 && box.top < window.innerHeight;
    }) ?? null
  );
}

/**
 * The arc between two points: a quadratic curve whose control point sits above
 * the midpoint, so the piece lifts before it drops into the cart. Sampled into
 * keyframes, since CSS offset paths are not needed for a curve this simple.
 */
export function arcPoints(from: { x: number; y: number }, to: { x: number; y: number }, steps = 12): { x: number; y: number }[] {
  const lift = Math.min(160, Math.hypot(to.x - from.x, to.y - from.y) * 0.35);
  const control = { x: (from.x + to.x) / 2, y: Math.min(from.y, to.y) - lift };
  return Array.from({ length: steps + 1 }, (_, index) => {
    const t = index / steps;
    const u = 1 - t;
    return { x: u * u * from.x + 2 * u * t * control.x + t * t * to.x, y: u * u * from.y + 2 * u * t * control.y + t * t * to.y };
  });
}

/**
 * Flies a copy of `source` (the piece's photograph) to the cart count.
 * Resolves when it lands — at once when nothing can fly — so the caller can
 * open the mini cart or tick the count at the right moment.
 */
export function flyToCart(source: Element | null | undefined): Promise<void> {
  if (typeof window === "undefined" || source === null || source === undefined || prefersReducedMotion()) return Promise.resolve();
  const target = visibleTarget();
  const image = source instanceof HTMLImageElement ? source : source.querySelector("img");
  if (target === null || image === null) return Promise.resolve();

  const from = image.getBoundingClientRect();
  const to = target.getBoundingClientRect();
  if (from.width === 0 || from.height === 0) return Promise.resolve();

  // A square copy, as large as the photograph's shorter side, capped so a hero
  // image does not become a wall crossing the screen.
  const size = Math.min(160, from.width, from.height);
  const copy = document.createElement("img");
  copy.src = image.currentSrc || image.src;
  copy.alt = "";
  copy.setAttribute("aria-hidden", "true");
  Object.assign(copy.style, {
    position: "fixed",
    left: "0px",
    top: "0px",
    width: `${size}px`,
    height: `${size}px`,
    objectFit: "contain",
    borderRadius: "8px",
    background: "var(--color-plinth)",
    boxShadow: "0 12px 32px -12px color-mix(in oklab, var(--color-dusk) 40%, transparent)",
    pointerEvents: "none",
    zIndex: "80",
    willChange: "transform, opacity",
  });
  document.body.append(copy);

  const start = { x: from.left + from.width / 2 - size / 2, y: from.top + from.height / 2 - size / 2 };
  const end = { x: to.left + to.width / 2 - size / 2, y: to.top + to.height / 2 - size / 2 };
  const points = arcPoints(start, end);
  const keyframes = points.map((point, index) => {
    const t = index / (points.length - 1);
    // It shrinks as it travels, and fades only in the last stretch, into the count.
    const scale = 1 - 0.82 * t;
    return { transform: `translate(${point.x}px, ${point.y}px) scale(${scale})`, opacity: t < 0.8 ? 1 : 1 - (t - 0.8) / 0.2 };
  });

  const flight = copy.animate(keyframes, { duration: DURATION.stage, easing: EASE.standard, fill: "forwards" });
  return flight.finished
    .catch(() => undefined)
    .then(() => {
      copy.remove();
    });
}
