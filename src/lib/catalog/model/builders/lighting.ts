/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Lighting: table lamps with turned bases and shades lit from inside, floor lamps, arc, tripod and torchiere lamps, task lamps.
 */

import { clamp, type Context } from "@/lib/catalog/model/context";
import { arcPath, cylinder, lathe, roundedBox, sphere, tube, type ProfilePoint } from "@/lib/catalog/model/geometry";
import { bulb, ceramic, glass, marble, metal, shade, wood, type MaterialSpec } from "@/lib/catalog/model/materials";
import { compose, rotationZ, translation, type Vec3 } from "@/lib/catalog/model/mesh";
import { Build, placeLeg, taperedLeg } from "@/lib/catalog/model/parts";
import { metalTone, woodTone } from "@/lib/catalog/model/words";
import type { Rgb } from "@/lib/vision/palette";

/**
 * docs/adr/058. A lamp is drawn as a lamp-maker turns one: the base is a
 * profile spun on a lathe (a gourd, a ginger jar, a column, stacked orbs, a
 * candlestick), the shade another profile (drum, empire, bell, pagoda, cone,
 * dome), open at both ends and lit from inside — its cloth glows a little,
 * the way a lamp in a shop window does, and a bulb shows from below. The
 * shade's colour is the top of the photograph; the base's the bottom.
 */

export function buildLighting(c: Context): Build {
  const { words } = c;
  const { h } = c.size;
  if (words.has("sconce", "wall lamp", "wall light", "flush mount")) return sconce(c);
  if (words.has("arc", "arch", "arched", "arcing", "overarching")) return arcLamp(c);
  if (words.has("torchiere", "uplight", "uplighter")) return torchiere(c);
  // "Desk lamp" alone is any lamp sold for a desk, most with a shade; only an arm or a pharmacy stem makes a task lamp.
  if (words.has("task lamp", "articulating", "articulated", "swing arm", "architect", "adjustable arm", "pharmacy", "downbridge", "banker", "clamp", "work light")) return taskLamp(c);
  if (words.has("tree", "3 light", "three light", "5 light", "multi head", "multi light")) return treeLamp(c);
  if (words.has("tripod")) return tripodLamp(c);
  if (words.has("floor lamp", "floor", "standing") || h > 1.15) return floorLamp(c);
  return tableLamp(c);
}

type ShadeShape = "drum" | "empire" | "bell" | "pagoda" | "cone" | "dome" | "globe" | "cylinder";

function shadeShapeOf(c: Context): ShadeShape {
  const { words } = c;
  const said = c.words.attribute("shape");
  if (words.has("globe", "orb shade", "ball shade", "sphere shade", "glass globe", "mushroom")) return "globe";
  if (words.has("pagoda") || said === "pagoda") return "pagoda";
  if (words.has("bell") || said === "bell") return "bell";
  if (words.has("empire", "tapered shade", "coolie")) return "empire";
  if (words.has("cone", "metal shade", "conical")) return "cone";
  if (words.has("dome", "domed", "metal dome")) return "dome";
  if (words.has("cylinder", "ribbed glass")) return "cylinder";
  return "drum";
}

/** The shade's cloth: its colour from the words when they name one ("black shade"), else the photograph's top. */
function shadeMaterial(c: Context, shape: ShadeShape): MaterialSpec {
  const { words } = c;
  let colour: Rgb = c.palette.main;
  if (words.has("black shade")) colour = { r: 36, g: 36, b: 38 };
  else if (words.has("white shade", "linen shade", "off white shade", "cream shade")) colour = { r: 240, g: 236, b: 226 };
  if (shape === "cone" || shape === "dome") {
    const tone = metalTone(words);
    return metal(tone?.colour ?? colour, tone?.finish ?? "powder");
  }
  if (shape === "globe" || shape === "cylinder") return { ...glass({ r: 246, g: 244, b: 238 }), opacity: 0.55, emissive: { colour: { r: 255, g: 230, b: 190 }, strength: 0.6 } };
  // A dark shade does not glow through; a pale one does.
  const pale = (0.2126 * colour.r + 0.7152 * colour.g + 0.0722 * colour.b) > 120;
  return shade(colour, pale);
}

