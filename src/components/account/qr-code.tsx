/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * QR code drawn as SVG squares, for adding the shop to an authenticator app.
 */

import { encode } from "uqr";

/**
 * uqr turns the text into the QR grid; each dark module becomes one square in
 * a single path. Drawn here rather than as uqr's SVG string so no markup is
 * injected, and in Dusk on white regardless of the page's theme: scanners need
 * dark on light and a quiet margin, which the viewBox leaves.
 */
export function QrCode({ value, label, size = 208 }: { value: string; label: string; size?: number }) {
  const { data } = encode(value, { ecc: "M", border: 0 });
  const count = data.length;
  const quiet = 2;
  let path = "";
  data.forEach((row, y) =>
    row.forEach((dark, x) => {
      if (dark) path += `M${x + quiet} ${y + quiet}h1v1h-1z`;
    }),
  );
  return (
    <svg role="img" aria-label={label} viewBox={`0 0 ${count + quiet * 2} ${count + quiet * 2}`} width={size} height={size} shapeRendering="crispEdges" className="rounded-plinth bg-white">
      <rect width="100%" height="100%" fill="white" />
      <path d={path} fill="currentColor" className="text-dusk" />
    </svg>
  );
}
