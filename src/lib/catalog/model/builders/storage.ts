/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Storage: chests of drawers, cabinets, sideboards and TV stands, bookcases, ladder shelves, étagères, cube units, clothes racks.
 */

import { block, clamp, frameOf, legStyleOf, metalFrame, surfaceOf, type Context } from "@/lib/catalog/model/context";
import { cylinder, roundedBox, roundedPolyline, tube } from "@/lib/catalog/model/geometry";
import { glass, metal, mix, rubber, type MaterialSpec } from "@/lib/catalog/model/materials";
import { compose, rotationX, translation, type Vec3 } from "@/lib/catalog/model/mesh";
import { Build, castor, drawerFronts, handle, leg, placeLeg, shakerDoor, type HandleStyle } from "@/lib/catalog/model/parts";

/**
 * docs/adr/058. A case piece is a box (the carcase) on a base — legs, a
 * plinth or bun feet — with a top that overhangs it a little, and a front
 * made of drawers, doors or open shelves. Drawer and door fronts stand a few
 * millimetres proud of the carcase with real gaps between them, so the light
 * draws their outlines, and carry handles in the finish the words name.
 */

export function buildStorage(c: Context): Build {
  const { words } = c;
  const kind = c.facts.kind;
  // The clothes-rack kind also files shoe cabinets and TV stands: a rail is drawn only when the words say rack.
  const isCase = words.has("cabinet", "cupboard", "tv stand", "drawer", "drawers", "door", "doors", "organizer", "organiser");
  if (words.has("garment rack", "clothes rack", "coat rack", "clothing rack", "hanging rack", "rolling rack") || (kind === "CLOTHES_RACK" && !isCase && !words.has("shoe", "shelf", "shelves"))) return rack(c);
  if (words.has("shoe rack", "shoe shelf", "shoe storage") && !words.has("cabinet", "cupboard", "door", "doors")) return bookcase(c);
  if (words.has("ladder")) return ladder(c);
  if (words.has("etagere", "wire shelf", "wire shelving", "metal shelf", "metal shelves", "industrial shelf", "bakers rack")) return etagere(c);
  if (words.has("cube", "cubes", "cubby", "cubbies", "cube organizer", "cube storage")) return cubes(c);
  if (kind === "SHELF" || words.has("bookcase", "bookshelf", "book shelf", "shelving unit", "display shelf", "open shelf")) return bookcase(c);
  if (kind === "DRESSER" || kind === "STORAGE_DRAWER" || words.has("dresser", "chest of drawers", "drawer chest", "tallboy", "lowboy")) return chest(c);
  if (words.has("tv stand", "media console", "media cabinet", "entertainment", "tv console")) return media(c);
  if (words.has("sideboard", "buffet", "credenza")) return sideboard(c);
  if (words.has("drawer", "drawers") && !words.has("door", "doors")) return chest(c);
  return cabinet(c);
}

type Base = { height: number; kind: "legs" | "plinth" | "bun" };

function baseFor(c: Context): Base {
  const { words } = c;
  const h = c.size.h;
  if (words.has("bun feet", "bun foot")) return { height: 0.06, kind: "bun" };
  if (words.has("legs", "tapered", "mid century", "midcentury", "hairpin", "metal legs", "raised", "retro")) return { height: clamp(h * 0.16, 0.1, 0.22), kind: "legs" };
  if (words.has("plinth", "kick", "toe kick", "base")) return { height: 0.06, kind: "plinth" };
  return words.has("modern", "contemporary", "scandinavian") ? { height: clamp(h * 0.14, 0.1, 0.18), kind: "legs" } : { height: 0.05, kind: "plinth" };
}

/**
 * The carcase on its base, with its top. Returns where the front's usable
 * area is: from `bottom` to `top` in height, at `front` in depth.
 */
