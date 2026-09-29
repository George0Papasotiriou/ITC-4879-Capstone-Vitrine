/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * CIEDE2000: how different two colours look to a person, used to measure the room-light harmonisation.
 */

import type { Lab } from "@/lib/optimize/color";

/**
 * docs/adr/042. The CIE's 2000 colour difference (Sharma, Wu and Dalal 2005,
 * "The CIEDE2000 color-difference formula"). Plain Euclidean distance in
 * CIELAB overstates differences in saturated colours and misjudges blues;
 * CIEDE2000 corrects lightness, chroma and hue separately and adds a rotation
 * term for blue. A difference of about 1 is just noticeable, 2–3 is visible
 * side by side, 10 is a different colour.
 *
 * Written from the paper's equations (numbered as there), with kL = kC = kH = 1,
 * and checked against the paper's published test pairs.
 */
export function deltaE2000(first: Lab, second: Lab): number {
  const { L: L1, a: a1, b: b1 } = first;
  const { L: L2, a: a2, b: b2 } = second;
  const rad = Math.PI / 180;

  // (2)–(3): chroma, and the a-axis rescaled by G so neutral greys behave.
  const C1 = Math.hypot(a1, b1);
  const C2 = Math.hypot(a2, b2);
  const Cbar = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cbar ** 7 / (Cbar ** 7 + 25 ** 7)));
  const a1p = (1 + G) * a1;
  const a2p = (1 + G) * a2;
  const C1p = Math.hypot(a1p, b1);
  const C2p = Math.hypot(a2p, b2);
  const hue = (b: number, ap: number) => (b === 0 && ap === 0 ? 0 : ((Math.atan2(b, ap) / rad) + 360) % 360);
  const h1p = hue(b1, a1p);
  const h2p = hue(b2, a2p);

  // (8)–(10): the three differences.
  const dLp = L2 - L1;
  const dCp = C2p - C1p;
  let dhp = 0;
  if (C1p * C2p !== 0) {
    dhp = h2p - h1p;
    if (dhp > 180) dhp -= 360;
    else if (dhp < -180) dhp += 360;
  }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp / 2) * rad);

  // (12)–(22): weights for lightness, chroma and hue, and the blue rotation.
  const Lbarp = (L1 + L2) / 2;
  const Cbarp = (C1p + C2p) / 2;
  let hbarp = h1p + h2p;
  if (C1p * C2p !== 0) {
    if (Math.abs(h1p - h2p) <= 180) hbarp = (h1p + h2p) / 2;
    else hbarp = h1p + h2p < 360 ? (h1p + h2p + 360) / 2 : (h1p + h2p - 360) / 2;
  }
  const T = 1 - 0.17 * Math.cos((hbarp - 30) * rad) + 0.24 * Math.cos(2 * hbarp * rad) + 0.32 * Math.cos((3 * hbarp + 6) * rad) - 0.2 * Math.cos((4 * hbarp - 63) * rad);
  const dTheta = 30 * Math.exp(-(((hbarp - 275) / 25) ** 2));
  const RC = 2 * Math.sqrt(Cbarp ** 7 / (Cbarp ** 7 + 25 ** 7));
  const SL = 1 + (0.015 * (Lbarp - 50) ** 2) / Math.sqrt(20 + (Lbarp - 50) ** 2);
  const SC = 1 + 0.045 * Cbarp;
  const SH = 1 + 0.015 * Cbarp * T;
  const RT = -Math.sin(2 * dTheta * rad) * RC;

  return Math.sqrt((dLp / SL) ** 2 + (dCp / SC) ** 2 + (dHp / SH) ** 2 + RT * (dCp / SC) * (dHp / SH));
}