/** The base's material: ceramic, metal, wood, glass or stone, in the photograph's lower colour. */
function baseMaterial(c: Context): MaterialSpec {
  const { words } = c;
  const colour = c.palette.second ?? c.palette.main;
  if (words.has("ceramic", "porcelain", "stoneware", "chinoiserie", "terracotta", "pottery", "glazed") || words.material("ceramic")) return ceramic(colour, !words.has("matte", "stoneware", "textured"));
  if (words.has("marble", "stone", "faux stone", "concrete", "alabaster") || words.material("marble")) return words.has("concrete") ? ceramic(colour, false) : marble(colour);
  if (words.has("glass", "crystal") && !words.has("glass shade")) return glass({ r: 230, g: 236, b: 236 });
  if (words.has("wood", "wooden", "rattan", "bamboo") || words.material("wood")) return wood(woodTone(words) ?? colour);
  const tone = metalTone(words);
  if (tone !== null) return metal(tone.colour, tone.finish);
  return words.material("metal") ? metal(colour, "brushed") : ceramic(colour);
}

/** An open shade: a lathe of its outline with no caps, rims at top and bottom, and a bulb below its middle. */
function addShade(b: Build, c: Context, shape: ShadeShape, bottomY: number, height: number, radius: number): void {
  const material = shadeMaterial(c, shape);
  const r = radius;
  let profile: ProfilePoint[];
  switch (shape) {
    case "empire":
      profile = [{ r, y: 0 }, { r: r * 0.62, y: height }];
      break;
    case "bell": {
      profile = [];
      for (let k = 0; k <= 12; k += 1) {
        const t = k / 12;
        profile.push({ r: r * (0.5 + 0.5 * (1 - t) ** 1.8) + r * 0.06 * Math.sin(Math.PI * t), y: height * t });
      }
      break;
    }
    case "pagoda": {
      profile = [];
      for (let k = 0; k <= 12; k += 1) {
        const t = k / 12;
        profile.push({ r: r * (0.42 + 0.58 * (1 - t) ** 2.4), y: height * t });
      }
      break;
    }
    case "cone":
      profile = [{ r, y: 0 }, { r: r * 0.25, y: height }];
      break;
    case "dome": {
      profile = [];
      for (let k = 0; k <= 14; k += 1) {
        const a = (Math.PI / 2) * (k / 14);
        profile.push({ r: Math.max(0.012, r * Math.cos(a)), y: height * Math.sin(a) });
      }
      break;
    }
    case "globe": {
      const g = Math.min(r, height / 2);
      b.add(sphere(g, { segments: 36, rings: 20 }).translate([0, bottomY + g, 0]), material);
      b.add(sphere(Math.min(0.03, g * 0.3), { segments: 14, rings: 8 }).translate([0, bottomY + g, 0]), bulb());
      return;
    }
    case "cylinder":
      profile = [{ r, y: 0 }, { r, y: height }];
      break;
    case "drum":
      profile = [{ r, y: 0 }, { r, y: height }];
      break;
  }
  const outer = lathe(profile, { segments: 56, capBottom: false, capTop: false, period: 0.09 });
  b.add(outer.translate([0, bottomY, 0]), material);
  // Rims: the wire at each edge of a cloth shade, which keeps it crisp.
  const top = profile[profile.length - 1]!;
  const rim = shape === "cone" || shape === "dome" ? material : metal({ r: 196, g: 194, b: 188 }, "brushed");
  for (const ring of [profile[0]!, top]) {
    if (ring.r < 0.015) continue;
    b.add(tube(arcPath([0, bottomY + ring.y, 0], ring.r, 0, Math.PI * 2, "xz", 56), 0.0025, { closed: true, segments: 6 }), rim);
  }
  // The bulb, seen from below.
  b.add(sphere(clamp(r * 0.18, 0.018, 0.035), { segments: 16, rings: 10 }).translate([0, bottomY + height * 0.35, 0]), bulb());
}