function carcase(c: Context, b: Build, body: MaterialSpec, base: Base): { bottom: number; top: number; front: number } {
  const { w, d, h } = c.size;
  const topT = clamp(h * 0.03, 0.02, 0.035);
  const overhang = 0.012;
  block(b, body, [0, h - topT / 2, 0], [w, topT, d], 0.004, 0);
  const caseW = w - 2 * overhang;
  const caseD = d - overhang;
  block(b, body, [0, (base.height + h - topT) / 2, -overhang / 2], [caseW, h - topT - base.height, caseD], 0.003, 1);
  const frame = frameOf(c);
  if (base.kind === "plinth") {
    // A recessed plinth, a shade darker: it sits in the shadow under the carcase.
    const plinth = { ...body, key: `${body.key}:plinth`, colour: mix(body.colour, { r: 0, g: 0, b: 0 }, 0.18) };
    block(b, plinth, [0, base.height / 2, -overhang / 2 - 0.015], [caseW - 0.04, base.height, caseD - 0.04], 0.003, 0);
  } else if (base.kind === "bun") {
    for (const x of [-caseW / 2 + 0.05, caseW / 2 - 0.05]) for (const z of [-caseD / 2 + 0.04, caseD / 2 - 0.05]) b.add(leg("bun", base.height + 0.005, 0.08).translate([x, 0, z - overhang / 2]), frame);
  } else {
    const style = legStyleOf(c, "tapered");
    const t = style === "tapered" ? 0.045 : style.startsWith("metal") ? 0.03 : 0.05;
    const splay = style === "tapered" ? 0.1 : 0;
    for (const x of [-caseW / 2 + 0.05, caseW / 2 - 0.05]) for (const z of [-caseD / 2 + 0.05, caseD / 2 - 0.06]) b.add(placeLeg(leg(style, (base.height + 0.01) / Math.cos(splay), t), { x, z: z - overhang / 2, top: base.height + 0.01 }, splay), frame);
  }
  return { bottom: base.height, top: h - topT, front: d / 2 - overhang };
}

function handleStyleOf(c: Context): HandleStyle {
  const { words } = c;
  if (words.has("knob", "knobs")) return "knob";
  if (words.has("cup pull", "bin pull", "farmhouse")) return "cup";
  if (words.has("ring pull", "ring pulls", "campaign")) return "ring";
  if (words.has("handleless", "push to open", "cutout handle", "cut out handle")) return "none";
  return words.has("traditional", "classic", "country", "cottage") ? "knob" : "bar";
}

function handleMaterialOf(c: Context): MaterialSpec {
  const { words } = c;
  if (words.has("brass", "gold")) return metal({ r: 214, g: 176, b: 102 }, "polished");
  if (words.has("chrome", "nickel", "silver", "stainless")) return metal({ r: 214, g: 214, b: 212 }, "brushed");
  if (words.has("bronze", "oil rubbed", "antique")) return metal({ r: 74, g: 58, b: 44 }, "brushed");
  return metal({ r: 40, g: 40, b: 42 }, "powder");
}

/** The front's material: the body's own, or a second colour where the piece is two-toned. */
function frontOf(c: Context, body: MaterialSpec): MaterialSpec {
  return c.words.has("two tone", "two toned", "two-tone") && c.palette.second !== null ? surfaceOf(c, c.palette.second) : body;
}

function chest(c: Context): Build {
  const b = new Build();
  const { w, h } = c.size;
  const body = surfaceOf(c);
  const area = carcase(c, b, body, baseFor(c));
  const count = c.words.countBefore("drawer") ?? (w > 1.1 ? 6 : h > 1.0 ? 5 : 3);
  const columns = count >= 6 && w > 0.9 ? (count % 3 === 0 && w > 1.4 ? 3 : 2) : 1;
  const rows = Math.max(1, Math.round(count / columns));
  const drawers = drawerFronts({ x: 0, y: area.bottom + 0.008, width: w - 0.05, height: area.top - area.bottom - 0.016, front: area.front }, rows, columns, { handleStyle: handleStyleOf(c), gap: 0.005 });
  b.add(drawers.fronts, frontOf(c, body));
  b.add(drawers.handles, handleMaterialOf(c));
  return b;
}

