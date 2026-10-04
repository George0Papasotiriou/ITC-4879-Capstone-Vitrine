/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Rugs that wear their own photograph, turned planters, woven baskets and hampers.
 */

import { clamp, frameOf, type Context } from "@/lib/catalog/model/context";
import { cylinder, extrude, lathe, roundedBox, roundedRectanglePath, superellipsePath, sweep, tube, arcPath, type ProfilePoint } from "@/lib/catalog/model/geometry";
import { ceramic, jute, metal, pile, plastic, rattan, rugPhoto, upholstery, type MaterialSpec } from "@/lib/catalog/model/materials";
import type { Vec2, Vec3 } from "@/lib/catalog/model/mesh";
import { Build, placeLeg, taperedLeg } from "@/lib/catalog/model/parts";
import { metalTone } from "@/lib/catalog/model/words";
import type { Rgb } from "@/lib/vision/palette";

/**
 * docs/adr/058. A rug is the one piece whose look is mostly a picture: its
 * pattern. So a rug wears its own studio photograph, made flat by the
 * homography the Showcase already uses for rugs (vision/rectify.ts), over a
 * pile drawn in code; without a readable photograph, a field and a border in
 * its colours. Planters are turned like lamp bases, with a real wall
 * thickness and an inside; baskets and hampers are a woven wall swept round
 * their outline, with a rolled rim and handles.
 */

const darker = ({ r, g, b }: Rgb, k: number): Rgb => ({ r: Math.round(r * k), g: Math.round(g * k), b: Math.round(b * k) });

// ─── Rugs ───────────────────────────────────────────────────────────────────

export function buildRug(c: Context): Build {
  const b = new Build();
  const { w, d } = c.size;
  const { words } = c;
  const thick = clamp(c.size.h, 0.006, 0.03);
  const said = c.words.attribute("shape");
  const round = words.has("round", "circle", "circular") || said === "round";
  const oval = words.has("oval") || said === "oval";
  const outline: Vec2[] = round || oval ? superellipsePath(w, d, 2, 96) : roundedRectanglePath(w, d, 0.012, 3);
  const slab = extrude(outline, { height: thick, bevel: thick * 0.45, bevelSegments: 2 });
  if (c.photo !== null) {
    // The photograph spans the rug once: u along its long side, as the flattened picture is laid out.
    const along = w >= d;
    for (let v = 0; v < slab.vertexCount; v += 1) {
      const [x, , z] = slab.position(v);
      const u = along ? x / w + 0.5 : z / d + 0.5;
      const t = along ? z / d + 0.5 : 1 - (x / w + 0.5);
      slab.uvs[v * 2] = Math.max(0, Math.min(1, u));
      slab.uvs[v * 2 + 1] = Math.max(0, Math.min(1, t));
    }
    b.add(slab, rugPhoto(c.photo));
  } else {
    // A field and a border, in the rug's colours.
    const textured = words.has("jute", "sisal", "seagrass", "braided") ? jute : pile;
    const borderColour = c.palette.second ?? darker(c.palette.main, 0.72);
    b.add(slab, textured(borderColour));
    const inset = Math.min(w, d) * 0.08;
    const field: Vec2[] = round || oval ? superellipsePath(w - 2 * inset, d - 2 * inset, 2, 96) : roundedRectanglePath(w - 2 * inset, d - 2 * inset, 0.01, 3);
    b.add(extrude(field, { height: 0.0012, bevel: 0.0005, bevelSegments: 1 }).translate([0, thick - 0.0006, 0]), textured(c.palette.main));
  }
  if (words.has("fringe", "fringes", "tassel", "tassels", "fringed")) {
    // Fringes along the two short ends: strands of the warp left long.
    const longIsX = w >= d;
    const span = longIsX ? d : w;
    const strands = Math.round(span / 0.012);
    const fringe: MaterialSpec = { ...upholstery({ r: 236, g: 230, b: 216 }, "linen"), key: "fringe" };
    for (const end of [-1, 1]) {
      for (let i = 0; i < strands; i += 1) {
        const across = -span / 2 + (span * (i + 0.5)) / strands;
        const strand = roundedBox({ size: longIsX ? [0.06, 0.003, 0.004] : [0.004, 0.003, 0.06], radius: 0.0012, segments: 1 });
        const at: Vec3 = longIsX ? [end * (w / 2 + 0.028), 0.0015, across] : [across, 0.0015, end * (d / 2 + 0.028)];
        b.add(strand.translate(at), fringe);
      }
    }
  }
  return b;
}

// ─── Planters ───────────────────────────────────────────────────────────────

