/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * The shop's own address for a product photograph, wherever the photograph is kept.
 */

/**
 * docs/adr/035 addendum. The large catalogue's photographs stay in the ABO
 * bucket and reach pages through Next.js's image optimizer. `next/image` does
 * that by itself; this is for the places that load a photograph by address —
 * the room planner draws it on a canvas (which a cross-origin image would
 * taint, and which the room page's cross-origin isolation would block), and
 * the 360° viewer preloads its frames. The width must be one of Next.js's
 * configured sizes (640, 750, 828, 1080, 1200, 1920 …), and the quality one
 * it allows: Next.js 16 refuses any other than `images.qualities` (75 unless
 * configured), where `next/image` would quietly round it.
 */
const QUALITY = 75;

export function sameOriginImage(src: string, width: 640 | 750 | 828 | 1080 | 1200 | 1920): string {
  return src.startsWith("https://") ? `/_next/image?url=${encodeURIComponent(src)}&w=${width}&q=${QUALITY}` : src;
}