function cabinet(c: Context): Build {
  const b = new Build();
  const { w } = c.size;
  const body = surfaceOf(c);
  const area = carcase(c, b, body, baseFor(c));
  const glassDoors = c.words.has("glass door", "glass doors", "display", "curio", "china", "vitrine");
  const doors = w > 1.2 ? 4 : w > 0.55 ? 2 : 1;
  doorsAcross(c, b, body, area, -w / 2 + 0.025, w - 0.05, doors, glassDoors);
  return b;
}

/** A row of doors filling a width, each a shaker or glazed frame with a handle on its opening edge. */
function doorsAcross(c: Context, b: Build, body: MaterialSpec, area: { bottom: number; top: number; front: number }, left: number, width: number, count: number, glazed: boolean): void {
  const gap = 0.004;
  const each = (width - gap * (count + 1)) / count;
  const height = area.top - area.bottom - 2 * gap;
  const y = (area.top + area.bottom) / 2;
  const modern = c.words.has("modern", "contemporary", "minimalist", "flat") && !c.words.has("shaker");
  for (let i = 0; i < count; i += 1) {
    const x = left + gap + each / 2 + i * (each + gap);
    const door = modern && !glazed ? blockMesh(each, height) : shakerDoor(each, height);
    b.add(door.translate([x, y, area.front + 0.01]), frontOf(c, body));
    if (glazed) b.add(blockMesh(each * 0.76, height * 0.8, 0.004).translate([x, y, area.front + 0.006]), glass({ r: 200, g: 214, b: 214 }));
    // Handles meet in the middle of a pair.
    const opening = count === 1 ? 1 : i % 2 === 0 ? 1 : -1;
    const style = handleStyleOf(c);
    const handleMesh = handle(style === "none" ? "none" : style === "cup" ? "bar" : style, [x + opening * (each / 2 - 0.04), y, area.front + 0.02], each * 0.6);
    if (style === "bar") handleMesh.transform(compose(translation([x + opening * (each / 2 - 0.04), y, 0]), rotationZQuarter(), translation([-(x + opening * (each / 2 - 0.04)), -y, 0])));
    b.add(handleMesh, handleMaterialOf(c));
  }
}

