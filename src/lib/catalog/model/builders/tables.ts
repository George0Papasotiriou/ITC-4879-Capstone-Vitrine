/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Tables and desks: tops of every shape and material on legs, pedestals, trestles, sleds; shelves, drawers, standing desks.
 */

import { block, clamp, frameOf, legStyleOf, metalFrame, surfaceOf, type Context } from "@/lib/catalog/model/context";
import { buildStorage } from "@/lib/catalog/model/builders/storage";
import { cylinder, extrude, lathe, roundedBox, roundedRectanglePath, superellipsePath, tube, type ProfilePoint } from "@/lib/catalog/model/geometry";
import { glass, metal, rubber, type MaterialSpec } from "@/lib/catalog/model/materials";
import { compose, translation, type Vec2, type Vec3 } from "@/lib/catalog/model/mesh";
import { Build, castor, drawerFronts, leg, placeLeg, type HandleStyle, type LegStyle } from "@/lib/catalog/model/parts";

/**
 * docs/adr/058. A table is its top and what holds the top up. The top's
 * outline comes from the listing's shape (round, oval, square, rectangular, a
 * soft-cornered racetrack) and its material from the words and the
 * photograph's top band — oak, walnut, marble, glass, a painted finish. The
 * base is chosen from the words in a fixed order of how specific they are:
 * pedestal, trestle, sled, X, tripod, hairpin, then four legs in the style
 * the piece's style implies, with an apron where a traditional table has one.
 */

export function buildTables(c: Context): Build {
  const { words } = c;
  // Pieces filed as tables that are really cabinets: a TV stand, a sideboard, a chest of drawers.
  if (words.has("tv stand", "media console", "entertainment center", "sideboard", "buffet", "credenza", "shelving unit", "bookcase", "bookshelf") || c.words.attribute("style") === "sideboard") return buildStorage(c);
  if (words.has("mirror") && c.size.d < 0.08) return mirror(c);
  if (c.facts.kind === "DESK" || words.has("desk", "writing table", "computer table", "workstation")) return desk(c);
  return table(c);
}

type Shape = "round" | "oval" | "square" | "rectangle" | "racetrack" | "c";

function shapeOf(c: Context): Shape {
  const { words } = c;
  const said = c.words.attribute("shape");
  if (words.has("c shaped", "c table", "c shape") || said.startsWith("c-")) return "c";
  if (words.has("round", "circular", "circle", "drum") || said === "round") return Math.abs(c.size.w - c.size.d) < 0.05 ? "round" : "oval";
  if (words.has("oval", "elliptical") || said === "oval") return "oval";
  if (words.has("racetrack", "capsule", "pill", "stadium")) return "racetrack";
  if (words.has("square") || said === "square" || Math.abs(c.size.w - c.size.d) < 0.02) return "square";
  return "rectangle";
}

/** The top's outline in plan, anticlockwise, centred. */
function outlineOf(shape: Shape, w: number, d: number, soft: boolean): Vec2[] {
  switch (shape) {
    case "round":
    case "oval":
      return superellipsePath(w, d, 2, 72);
    case "racetrack":
      return roundedRectanglePath(w, d, Math.min(w, d) / 2, 12);
    default:
      // The corner's radius is kept above the edge's bevel, or the bevel would fold over at the corner.
      return roundedRectanglePath(w, d, soft ? Math.min(w, d) * 0.08 : 0.012, soft ? 8 : 4);
  }
}

type Base = "pedestal" | "trestle" | "sled" | "x" | "tripod" | "drum" | "waterfall" | "legs";