/** A finial on top of the harp: a small turned knob. */
function finial(b: Build, material: MaterialSpec, topY: number): void {
  const k = lathe(
    [
      { r: 0, y: 0 },
      { r: 0.006, y: 0 },
      { r: 0.004, y: 0.008 },
      { r: 0.011, y: 0.016 },
      { r: 0.009, y: 0.026 },
      { r: 0, y: 0.03 },
    ],
    { segments: 16 },
  );
  b.add(k.translate([0, topY - 0.03, 0]), material);
}

/** The base's profile, by style: a list of (radius, height) from the floor of the base to its neck. */
function baseProfile(c: Context, radius: number, height: number): ProfilePoint[] {
  const { words } = c;
  const p: ProfilePoint[] = [{ r: 0, y: 0 }];
  const curve = (f: (t: number) => number, steps = 28) => {
    for (let k = 0; k <= steps; k += 1) {
      const t = k / steps;
      p.push({ r: Math.max(0.006, radius * f(t)), y: height * t });
    }
  };
  if (words.has("candlestick", "stick", "column", "pillar", "cylinder", "modern", "contemporary") && !words.has("ceramic", "gourd", "jar", "vase", "urn")) {
    // A slim column on a stepped foot.
    curve((t) => (t < 0.06 ? 1 : t < 0.1 ? 0.75 : t < 0.9 ? 0.26 + 0.04 * Math.sin(Math.PI * t) : 0.32), 30);
  } else if (words.has("orb", "ball", "sphere", "stacked")) {
    const balls = words.has("stacked") ? 3 : 1;
    // Stacked spheres: each a bulge, pinched between.
    curve((t) => {
      const local = (t * balls) % 1;
      return t > 0.97 ? 0.15 : 0.18 + 0.82 * Math.sin(Math.PI * local) ** 0.7 * (1 - 0.15 * Math.floor(t * balls));
    }, 18 * balls);
  } else if (words.has("square", "rectangular", "cube", "block")) {
    // Handled by the caller as a box.
    curve(() => 0.9, 2);
  } else if (words.has("urn", "trophy")) {
    curve((t) => (t < 0.12 ? 0.55 : t < 0.2 ? 0.35 : 0.35 + 0.65 * Math.sin(Math.PI * Math.min(1, (t - 0.2) / 0.7)) ** 0.8 - (t > 0.9 ? 0.4 : 0)), 30);
  } else {
    // A gourd / ginger jar: a broad belly narrowing to a short neck.
    curve((t) => (t < 0.04 ? 0.55 + 4 * t : t < 0.85 ? 0.7 + 0.3 * Math.sin(Math.PI * ((t - 0.04) / 0.81)) ** 0.9 - 0.25 * Math.max(0, t - 0.6) : 0.28), 32);
  }
  p.push({ r: 0, y: height });
  return p;
}