/** Turn a horizontal bar handle upright, as a door's pull is mounted. */
function rotationZQuarter() {
  return [0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

/** A flat panel (a modern door, a pane of glass), centred on the origin. */
function blockMesh(width: number, height: number, depth = 0.02) {
  return roundedBox({ size: [width, height, depth], radius: 0.003, segments: 2, grain: 1 });
}

function sideboard(c: Context): Build {
  const b = new Build();
  const { w } = c.size;
  const body = surfaceOf(c);
  const area = carcase(c, b, body, baseFor(c));
  const drawerRow = c.words.has("drawer", "drawers") ? clamp((area.top - area.bottom) * 0.22, 0.1, 0.16) : 0;
  if (drawerRow > 0) {
    const drawers = drawerFronts({ x: 0, y: area.top - drawerRow, width: w - 0.05, height: drawerRow, front: area.front }, 1, w > 1.3 ? 3 : 2, { handleStyle: handleStyleOf(c) });
    b.add(drawers.fronts, frontOf(c, body));
    b.add(drawers.handles, handleMaterialOf(c));
  }
  doorsAcross(c, b, body, { ...area, top: area.top - drawerRow }, -w / 2 + 0.025, w - 0.05, w > 1.3 ? 4 : 2, c.words.has("glass"));
  return b;
}

function media(c: Context): Build {
  const b = new Build();
  const { w, d } = c.size;
  const body = surfaceOf(c);
  const area = carcase(c, b, body, baseFor(c));
  // Open in the middle (for the electronics), doors or drawers either side.
  const sideW = clamp(w * 0.28, 0.3, 0.55);
  const middleW = w - 0.05 - 2 * sideW;
  const shadow = { ...body, key: `${body.key}:inside`, colour: mix(body.colour, { r: 0, g: 0, b: 0 }, 0.45) };
  if (middleW > 0.2) {
    block(b, shadow, [0, (area.bottom + area.top) / 2, area.front - 0.006], [middleW, area.top - area.bottom - 0.03, 0.01], 0.002, 0);
    block(b, body, [0, (area.bottom + area.top) / 2, area.front - d * 0.4], [middleW, 0.018, d * 0.8], 0.002, 0);
  }
  for (const side of [-1, 1]) {
    const left = side < 0 ? -w / 2 + 0.025 : w / 2 - 0.025 - sideW;
    if (c.words.has("drawer", "drawers") && side > 0) {
      const drawers = drawerFronts({ x: left + sideW / 2, y: area.bottom + 0.01, width: sideW, height: area.top - area.bottom - 0.02, front: area.front }, 2, 1, { handleStyle: handleStyleOf(c) });
      b.add(drawers.fronts, frontOf(c, body));
      b.add(drawers.handles, handleMaterialOf(c));
    } else {
      doorsAcross(c, b, body, area, left, sideW, 1, c.words.has("glass"));
    }
  }
  return b;
}

function bookcase(c: Context): Build {
  const b = new Build();
  const { w, d, h } = c.size;
  const body = surfaceOf(c);
  const side = clamp(w * 0.04, 0.016, 0.03);
  const back = { ...body, key: `${body.key}:back`, colour: mix(body.colour, { r: 0, g: 0, b: 0 }, 0.22) };
  for (const s of [-1, 1]) block(b, body, [s * (w / 2 - side / 2), h / 2, 0], [side, h, d], 0.003, 1);
  block(b, body, [0, h - side / 2, 0], [w, side, d], 0.003, 0);
  const kick = 0.05;
  block(b, body, [0, kick / 2, d / 2 - 0.03], [w - 2 * side, kick, 0.018], 0.002, 0);
  if (!c.words.has("open back", "backless")) block(b, back, [0, h / 2, -d / 2 + 0.004], [w - 2 * side, h - side, 0.008], 0.001, 1);
  const shelves = Math.max(1, Math.round((h - kick - side) / 0.33));
  for (let i = 0; i <= shelves; i += 1) {
    const y = kick + ((h - kick - side) * i) / shelves;
    if (y > h - side - 0.02) continue;
    block(b, body, [0, y + 0.009, 0], [w - 2 * side, 0.018, d - 0.01], 0.002, 0);
  }
  if (c.words.has("doors", "door", "cabinet")) {
    doorsAcross(c, b, body, { bottom: kick, top: kick + (h - kick) * 0.32, front: d / 2 }, -w / 2 + side, w - 2 * side, w > 0.6 ? 2 : 1, false);
  }
  return b;
}

function ladder(c: Context): Build {
  const b = new Build();
  const { w, d, h } = c.size;
  const isMetal = metalFrame(c);
  const rails = frameOf(c);
  const boards = surfaceOf(c, isMetal ? (c.palette.second ?? c.palette.main) : c.palette.main);
  const lean = Math.atan2(d * 0.8, h);
  const length = h / Math.cos(lean);
  for (const s of [-1, 1]) {
    b.add(roundedBox({ size: [0.035, length, 0.04], radius: 0.006, grain: 1 }), rails, compose(translation([s * (w / 2 - 0.018), h / 2, 0]), rotationX(-lean)));
  }
  const shelves = clamp(Math.round(h / 0.38), 3, 6);
  for (let i = 0; i < shelves; i += 1) {
    const t = (i + 0.4) / shelves;
    const y = h * t * 0.94;
    const depth = d * (1 - t) * 0.92 + 0.12;
    const z = d / 2 - depth / 2 - (d * 0.8 * t) * 0.5 + 0.02;
    block(b, boards, [0, y, z - (d * 0.8 * t) / 2 + d * 0.4], [w - 0.07, 0.022, Math.min(depth, d)], 0.003, 0);
  }
  return b;
}

function etagere(c: Context): Build {
  const b = new Build();
  const { w, d, h } = c.size;
  const posts = frameOf(c, { preferMetal: true });
  const boards = c.words.has("glass") ? glass() : surfaceOf(c, c.palette.second ?? c.palette.main);
  for (const x of [-w / 2 + 0.015, w / 2 - 0.015]) for (const z of [-d / 2 + 0.015, d / 2 - 0.015]) b.add(cylinder(0.012, h, { bevel: 0.003, segments: 14 }).translate([x, 0, z]), posts);
  const shelves = clamp(Math.round(h / 0.38), 2, 6);
  for (let i = 0; i < shelves; i += 1) {
    const y = 0.08 + ((h - 0.1) * i) / (shelves - 1);
    block(b, boards, [0, Math.min(y, h - 0.012), 0], [w - 0.01, 0.02, d - 0.01], 0.003, 0);
  }
  if (c.words.has("industrial", "x back", "cross")) {
    for (const s of [-1, 1]) b.add(tube([[-w / 2 + 0.02, 0.1, -d / 2 + 0.02], [w / 2 - 0.02, h - 0.1, -d / 2 + 0.02]].map(([x, y, z]) => [x! * s, y!, z!] as Vec3), 0.006), posts);
  }
  return b;
}

function cubes(c: Context): Build {
  const b = new Build();
  const { w, d, h } = c.size;
  const body = surfaceOf(c);
  const back = { ...body, key: `${body.key}:back`, colour: mix(body.colour, { r: 0, g: 0, b: 0 }, 0.25) };
  const columns = Math.max(1, Math.round(w / 0.36));
  const rows = Math.max(1, Math.round(h / 0.36));
  const t = 0.016;
  block(b, back, [0, h / 2, -d / 2 + 0.004], [w - 0.01, h - 0.01, 0.008], 0.001, 1);
  for (let i = 0; i <= columns; i += 1) block(b, body, [-w / 2 + t / 2 + ((w - t) * i) / columns, h / 2, 0], [t, h, d], 0.002, 1);
  for (let j = 0; j <= rows; j += 1) block(b, body, [0, t / 2 + ((h - t) * j) / rows, 0], [w, t, d], 0.002, 0);
  // Fabric bins in some cubbies, where the listing includes them.
  if (c.words.has("bins", "bin", "baskets", "fabric drawers")) {
    const binColour = c.palette.second ?? mix(body.colour, { r: 120, g: 110, b: 100 }, 0.6);
    const bin = { ...surfaceOf(c, binColour), key: `bin:${binColour.r},${binColour.g},${binColour.b}`, texture: "linen" as const, roughness: 1, clearcoat: undefined };
    const cellW = (w - t) / columns - t;
    const cellH = (h - t) / rows - t;
    for (let j = 0; j < rows; j += 2) for (let i = 0; i < columns; i += 1) block(b, bin, [-w / 2 + t + cellW / 2 + i * (cellW + t), t + cellH / 2 + j * (cellH + t), 0.01], [cellW - 0.01, cellH - 0.01, d - 0.03], 0.01);
  }
  return b;
}

function rack(c: Context): Build {
  const b = new Build();
  const { w, d, h } = c.size;
  const steel = frameOf(c, { preferMetal: true });
  const castors = c.words.has("wheels", "casters", "castors", "rolling");
  const footY = castors ? 0.07 : 0.02;
  const rail = roundedPolyline(
    [
      [-w / 2 + 0.02, footY, 0],
      [-w / 2 + 0.02, h - 0.015, 0],
      [w / 2 - 0.02, h - 0.015, 0],
      [w / 2 - 0.02, footY, 0],
    ],
    0.05,
    8,
  );
  b.add(tube(rail, 0.013, { segments: 12 }), steel);
  for (const x of [-w / 2 + 0.02, w / 2 - 0.02]) {
    b.add(tube([[x, footY, -d / 2 + 0.02], [x, footY, d / 2 - 0.02]], 0.013, { segments: 12 }), steel);
    if (castors) for (const z of [-d / 2 + 0.03, d / 2 - 0.03]) {
      const wheel = castor(0.055);
      b.add(wheel.wheel.translate([x, 0, z]), rubber());
      b.add(wheel.fork.translate([x, 0, z]), rubber());
    }
  }
  if (c.words.has("shelf", "shelves", "storage", "shoe")) {
    const boards = c.words.has("wood", "bamboo") ? surfaceOf(c, c.palette.second ?? c.palette.main) : steel;
    block(b, boards, [0, footY + 0.12, 0], [w - 0.05, 0.018, d - 0.05], 0.003, 0);
  }
  return b;
}