function baseOf(c: Context, shape: Shape): Base {
  const { words } = c;
  if (words.has("pedestal", "tulip", "column base", "single leg")) return "pedestal";
  if (words.has("trestle")) return "trestle";
  if (words.has("sled", "u shaped base", "u base")) return "sled";
  if (words.has("x base", "x shaped", "x frame", "cross base", "crossed legs")) return "x";
  if (words.has("tripod", "three leg", "3 leg")) return "tripod";
  if (words.has("drum") || (words.has("storage") && shape === "round" && words.has("fabric"))) return "drum";
  if (words.has("waterfall", "parsons") && !words.has("legs")) return "waterfall";
  if (shape === "round" && words.has("dining", "kitchen", "bistro") && !words.has("legs", "tapered")) return "pedestal";
  if (shape === "round" && c.size.w < 0.6 && words.has("metal", "industrial")) return "tripod";
  return "legs";
}

function table(c: Context): Build {
  const b = new Build();
  const { w, d, h } = c.size;
  const { words } = c;
  const shape = shapeOf(c);
  const base = baseOf(c, shape);
  const top = surfaceOf(c);
  const isGlass = top.transmission !== undefined;
  const isStone = top.texture === "marble";
  const frame = frameOf(c);
  const topT = isGlass ? 0.012 : isStone ? 0.022 : clamp(h * 0.055, 0.022, 0.045);
  const soft = words.has("modern", "contemporary", "soft", "rounded corners") && shape !== "c";
  const coffee = h < 0.55;

  // The top.
  if (shape === "c") {
    // A C-table: a top, a post down one side, and a foot that slides under a sofa.
    block(b, top, [0, h - topT / 2, 0], [w, topT, d], 0.006, 0);
    const post = metalFrame(c) || words.has("metal", "steel") ? frame : frameOf(c, { preferMetal: true });
    block(b, post, [-w / 2 + 0.02, h / 2, 0], [0.025, h, d * 0.8], 0.004, 1);
    block(b, post, [0, 0.0125, 0], [w, 0.025, d * 0.8], 0.004, 0);
    return b;
  }
  b.add(extrude(outlineOf(shape, w, d, soft), { height: topT, bevel: Math.min(topT * 0.3, 0.006) }).translate([0, h - topT, 0]), top);
  if (isGlass) {
    // Glass needs a frame to rest on: a thin rail just under its edge.
    const inner = outlineOf(shape, w * 0.94, d * 0.94, soft);
    b.add(extrude(inner, { height: 0.02, bevel: 0.003 }).translate([0, h - topT - 0.02, 0]), frameOf(c, { preferMetal: true }));
  }
  const under = h - topT - (isGlass ? 0.02 : 0);

  // What holds it up.
  switch (base) {
    case "pedestal":
      pedestal(b, frame, under, Math.min(w, d));
      break;
    case "trestle":
      for (const side of [-1, 1]) {
        const x = side * (w / 2 - Math.min(0.25, w * 0.16));
        block(b, frame, [x, under / 2, 0], [0.07, under, 0.07], 0.008, 1);
        block(b, frame, [x, 0.03, 0], [0.08, 0.06, d * 0.82], 0.008, 2);
        block(b, frame, [x, under - 0.035, 0], [0.07, 0.07, d * 0.82], 0.008, 2);
      }
      block(b, frame, [0, under * 0.35, 0], [w - 2 * Math.min(0.25, w * 0.16), 0.06, 0.05], 0.008, 0);
      break;
    case "sled": {
      const steel = frameOf(c, { preferMetal: true });
      for (const side of [-1, 1]) {
        const x = side * (w / 2 - 0.06);
        b.add(tube(roundedU([x, under, -d / 2 + 0.06], [x, under, d / 2 - 0.06], 0.012), 0.014, { segments: 10 }), steel);
      }
      break;
    }
    case "x": {
      const span = Math.hypot(Math.min(w, 1.2) * 0.7, under);
      const angle = Math.atan2(under, Math.min(w, 1.2) * 0.7);
      for (const z of shape === "round" ? [0] : [-d / 2 + 0.08, d / 2 - 0.08]) {
        for (const s of [-1, 1]) {
          b.add(roundedBox({ size: [span, 0.06, 0.04], radius: 0.006, grain: 0 }), frame, compose(translation([0, under / 2, z]), rotationAroundZ(s * angle)));
        }
      }
      if (shape !== "round") block(b, frame, [0, under * 0.5, 0], [0.05, 0.05, d - 0.16], 0.006, 2);
      break;
    }
    case "tripod": {
      const t = metalFrame(c) ? 0.022 : 0.034;
      for (let k = 0; k < 3; k += 1) {
        const a = (k * Math.PI * 2) / 3 + Math.PI / 2;
        const r = Math.min(w, d) * 0.28;
        b.add(placeLeg(leg(metalFrame(c) ? "metal-round" : "tapered", under / Math.cos(0.18), t), { x: Math.cos(a) * r, z: Math.sin(a) * r, top: under }, 0.18), frame);
      }
      break;
    }
    case "drum":
      b.add(cylinder(Math.min(w, d) / 2 * 0.98, under, { bevel: 0.01, segments: 48 }), surfaceOf(c, c.palette.second ?? c.palette.main));
      break;
    case "waterfall":
      for (const side of [-1, 1]) block(b, top, [side * (w / 2 - topT / 2), under / 2, 0], [topT, under, d], 0.004, 1);
      break;
    case "legs":
      legsAndApron(c, b, frame, shape, under, coffee);
      break;
  }

  // A lower shelf, on legs that leave room for one.
  if (base === "legs" && words.has("shelf", "tier", "2 tier", "two tier", "lower shelf", "storage shelf", "open storage") && !words.has("drawer", "drawers")) {
    const shelfMaterial = words.has("glass shelf") ? glass() : top.transmission !== undefined ? surfaceOf({ ...c, words: c.words }, c.palette.second ?? c.palette.main) : top;
    const shelfY = clamp(h * 0.18, 0.06, 0.16);
    b.add(extrude(outlineOf(shape, w * 0.86, d * 0.86, soft), { height: 0.018, bevel: 0.004 }).translate([0, shelfY, 0]), shelfMaterial);
  }
  if (words.has("drawer", "drawers", "nightstand", "bedside") && base === "legs") {
    const count = c.words.countBefore("drawer") ?? (words.has("drawers") ? 2 : 1);
    const caseH = Math.min(under * 0.55, 0.14 * count + 0.04);
    const front = d / 2 - 0.03;
    block(b, top, [0, under - caseH / 2, 0], [w * 0.92, caseH, d * 0.9], 0.004, 0);
    const drawers = drawerFronts({ x: 0, y: under - caseH, width: w * 0.88, height: caseH, front: front + 0.012 }, Math.min(count, 3), count > 3 ? 2 : 1, { handleStyle: handleFor(c) });
    b.add(drawers.fronts, top);
    b.add(drawers.handles, handleMaterial(c));
  }
  if (words.has("wheels", "casters", "castors", "rolling")) {
    for (const x of [-w / 2 + 0.06, w / 2 - 0.06]) for (const z of [-d / 2 + 0.06, d / 2 - 0.06]) {
      const wheel = castor(0.045);
      b.add(wheel.wheel.translate([x, 0, z]), rubber());
      b.add(wheel.fork.translate([x, 0, z]), rubber());
    }
  }
  return b;
}

