/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Beds: platform, upholstered, wooden, metal, canopy and sleigh beds, daybeds and bunks — dressed in plain bedding to read as beds.
 */

import { block, clamp, frameOf, legStyleOf, metalFrame, upholsteryOf, type Context } from "@/lib/catalog/model/context";
import { cushion, cylinder, extrude, roundedBox, tube, type Tufting } from "@/lib/catalog/model/geometry";
import { bedding, type MaterialSpec } from "@/lib/catalog/model/materials";
import { compose, rotationX, translation, type Vec2 } from "@/lib/catalog/model/mesh";
import { Build, buttons, leg, placeLeg } from "@/lib/catalog/model/parts";
import { fabricOf } from "@/lib/catalog/model/words";

/**
 * docs/adr/058. A bed frame alone reads as a crate. So every bed is dressed
 * the same plain way — a white mattress, a duvet turned back, two or three
 * pillows — and the viewer says so ("bedding shown for scale"). The frame is
 * the piece: its headboard (upholstered and tufted or channelled, panelled
 * wood, slatted, metal spindles), rails, legs, a footboard where the words
 * name one, posts and a canopy frame on a canopy bed.
 */

export function buildBeds(c: Context): Build {
  const { words } = c;
  if (words.has("daybed", "day bed")) return daybed(c);
  if (words.has("bunk", "loft bed")) return bunk(c);
  return bed(c);
}

type Headboard = "upholstered" | "slats" | "panel" | "spindles" | "none";

function headboardOf(c: Context): Headboard {
  const { words } = c;
  if (words.has("headboard only") === false && words.has("no headboard", "without headboard")) return "none";
  if (words.has("upholstered", "tufted", "channel", "linen", "velvet", "fabric", "wingback", "leather", "boucle") || fabricOf(words) !== "weave" || words.material("fabric", "velvet", "linen", "leather")) return "upholstered";
  if (metalFrame(c) || words.has("metal", "iron", "spindle")) return "spindles";
  if (words.has("slat", "slatted", "mission", "farmhouse", "rustic")) return "slats";
  return "panel";
}

function dressing(b: Build, area: { width: number; length: number; top: number; headZ: number }): void {
  const linen = bedding();
  const duvet = bedding({ r: 232, g: 228, b: 220 });
  const mattressH = 0.22;
  const mattress = roundedBox({ size: [area.width, mattressH, area.length], radius: 0.06, segments: 4, step: 0.2 });
  b.add(mattress.translate([0, area.top + mattressH / 2, area.headZ + area.length / 2]), linen);
  // The duvet: over the lower two-thirds, hanging a little over the sides, the top edge turned back.
  const cover = cushion({ size: [area.width + 0.08, 0.07, area.length * 0.7], radius: 0.035, crown: 0.02, face: "top" });
  b.add(cover.mesh.translate([0, area.top + mattressH + 0.025, area.headZ + area.length * 0.65 + 0.02]), duvet);
  const fold = cushion({ size: [area.width + 0.06, 0.05, 0.18], radius: 0.025, crown: 0.01, face: "top" });
  b.add(fold.mesh.translate([0, area.top + mattressH + 0.06, area.headZ + area.length * 0.3 + 0.08]), duvet);
  // Pillows, propped against the headboard.
  const count = area.width > 1.75 ? 3 : area.width > 1.1 ? 2 : 1;
  const each = Math.min(0.66, (area.width - 0.06) / count);
  for (let i = 0; i < count; i += 1) {
    const pillow = cushion({ size: [each - 0.03, 0.14, 0.42], radius: 0.06, crown: 0.05, face: "top" });
    const x = -((count - 1) * each) / 2 + i * each;
    b.add(pillow.mesh, linen, compose(translation([x, area.top + mattressH + 0.1, area.headZ + 0.24]), rotationX(-0.55)));
  }
}