/** The planter's material from its words: glazed ceramic, terracotta, concrete, resin, metal, or a basket weave. */
function potMaterial(c: Context): MaterialSpec {
  const { words } = c;
  const colour = c.palette.main;
  if (words.has("terracotta", "terra cotta", "clay")) return ceramic(words.has("glazed") ? colour : { r: 184, g: 104, b: 70 }, words.has("glazed"));
  if (words.has("concrete", "cement", "fiberstone", "fibreglass", "fiberglass", "stone")) return ceramic(colour, false);
  if (words.has("rattan", "wicker", "seagrass", "woven", "basket", "jute", "water hyacinth")) return words.has("jute", "seagrass") ? jute(colour) : rattan(colour);
  if (words.has("metal", "galvanized", "brass", "copper", "steel", "iron")) {
    const tone = metalTone(words);
    return metal(tone?.colour ?? colour, tone?.finish ?? "brushed");
  }
  if (words.has("plastic", "resin", "polypropylene", "self watering")) return plastic(colour);
  if (words.has("fabric", "felt", "grow bag")) return upholstery(colour, "weave");
  return ceramic(colour, !words.has("matte", "unglazed", "textured"));
}

/** A pot's profile with a wall: up the outside, over the rim, down the inside to a floor. */
function potProfile(outer: (t: number) => number, height: number, wall: number): ProfilePoint[] {
  const p: ProfilePoint[] = [{ r: 0, y: 0 }];
  const steps = 24;
  for (let k = 0; k <= steps; k += 1) {
    const t = k / steps;
    p.push({ r: outer(t), y: height * t * 0.985 });
  }
  const rim = outer(1);
  p.push({ r: rim - wall * 0.15, y: height }, { r: rim - wall * 0.85, y: height });
  for (let k = steps; k >= 2; k -= 1) {
    const t = k / steps;
    p.push({ r: Math.max(0.005, outer(t) - wall), y: Math.max(height * 0.1, height * t * 0.985 - wall * 0.3) });
  }
  p.push({ r: 0, y: height * 0.1 });
  return p;
}

export function buildPlanter(c: Context): Build {
  const b = new Build();
  const { w, d, h } = c.size;
  const { words } = c;
  const material = potMaterial(c);
  const stand = words.has("stand", "legs", "plant stand", "with stand", "mid century", "midcentury");
  const potH = stand ? h * 0.55 : h;
  const potY = stand ? h - potH : 0;
  const r = Math.min(w, d) / 2;
  const wall = clamp(r * 0.08, 0.008, 0.025);
  if (words.has("square", "rectangular", "rectangle", "trough", "box", "cube", "window box")) {
    const outline = roundedRectanglePath(w - wall, d - wall, Math.min(0.02, w * 0.06), 4);
    const profile: ProfilePoint[] = [
      { r: wall / 2, y: 0 },
      { r: wall / 2, y: potH - 0.004 },
      { r: wall / 2 - 0.004, y: potH },
      { r: -wall / 2 + 0.004, y: potH },
      { r: -wall / 2, y: potH - 0.004 },
      { r: -wall / 2, y: potH * 0.1 },
    ];
    b.add(sweep(outline, profile, { period: 0.3 }).translate([0, potY, 0]), material);
    b.add(extrude(outline, { height: potH * 0.1, bevel: 0 }).translate([0, potY, 0]), material);
  } else {
    let outer: (t: number) => number;
    if (words.has("bowl", "low", "wide", "shallow") || potH < r * 1.1) outer = (t) => r * (0.62 + 0.38 * Math.sin((Math.PI / 2) * t) ** 0.8);
    else if (words.has("egg", "round", "sphere", "belly", "orb", "globe")) outer = (t) => r * Math.max(0.35, Math.sin(Math.PI * (0.1 + 0.78 * t))) * (t > 0.92 ? 0.9 : 1);
    else if (words.has("cylinder", "cylindrical", "straight")) outer = (t) => r * (t < 0.04 ? 0.94 + 1.5 * t : 1);
    else outer = (t) => r * (0.74 + 0.26 * t);
    const pot = lathe(potProfile(outer, potH, wall), { segments: 64, period: 0.3 });
    if (words.has("fluted", "ribbed", "ridged", "reeded")) {
      // Flutes: shallow grooves round the outside, every 15°.
      for (let v = 0; v < pot.vertexCount; v += 1) {
        const [x, y, z] = pot.position(v);
        const radius = Math.hypot(x, z);
        if (radius < outer(Math.min(1, y / potH)) - wall * 0.5 || y > potH * 0.97) continue;
        const theta = Math.atan2(z, x);
        const k = 1 - 0.035 * (1 - Math.abs(Math.cos(12 * theta)));
        pot.setPosition(v, [x * k, y, z * k]);
      }
      pot.recomputeNormals();
    }
    b.add(pot.translate([0, potY, 0]), material);
    if (words.has("saucer", "drainage", "drip tray")) b.add(cylinder(outer(0) * 1.18, 0.02, { bevel: 0.006, segments: 48 }).translate([0, potY, 0]), material);
  }
  if (stand) {
    const frame = frameOf(c, { preferMetal: words.has("metal", "iron", "gold", "brass") });
    const top = potY + potH * 0.35;
    const splay = 0.16;
    for (let k = 0; k < (words.has("tripod", "three") ? 3 : 4); k += 1) {
      const count = words.has("tripod", "three") ? 3 : 4;
      const a = Math.PI / 4 + (k * Math.PI * 2) / count;
      b.add(placeLeg(taperedLeg(top / Math.cos(splay), 0.016, 0.01), { x: Math.cos(a) * r * 0.7, z: Math.sin(a) * r * 0.7, top }, splay), frame);
    }
    b.add(tube(arcPath([0, top - 0.02, 0], r * 0.82, 0, Math.PI * 2, "xz", 48), 0.008, { closed: true, segments: 8 }), frame);
  }
  return b;
}