/** Four legs at the corners — or round a circle — and, on a traditional or dining table, an apron joining them under the top. */
function legsAndApron(c: Context, b: Build, frame: MaterialSpec, shape: Shape, under: number, coffee: boolean): void {
  const { w, d } = c.size;
  const { words } = c;
  const style: LegStyle = legStyleOf(c, metalFrame(c) ? "metal-square" : coffee ? "tapered" : "square");
  const thickness = { tapered: 0.05, turned: 0.075, square: 0.065, block: 0.07, bun: 0.08, hairpin: 0.07, "metal-round": 0.032, "metal-square": 0.04, cabriole: 0.06 }[style];
  const scale = clamp(Math.min(w, d) / 0.8, 0.6, 1.3);
  const t = thickness * scale;
  const apron = (words.has("dining", "farmhouse", "traditional", "rustic", "apron", "kitchen", "writing") || style === "turned" || style === "square") && style !== "hairpin" && style !== "tapered";
  const inset = apron ? t / 2 + 0.03 : t / 2 + 0.05;
  const splay = style === "tapered" ? 0.1 : 0;
  const positions: { x: number; z: number }[] = [];
  if (shape === "round" || shape === "oval") {
    for (let k = 0; k < 4; k += 1) {
      const a = Math.PI / 4 + (k * Math.PI) / 2;
      positions.push({ x: Math.cos(a) * (w / 2) * 0.66, z: Math.sin(a) * (d / 2) * 0.66 });
    }
  } else {
    for (const x of [-w / 2 + inset, w / 2 - inset]) for (const z of [-d / 2 + inset, d / 2 - inset]) positions.push({ x, z });
  }
  for (const at of positions) b.add(placeLeg(leg(style, under / Math.cos(splay), t), { ...at, top: under }, splay), frame);
  if (apron && shape !== "round" && shape !== "oval") {
    const apronH = clamp(under * 0.12, 0.06, 0.1);
    const xIn = w / 2 - inset;
    const zIn = d / 2 - inset;
    for (const z of [-zIn, zIn]) block(b, frame, [0, under - apronH / 2, z], [2 * xIn, apronH, 0.022], 0.003, 0);
    for (const x of [-xIn, xIn]) block(b, frame, [x, under - apronH / 2, 0], [0.022, apronH, 2 * zIn], 0.003, 2);
  }
  if (style === "hairpin" || words.has("industrial")) {
    // An industrial frame: a rail under the top, and a stretcher low between the end legs.
    if (shape === "rectangle" || shape === "square") {
      for (const x of [-w / 2 + inset, w / 2 - inset]) block(b, frame, [x, 0.12, 0], [0.025, 0.025, d - 2 * inset], 0.004, 2);
    }
  }
}