function bed(c: Context): Build {
  const b = new Build();
  const { w, d, h } = c.size;
  const { words } = c;
  const head = headboardOf(c);
  const frame = frameOf(c);
  const skin = upholsteryOf(c);
  const body: MaterialSpec = head === "upholstered" ? skin : frame;
  const platform = words.has("platform", "low profile", "floor") || h < 0.7;
  const legH = platform ? 0.06 : clamp(h * 0.15, 0.08, 0.2);
  const railTop = platform ? clamp(h * 0.3, 0.2, 0.3) : clamp(h * 0.35, 0.28, 0.4);
  const headT = head === "upholstered" ? clamp(d * 0.05, 0.08, 0.14) : 0.06;
  const headZ = -d / 2 + headT;
  const foot = words.has("footboard", "sleigh", "canopy", "four poster", "poster") || head === "spindles";
  const footT = foot ? 0.05 : 0;
  // Rails and the slatted platform.
  for (const side of [-1, 1]) block(b, body, [side * (w / 2 - 0.025), (legH + railTop) / 2, (headZ + d / 2 - footT) / 2], [0.05, railTop - legH, d / 2 - headZ - footT], 0.008, 2);
  block(b, body, [0, (legH + railTop) / 2, d / 2 - footT - 0.025], [w, railTop - legH, 0.05], 0.008, 0);
  block(b, frameOf(c, { preferMetal: false }), [0, railTop - 0.03, (headZ + d / 2) / 2], [w - 0.1, 0.02, d / 2 - headZ - 0.1], 0.002, 2);

  // The headboard.
  const headH = h - legH;
  if (head === "upholstered") {
    const tufting: Tufting = words.has("tufted", "button") ? { kind: "buttons", spacing: 0.14, depth: 0.03 } : words.has("channel", "channeled") ? { kind: "channels", count: Math.max(5, Math.round(w / 0.15)), depth: 0.025 } : { kind: "none" };
    const panel = cushion({ size: [w, headH, headT], radius: clamp(headT * 0.4, 0.03, 0.05), crown: 0.015, face: "front", tufting });
    b.add(panel.mesh.translate([0, legH + headH / 2, -d / 2 + headT / 2]), skin);
    if (panel.buttons.length > 0) b.add(buttons(panel.buttons).translate([0, legH + headH / 2, -d / 2 + headT / 2]), skin);
    if (words.has("wingback", "wing")) {
      for (const side of [-1, 1]) {
        const wing = cushion({ size: [0.1, headH * 0.75, 0.32], radius: 0.04, crown: 0.01, face: "top" });
        b.add(wing.mesh.translate([side * (w / 2 - 0.05), legH + headH * 0.62, -d / 2 + 0.16]), skin);
      }
    }
  } else if (head === "slats") {
    for (const side of [-1, 1]) block(b, frame, [side * (w / 2 - 0.035), h / 2, -d / 2 + 0.035], [0.07, h, 0.07], 0.008, 1);
    block(b, frame, [0, h - 0.05, -d / 2 + 0.035], [w, 0.1, 0.06], 0.008, 0);
    const slats = Math.round((w - 0.14) / 0.12);
    for (let i = 0; i < slats; i += 1) block(b, frame, [-w / 2 + 0.07 + ((w - 0.14) * (i + 0.5)) / slats, (railTop + h - 0.1) / 2, -d / 2 + 0.035], [0.07, h - 0.1 - railTop, 0.025], 0.004, 1);
  } else if (head === "spindles") {
    for (const side of [-1, 1]) b.add(cylinder(0.022, h, { bevel: 0.005, segments: 16 }).translate([side * (w / 2 - 0.025), 0, -d / 2 + 0.025]), frame);
    b.add(tube([[-w / 2 + 0.025, h - 0.06, -d / 2 + 0.025], [w / 2 - 0.025, h - 0.06, -d / 2 + 0.025]], 0.016, { segments: 12 }), frame);
    const spindles = Math.round(w / 0.11);
    for (let i = 1; i < spindles; i += 1) b.add(cylinder(0.008, h - 0.06 - railTop, { segments: 10, bevel: 0.002 }).translate([-w / 2 + (w * i) / spindles, railTop, -d / 2 + 0.025]), frame);
  } else if (head === "panel") {
    // A panelled wooden headboard: a frame with a raised panel and a shaped top rail.
    const outline: Vec2[] = [];
    const arch = words.has("arched", "arch", "curved", "sleigh") ? 0.08 : 0;
    for (let k = 0; k <= 24; k += 1) {
      const x = -w / 2 + (w * k) / 24;
      outline.push([x, headH - arch * (1 - (2 * x / w) ** 2) - arch]);
    }
    outline.push([w / 2, 0], [-w / 2, 0]);
    const panel = extrude(outline.reverse(), { height: headT, bevel: 0.008 });
    // Outline in (x, y), extruded along z.
    b.add(panel, frame, compose(translation([0, legH, -d / 2]), [1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 1]));
    block(b, frame, [0, legH + headH * 0.55, -d / 2 + headT + 0.006], [w * 0.8, headH * 0.4, 0.012], 0.004, 0);
  }
  if (foot) {
    const footH = clamp(h * 0.45, 0.35, 0.65);
    if (head === "spindles") {
      for (const side of [-1, 1]) b.add(cylinder(0.022, footH, { bevel: 0.005, segments: 16 }).translate([side * (w / 2 - 0.025), 0, d / 2 - 0.025]), frame);
      b.add(tube([[-w / 2 + 0.025, footH - 0.05, d / 2 - 0.025], [w / 2 - 0.025, footH - 0.05, d / 2 - 0.025]], 0.016, { segments: 12 }), frame);
    } else {
      block(b, body, [0, (legH + footH) / 2, d / 2 - footT / 2], [w, footH - legH, footT], 0.01, 0);
    }
  }
  if (words.has("canopy", "four poster", "poster")) {
    for (const x of [-w / 2 + 0.025, w / 2 - 0.025]) for (const z of [-d / 2 + 0.025, d / 2 - 0.025]) b.add(cylinder(0.025, h, { bevel: 0.004, segments: 14 }).translate([x, 0, z]), frame);
    for (const z of [-d / 2 + 0.025, d / 2 - 0.025]) b.add(tube([[-w / 2 + 0.025, h - 0.02, z], [w / 2 - 0.025, h - 0.02, z]], 0.018, { segments: 10 }), frame);
    for (const x of [-w / 2 + 0.025, w / 2 - 0.025]) b.add(tube([[x, h - 0.02, -d / 2 + 0.025], [x, h - 0.02, d / 2 - 0.025]], 0.018, { segments: 10 }), frame);
  }
  if (words.has("storage", "drawers", "drawer")) {
    for (const side of [-1, 1]) block(b, frame, [side * (w / 2 + 0.002), (legH + railTop) / 2, d * 0.1], [0.012, railTop - legH - 0.04, d * 0.5], 0.004, 2);
  }
  // Legs at the corners and the middle of each rail.
  const style = legStyleOf(c, platform ? "block" : "tapered");
  for (const x of [-w / 2 + 0.04, w / 2 - 0.04]) for (const z of [-d / 2 + 0.04, 0, d / 2 - 0.04]) b.add(placeLeg(leg(style, legH + 0.01, 0.05), { x, z, top: legH + 0.01 }, 0), frameOf(c));
  const mattressH = 0.22;
  // A bed's listed height is its headboard; a mattress taller than that would be a different bed: keep under it.
  dressing(b, { width: w - 0.08, length: d / 2 - headZ - footT - 0.02, top: Math.min(railTop, h - mattressH - 0.12), headZ: headZ + 0.005 });
  return b;
}