function tableLamp(c: Context): Build {
  const b = new Build();
  const { w, d, h } = c.size;
  const span = Math.min(w, d);
  const shape = shadeShapeOf(c);
  const shadeR = span / 2;
  const shadeH = shape === "globe" ? Math.min(span, h * 0.5) : clamp(span * 0.62, 0.12, h * 0.42);
  const finialH = shape === "globe" || shape === "cone" || shape === "dome" ? 0 : 0.03;
  const shadeBottom = h - finialH - shadeH;
  const neck = clamp(shadeBottom * 0.18, 0.03, 0.12);
  const bodyH = Math.max(0.05, shadeBottom - neck + shadeH * 0.1);
  const material = baseMaterial(c);
  const square = c.words.has("square", "rectangular", "cube", "block") && !c.words.has("round");
  if (square) {
    b.add(roundedBox({ size: [span * 0.45, bodyH, span * 0.45], radius: 0.01, segments: 3 }).translate([0, bodyH / 2, 0]), material);
  } else {
    b.add(lathe(baseProfile(c, span * 0.28, bodyH), { segments: 48, period: 0.3 }), material);
  }
  const brass = metal(metalTone(c.words)?.colour ?? { r: 196, g: 170, b: 112 }, "brushed");
  // Neck, socket and harp up into the shade.
  b.add(cylinder(0.011, neck + shadeH * 0.4, { bevel: 0.002, segments: 14 }).translate([0, bodyH, 0]), brass);
  b.add(cylinder(0.018, 0.045, { bevel: 0.004, segments: 18 }).translate([0, shadeBottom + shadeH * 0.2, 0]), brass);
  if (finialH > 0) {
    b.add(tube([[-shadeR * 0.35, shadeBottom + shadeH * 0.25, 0], [-shadeR * 0.35, h - finialH - 0.004, 0], [shadeR * 0.35, h - finialH - 0.004, 0], [shadeR * 0.35, shadeBottom + shadeH * 0.25, 0]], 0.0025, { segments: 6 }), brass);
    finial(b, brass, h);
  }
  addShade(b, c, shape, shadeBottom, shadeH, shadeR);
  return b;
}

function floorLamp(c: Context): Build {
  const b = new Build();
  const { w, d, h } = c.size;
  const span = Math.min(w, d);
  const shape = shadeShapeOf(c);
  const shadeR = span / 2;
  const shadeH = clamp(span * 0.6, 0.15, Math.min(0.42, h * 0.3));
  const shadeBottom = h - 0.03 - shadeH;
  const material = baseMaterial(c);
  const stem = c.words.has("wood", "wooden") ? wood(woodTone(c.words) ?? c.palette.second ?? { r: 120, g: 84, b: 56 }) : material.metallic > 0 ? material : metal(metalTone(c.words)?.colour ?? { r: 40, g: 40, b: 42 }, metalTone(c.words)?.finish ?? "powder");
  b.add(cylinder(span * 0.32, 0.03, { bevel: 0.01, segments: 48 }), stem);
  b.add(cylinder(0.012, shadeBottom + shadeH * 0.3, { bevel: 0.003, segments: 16 }).translate([0, 0.03, 0]), stem);
  if (c.words.has("shelf", "shelves", "table")) {
    for (const y of [h * 0.35, h * 0.55]) b.add(cylinder(span * 0.42, 0.02, { bevel: 0.005, segments: 40 }).translate([0, y, 0]), wood(woodTone(c.words) ?? { r: 140, g: 100, b: 66 }));
  }
  addShade(b, c, shape, shadeBottom, shadeH, shadeR);
  finial(b, stem, h);
  return b;
}

function tripodLamp(c: Context): Build {
  const b = new Build();
  const { w, d, h } = c.size;
  const span = Math.min(w, d);
  const shape = shadeShapeOf(c);
  const shadeH = clamp(span * 0.55, 0.15, h * 0.3);
  const shadeBottom = h - 0.02 - shadeH;
  const legsMaterial = c.words.has("metal", "brass", "black metal") && !c.words.has("wood") ? baseMaterial(c) : wood(woodTone(c.words) ?? c.palette.second ?? { r: 132, g: 92, b: 60 });
  const top = shadeBottom + 0.04;
  const splay = Math.atan2(span * 0.42, top);
  for (let k = 0; k < 3; k += 1) {
    const a = (k * Math.PI * 2) / 3 + Math.PI / 2;
    const legMesh = taperedLeg(top / Math.cos(splay), 0.016, 0.011);
    b.add(placeLeg(legMesh, { x: Math.cos(a) * 0.02, z: Math.sin(a) * 0.02, top }, splay), legsMaterial);
  }
  addShade(b, c, shape, shadeBottom, shadeH, span / 2);
  return b;
}