/** A pedestal: a turned column standing on a flared foot. */
function pedestal(b: Build, material: MaterialSpec, height: number, span: number): void {
  const foot = span * 0.32;
  const neck = clamp(span * 0.06, 0.045, 0.09);
  const profile: ProfilePoint[] = [{ r: 0, y: 0 }, { r: foot, y: 0 }, { r: foot, y: 0.02 }];
  // The flare, from the foot's rim up into the column, as a smooth curve.
  for (let k = 1; k <= 10; k += 1) {
    const t = k / 10;
    profile.push({ r: neck + (foot - neck) * (1 - t) ** 2.6, y: 0.02 + height * 0.28 * t });
  }
  profile.push({ r: neck, y: height * 0.85 }, { r: neck * 1.6, y: height - 0.02 }, { r: neck * 1.6, y: height }, { r: 0, y: height });
  b.add(lathe(profile, { segments: 48 }), material);
}

/** A U of square tube, open at the top, its two corners rounded: one end of a sled base. */
function roundedU(from: Vec3, to: Vec3, radius: number): Vec3[] {
  const corners: Vec3[] = [from, [from[0], 0.012, from[2]], [to[0], 0.012, to[2]], to];
  const out: Vec3[] = [];
  out.push(corners[0]!);
  for (let i = 1; i < 3; i += 1) {
    const p = corners[i]!;
    const prev = corners[i - 1]!;
    const next = corners[i + 1]!;
    const a: Vec3 = [p[0] + (prev[0] - p[0]) * (radius * 4) / Math.hypot(prev[0] - p[0], prev[1] - p[1], prev[2] - p[2]), p[1] + (prev[1] - p[1]) * (radius * 4) / Math.hypot(prev[0] - p[0], prev[1] - p[1], prev[2] - p[2]), p[2] + (prev[2] - p[2]) * (radius * 4) / Math.hypot(prev[0] - p[0], prev[1] - p[1], prev[2] - p[2])];
    const z: Vec3 = [p[0] + (next[0] - p[0]) * (radius * 4) / Math.hypot(next[0] - p[0], next[1] - p[1], next[2] - p[2]), p[1] + (next[1] - p[1]) * (radius * 4) / Math.hypot(next[0] - p[0], next[1] - p[1], next[2] - p[2]), p[2] + (next[2] - p[2]) * (radius * 4) / Math.hypot(next[0] - p[0], next[1] - p[1], next[2] - p[2])];
    for (let k = 0; k <= 6; k += 1) {
      const t = k / 6;
      out.push([a[0] * (1 - t) ** 2 + p[0] * 2 * (1 - t) * t + z[0] * t * t, a[1] * (1 - t) ** 2 + p[1] * 2 * (1 - t) * t + z[1] * t * t, a[2] * (1 - t) ** 2 + p[2] * 2 * (1 - t) * t + z[2] * t * t]);
    }
  }
  out.push(corners[3]!);
  return out;
}