function daybed(c: Context): Build {
  const b = new Build();
  const { w, d, h } = c.size;
  const length = Math.max(w, d);
  const width = Math.min(w, d);
  const frame = headboardOf(c) === "upholstered" ? upholsteryOf(c) : frameOf(c);
  const top = clamp(h * 0.4, 0.28, 0.38);
  // Three sides: the back along the length and an arm at each end.
  block(b, frame, [0, h / 2, -width / 2 + 0.03], [length, h, 0.06], 0.01, 0);
  for (const side of [-1, 1]) block(b, frame, [side * (length / 2 - 0.03), (h * 0.85) / 2, 0], [0.06, h * 0.85, width], 0.01, 2);
  block(b, frame, [0, top / 2, 0], [length, top - 0.06, width], 0.008, 0);
  const mattress = cushion({ size: [length - 0.14, 0.16, width - 0.08], radius: 0.05, crown: 0.012, face: "top" });
  b.add(mattress.mesh.translate([0, top + 0.08, 0.02]), bedding());
  if (d > w) for (const part of b.parts) part.mesh.transform([0, 0, 1, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 0, 1]);
  return b;
}

function bunk(c: Context): Build {
  const b = new Build();
  const { w, d, h } = c.size;
  const frame = frameOf(c);
  for (const x of [-w / 2 + 0.03, w / 2 - 0.03]) for (const z of [-d / 2 + 0.03, d / 2 - 0.03]) block(b, frame, [x, h / 2, z], [0.06, h, 0.06], 0.008, 1);
  for (const y of [0.25, h * 0.6]) {
    for (const side of [-1, 1]) block(b, frame, [side * (w / 2 - 0.03), y, 0], [0.04, 0.12, d - 0.06], 0.006, 2);
    for (const z of [-d / 2 + 0.03, d / 2 - 0.03]) block(b, frame, [0, y, z], [w - 0.06, 0.12, 0.04], 0.006, 0);
    const mattress = roundedBox({ size: [w - 0.12, 0.16, d - 0.12], radius: 0.05, segments: 3, step: 0.3 });
    b.add(mattress.translate([0, y + 0.1, 0]), bedding());
  }
  // The guard rail on top, and the ladder at the foot end.
  for (const side of [-1, 1]) block(b, frame, [side * (w / 2 - 0.03), h - 0.06, 0], [0.04, 0.08, d - 0.06], 0.006, 2);
  // The ladder at the foot end: two rails and five rungs.
  const ladderX = w / 2 - 0.2;
  for (const x of [ladderX - 0.16, ladderX + 0.16]) block(b, frame, [x, (h * 0.6 + 0.2) / 2, d / 2 + 0.01], [0.04, h * 0.6 + 0.2, 0.03], 0.005, 1);
  for (let i = 0; i < 5; i += 1) b.add(tube([[ladderX - 0.16, 0.2 + (i * (h * 0.6 - 0.1)) / 4, d / 2 + 0.01], [ladderX + 0.16, 0.2 + (i * (h * 0.6 - 0.1)) / 4, d / 2 + 0.01]], 0.014, { segments: 10 }), frame);
  return b;
}