function arcLamp(c: Context): Build {
  const b = new Build();
  const { w, d, h } = c.size;
  // The reach is the longer side, whichever the listing calls width.
  const reach = Math.max(w, d);
  const steel = metal(metalTone(c.words)?.colour ?? { r: 214, g: 214, b: 212 }, metalTone(c.words)?.finish ?? "polished");
  const baseSize = clamp(reach * 0.22, 0.2, 0.32);
  const x0 = -reach / 2 + baseSize / 2;
  // Arc lamps stand on a heavy block, usually marble, to balance the arc.
  b.add(roundedBox({ size: [baseSize, 0.07, baseSize * 0.8], radius: 0.01, segments: 3 }).translate([x0, 0.035, 0]), marble(c.palette.second ?? { r: 236, g: 234, b: 230 }));
  const domeR = clamp(reach * 0.2, 0.15, 0.24);
  const x1 = reach / 2 - domeR;
  const top = h - 0.02;
  const hangY = top - 0.32;
  // The arc: up from the base, over, and down to where the dome hangs (a cubic Bézier).
  const p0: Vec3 = [x0, 0.07, 0];
  const p1: Vec3 = [x0, top * 1.05, 0];
  const p2: Vec3 = [x1, top * 1.1, 0];
  const p3: Vec3 = [x1, hangY + 0.1, 0];
  const path: Vec3[] = [];
  for (let k = 0; k <= 40; k += 1) {
    const t = k / 40;
    const m = (a: number, bb: number, cc: number, dd: number) => (1 - t) ** 3 * a + 3 * (1 - t) ** 2 * t * bb + 3 * (1 - t) * t * t * cc + t ** 3 * dd;
    path.push([m(p0[0], p1[0], p2[0], p3[0]), m(p0[1], p1[1], p2[1], p3[1]), 0]);
  }
  b.add(tube(path, 0.011, { segments: 12 }), steel);
  addShade(b, c, "dome", hangY - domeR * 0.5, domeR * 0.75, domeR);
  return b;
}

function torchiere(c: Context): Build {
  const b = new Build();
  const { w, d, h } = c.size;
  const span = Math.min(w, d);
  const material = baseMaterial(c);
  b.add(cylinder(span * 0.4, 0.03, { bevel: 0.01, segments: 48 }), material);
  b.add(cylinder(0.012, h - 0.14, { bevel: 0.003, segments: 16 }).translate([0, 0.03, 0]), material);
  const bowl: ProfilePoint[] = [];
  for (let k = 0; k <= 12; k += 1) {
    const t = k / 12;
    bowl.push({ r: 0.02 + (span / 2 - 0.02) * Math.sin((Math.PI / 2) * t), y: 0.12 * t ** 1.6 });
  }
  b.add(lathe(bowl, { segments: 48, capBottom: true, capTop: false }).translate([0, h - 0.12, 0]), { ...material, doubleSided: true, key: `${material.key}:bowl` });
  b.add(cylinder(span / 2 - 0.03, 0.004, { bevel: 0.001, segments: 40 }).translate([0, h - 0.03, 0]), bulb());
  return b;
}

function treeLamp(c: Context): Build {
  const b = new Build();
  const { w, d, h } = c.size;
  const span = Math.max(w, d);
  const material = baseMaterial(c);
  b.add(cylinder(0.14, 0.03, { bevel: 0.01, segments: 40 }), material);
  b.add(cylinder(0.012, h * 0.7, { bevel: 0.003, segments: 14 }).translate([0, 0.03, 0]), material);
  const shadeR = clamp(span * 0.14, 0.07, 0.12);
  for (let k = 0; k < 3; k += 1) {
    const a = (k * Math.PI * 2) / 3;
    const end: Vec3 = [Math.cos(a) * (span / 2 - shadeR), h - 0.25 + k * 0.08, Math.sin(a) * (Math.min(w, d) / 2 - shadeR) * 0.8];
    b.add(tube([[0, h * 0.55 + k * 0.08, 0], [end[0] * 0.5, end[1] + 0.05, end[2] * 0.5], end], 0.008, { segments: 10 }), material);
    const sub = new Build();
    addShade(sub, c, "empire", 0, shadeR * 1.2, shadeR);
    for (const part of sub.parts) b.add(part.mesh.translate([end[0], end[1] - shadeR * 0.6, end[2]]), part.material);
  }
  return b;
}