// ─── Baskets and hampers ────────────────────────────────────────────────────

function wovenMaterial(c: Context): MaterialSpec {
  const { words } = c;
  const colour = c.palette.main;
  if (words.has("wire", "metal", "steel", "iron")) {
    const tone = metalTone(words);
    return metal(tone?.colour ?? colour, tone?.finish ?? "powder");
  }
  if (words.has("cotton rope", "rope", "jute", "seagrass", "sisal", "braided")) return jute(colour);
  if (words.has("fabric", "canvas", "felt", "linen", "cotton", "collapsible", "foldable", "polyester")) return upholstery(colour, "linen");
  if (words.has("plastic", "polypropylene")) return plastic(colour);
  return rattan(colour);
}

export function buildBasket(c: Context): Build {
  const b = new Build();
  const { w, d, h } = c.size;
  const { words } = c;
  const material = wovenMaterial(c);
  const hamper = c.facts.kind === "LAUNDRY_HAMPER" || words.has("hamper", "laundry");
  const lid = words.has("lid", "lidded", "cover") || (hamper && !words.has("open", "bag"));
  const round = words.has("round", "circular", "cylinder", "drum", "belly") || (Math.abs(w - d) < 0.03 && !words.has("square", "rectangular"));
  const wall = clamp(Math.min(w, d) * 0.03, 0.008, 0.016);
  const bodyH = lid ? h * 0.93 : h;
  const outline: Vec2[] = round ? superellipsePath(w - wall, d - wall, 2, 64) : roundedRectanglePath(w - wall, d - wall, Math.min(w, d) * 0.12, 6);
  // The wall leans out a little towards the top, as a basket's does; a rolled rim finishes it.
  const flare = round ? 0.04 : 0.025;
  const rimR = clamp(wall * 0.9, 0.007, 0.015);
  const profile: ProfilePoint[] = [
    { r: wall / 2 - flare * 0.5, y: 0 },
    { r: wall / 2, y: bodyH * 0.5 },
    { r: wall / 2 + flare * 0.3, y: bodyH - rimR * 2 },
  ];
  for (let k = 0; k <= 8; k += 1) {
    const a = -Math.PI / 2 + (Math.PI * k) / 8;
    profile.push({ r: flare * 0.3 + rimR * Math.cos(a), y: bodyH - rimR + rimR * Math.sin(a) });
  }
  profile.push({ r: -wall / 2 + flare * 0.3, y: bodyH - rimR * 2 }, { r: -wall / 2, y: bodyH * 0.5 }, { r: -wall / 2 - flare * 0.5, y: wall });
  b.add(sweep(outline, profile, { period: 0.16 }), material);
  b.add(extrude(round ? superellipsePath(w - wall - flare, d - wall - flare, 2, 64) : roundedRectanglePath(w - wall - flare, d - wall - flare, Math.min(w, d) * 0.12, 6), { height: wall, bevel: 0.002 }), material);

  if (lid) {
    const lidMesh = extrude(round ? superellipsePath(w, d, 2, 64) : roundedRectanglePath(w, d, Math.min(w, d) * 0.12, 6), { height: h - bodyH, bevel: (h - bodyH) * 0.45, bevelSegments: 3 });
    b.add(lidMesh.translate([0, bodyH, 0]), material);
    b.add(cylinder(0.018, 0.025, { bevel: 0.008, segments: 18 }).translate([0, h - 0.004, 0]), material);
  }
  if (words.has("handle", "handles", "carry")) {
    // Rope or leather loops on the two short sides.
    const loop = hamper ? 0.05 : 0.04;
    const strap: MaterialSpec = words.has("leather") ? { key: "strap", colour: { r: 120, g: 76, b: 48 }, texture: "leather", roughness: 0.95, metallic: 0 } : jute({ r: 196, g: 172, b: 130 });
    const longIsX = w >= d;
    for (const side of [-1, 1]) {
      const centre: Vec3 = longIsX ? [side * (w / 2 + 0.004), bodyH - loop * 1.4, 0] : [0, bodyH - loop * 1.4, side * (d / 2 + 0.004)];
      const ring = tube(arcPath([0, 0, 0], loop, 0, Math.PI, longIsX ? "zy" : "xy", 16), 0.006, { segments: 8 });
      b.add(ring.translate(centre), strap);
    }
  }
  return b;
}