function rotationAroundZ(angle: number) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

export function handleFor(c: Context): HandleStyle {
  const { words } = c;
  if (words.has("knob", "knobs")) return "knob";
  if (words.has("cup pull", "bin pull", "farmhouse")) return "cup";
  if (words.has("ring pull", "ring")) return "ring";
  if (words.has("handleless", "push to open", "push open")) return "none";
  return words.has("traditional", "classic", "country") ? "knob" : "bar";
}

export function handleMaterial(c: Context): MaterialSpec {
  const { words } = c;
  if (words.has("brass", "gold")) return metal({ r: 214, g: 176, b: 102 }, "polished");
  if (words.has("chrome", "nickel", "silver", "stainless")) return metal({ r: 214, g: 214, b: 212 }, "brushed");
  if (words.has("bronze", "oil rubbed")) return metal({ r: 70, g: 54, b: 42 }, "brushed");
  return metal({ r: 40, g: 40, b: 42 }, "powder");
}

// ─── Desks ──────────────────────────────────────────────────────────────────

function desk(c: Context): Build {
  const b = new Build();
  const { w, d, h } = c.size;
  const { words } = c;
  const top = surfaceOf(c);
  const steel = frameOf(c, { preferMetal: true });
  const frame = frameOf(c);
  const topT = clamp(h * 0.035, 0.022, 0.035);
  const under = h - topT;
  const lShaped = words.has("l shaped", "l shape", "corner desk", "l desk");
  if (lShaped && Math.min(w, d) > 0.9) {
    // An L: the long run across the back, the return down one side.
    const run = clamp(Math.min(w, d) * 0.45, 0.45, 0.65);
    const outline: Vec2[] = [
      [-w / 2, -d / 2],
      [w / 2, -d / 2],
      [w / 2, d / 2],
      [w / 2 - run, d / 2],
      [w / 2 - run, -d / 2 + run],
      [-w / 2, -d / 2 + run],
    ];
    b.add(extrude(outline, { height: topT, bevel: 0.004 }).translate([0, under, 0]), top);
    const t = 0.045;
    for (const [x, z] of [[-w / 2 + 0.04, -d / 2 + 0.04], [-w / 2 + 0.04, -d / 2 + run - 0.04], [w / 2 - 0.04, -d / 2 + 0.04], [w / 2 - 0.04, d / 2 - 0.04], [w / 2 - run + 0.04, d / 2 - 0.04]] as const) {
      block(b, steel, [x, under / 2, z], [t, under, t], 0.004, 1);
    }
    return b;
  }
  block(b, top, [0, under + topT / 2, 0], [w, topT, d], 0.004, 0);
  if (words.has("standing", "stand up", "sit stand", "height adjustable", "adjustable height", "electric")) {
    // A standing desk: two telescoping columns on feet, a crossbar, and the control box.
    for (const side of [-1, 1]) {
      const x = side * (w / 2 - 0.12);
      block(b, steel, [x, under * 0.3, 0], [0.075, under * 0.6, 0.06], 0.006, 1);
      block(b, steel, [x, under * 0.75, 0], [0.065, under * 0.5, 0.05], 0.006, 1);
      block(b, steel, [x, 0.02, 0], [0.07, 0.04, d * 0.86], 0.008, 2);
      block(b, steel, [x, under - 0.02, 0], [0.05, 0.03, d * 0.8], 0.004, 2);
    }
    block(b, steel, [0, under - 0.04, -d * 0.2], [w - 0.24, 0.05, 0.04], 0.004, 0);
    block(b, rubber(), [w / 2 - 0.25, under - 0.012, d / 2 - 0.03], [0.12, 0.022, 0.05], 0.006);
    return b;
  }
  const drawerSide = words.has("drawers", "storage", "pedestal", "file cabinet", "filing") && w > 0.9;
  const style: LegStyle = legStyleOf(c, metalFrame(c) ? "metal-square" : "tapered");
  const t = style === "metal-square" ? 0.035 : 0.05;
  const splay = style === "tapered" ? 0.06 : 0;
  const legXs = drawerSide ? [-w / 2 + 0.05] : [-w / 2 + 0.05, w / 2 - 0.05];
  for (const x of legXs) for (const z of [-d / 2 + 0.05, d / 2 - 0.05]) b.add(placeLeg(leg(style, under / Math.cos(splay), t), { x, z, top: under }, splay), style.startsWith("metal") ? steel : frame);
  if (drawerSide) {
    // A pedestal of drawers on the right, from the floor to the top.
    const pw = clamp(w * 0.3, 0.35, 0.45);
    const x = w / 2 - pw / 2;
    block(b, top, [x, under / 2, 0], [pw, under, d], 0.004, 1);
    const drawers = drawerFronts({ x, y: 0.03, width: pw - 0.02, height: under - 0.04, front: d / 2 + 0.01 }, 3, 1, { handleStyle: handleFor(c) });
    b.add(drawers.fronts, top);
    b.add(drawers.handles, handleMaterial(c));
  } else if (words.has("drawer", "writing")) {
    const drawers = drawerFronts({ x: 0, y: under - 0.11, width: w * 0.5, height: 0.1, front: d / 2 - 0.02 }, 1, 1, { handleStyle: handleFor(c) });
    block(b, top, [0, under - 0.055, 0], [w * 0.86, 0.1, d * 0.9], 0.003, 0);
    b.add(drawers.fronts, top);
    b.add(drawers.handles, handleMaterial(c));
  }
  if (style.startsWith("metal")) {
    // A modesty bar across the back, as on most computer desks.
    block(b, steel, [0, under * 0.6, -d / 2 + 0.05], [w - 0.1, 0.03, 0.02], 0.004, 0);
  }
  if (words.has("shelf", "shelves", "hutch", "monitor")) {
    block(b, top, [0, under * 0.25, 0], [w - 0.14, 0.02, d - 0.1], 0.003, 0);
  }
  return b;
}

/** A floor mirror, which some listings file as a table: a frame round a silvered panel, leaning on a stand. */
function mirror(c: Context): Build {
  const b = new Build();
  const { w, d, h } = c.size;
  const frame = frameOf(c);
  const silver: MaterialSpec = { key: "mirror", colour: { r: 236, g: 238, b: 240 }, texture: null, roughness: 0.02, metallic: 1 };
  const border = clamp(Math.min(w, h) * 0.05, 0.02, 0.06);
  b.add(roundedBox({ size: [w - 2 * border, h - 2 * border, 0.008], radius: 0.002, segments: 1 }).translate([0, h / 2, 0]), silver);
  for (const y of [border / 2, h - border / 2]) block(b, frame, [0, y, 0], [w, border, d], 0.004, 0);
  for (const x of [-w / 2 + border / 2, w / 2 - border / 2]) block(b, frame, [x, h / 2, 0], [border, h, d], 0.004, 1);
  return b;
}