function taskLamp(c: Context): Build {
  const b = new Build();
  const { w, d, h } = c.size;
  // Laid out along its longer side: the arm reaches across it.
  const material = baseMaterial(c);
  const metalPart = material.metallic > 0 ? material : metal(metalTone(c.words)?.colour ?? { r: 38, g: 38, b: 40 }, metalTone(c.words)?.finish ?? "powder");
  const span = Math.max(w, d);
  const baseR = clamp(Math.min(w, d) * 0.42, 0.06, 0.12);
  b.add(cylinder(baseR, 0.025, { bevel: 0.008, segments: 40 }).translate([-span / 2 + baseR, 0, 0]), metalPart);
  const x0 = -span / 2 + baseR;
  if (c.words.has("pharmacy", "downbridge", "banker")) {
    // A straight stem and an arm out over the table, a small shade pointing down.
    b.add(cylinder(0.008, h - 0.06, { bevel: 0.002, segments: 12 }).translate([x0, 0.025, 0]), metalPart);
    b.add(tube([[x0, h - 0.05, 0], [span / 2 - 0.08, h - 0.05, 0]], 0.007, { segments: 10 }), metalPart);
    const sub = new Build();
    addShade(sub, c, c.words.has("banker") ? "dome" : "empire", 0, 0.1, 0.08);
    for (const part of sub.parts) b.add(part.mesh.translate([span / 2 - 0.08, h - 0.17, 0]), part.material);
    return b;
  }
  // An articulated arm: up and back, a joint, out and down, then the head.
  const elbow: Vec3 = [x0 + span * 0.15, h * 0.62, 0];
  const wrist: Vec3 = [span / 2 - 0.08, h - 0.05, 0];
  b.add(tube([[x0, 0.03, 0], elbow], 0.007, { segments: 10 }), metalPart);
  b.add(tube([elbow, wrist], 0.007, { segments: 10 }), metalPart);
  b.add(sphere(0.014, { segments: 14, rings: 8 }).translate(elbow), metalPart);
  b.add(sphere(0.012, { segments: 14, rings: 8 }).translate(wrist), metalPart);
  const head = new Build();
  addShade(head, c, "cone", 0, 0.12, 0.075);
  for (const part of head.parts) b.add(part.mesh, part.material, compose(translation([wrist[0], wrist[1] - 0.02, 0]), rotationZ(Math.PI * 0.85), translation([0, -0.12, 0])));
  return b;
}

function sconce(c: Context): Build {
  const b = new Build();
  const { w, d, h } = c.size;
  const material = baseMaterial(c);
  b.add(roundedBox({ size: [0.1, 0.16, 0.02], radius: 0.008, segments: 3 }).translate([0, h * 0.4, -d / 2 + 0.01]), material);
  b.add(tube([[0, h * 0.4, -d / 2 + 0.02], [0, h * 0.4, d * 0.1], [0, h * 0.55, d * 0.2]], 0.008, { segments: 10 }), material);
  const sub = new Build();
  addShade(sub, c, shadeShapeOf(c), 0, clamp(h * 0.45, 0.12, 0.24), clamp(Math.min(w, d) / 2, 0.06, 0.14));
  for (const part of sub.parts) b.add(part.mesh.translate([0, h * 0.5, d * 0.2]), part.material);
  return b;
}
