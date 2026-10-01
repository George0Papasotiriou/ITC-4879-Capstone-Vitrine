/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Tests for the shop window's room grammar: true sizes, nothing overlapping, each piece where its part puts it, and a shot that frames it all.
 */

import { describe, expect, it } from "vitest";

import { arrangeScene, footprintOverlap, frameShot, project, sceneBounds, turnedHalfExtents, type Placement, type ScenePiece, type SceneLayout } from "@/lib/display/scene";
import type { TemplateId } from "@/lib/optimize/templates";

/** Sizes measured from the shop's own scans (metres): a chair, a sofa, a side table, lamps, a bed, a pendant, a vase, a pillow, an ottoman. */
const piece = (id: string, role: string | null, kind: string, size: [number, number, number], extra: Partial<ScenePiece> = {}): ScenePiece => ({
  id,
  role,
  kind,
  quantity: 1,
  size: { x: size[0], y: size[1], z: size[2] },
  form: "scan",
  hangs: false,
  ...extra,
});

const CHAIR = piece("chair", "chair", "CHAIR", [0.7, 1.15, 0.78]);
const SIDE_TABLE = piece("table", "side-table", "TABLE", [0.42, 0.61, 0.42]);
const FLOOR_LAMP = piece("lamp", "lamp", "LAMP", [0.24, 1.63, 0.62]);
const TABLE_LAMP = piece("lamp", "lamp", "LAMP", [0.3, 0.55, 0.3]);
const RUG = piece("rug", "rug", "RUG", [1.6, 0.01, 2.3], { form: "rug" });

const SETS: Record<TemplateId, ScenePiece[]> = {
  "reading-corner": [CHAIR, SIDE_TABLE, FLOOR_LAMP, RUG],
  "living-room": [
    piece("sofa", "sofa", "SOFA", [2.36, 0.95, 0.94]),
    piece("coffee", "coffee-table", "TABLE", [1.1, 0.45, 0.6]),
    piece("lamp", "lighting", "LAMP", [0.4, 1.6, 0.4]),
    piece("ottoman", "accent-seat", "OTTOMAN", [1.47, 0.48, 0.46]),
    RUG,
  ],
  dining: [piece("table", "table", "TABLE", [1.8, 0.76, 0.9]), piece("chair", "chairs", "CHAIR", [0.5, 0.9, 0.55], { quantity: 4 }), piece("pendant", "pendant", "LIGHT_FIXTURE", [0.48, 1.76, 0.44], { hangs: true })],
  bedroom: [
    piece("bed", "bed", "BED", [1.6, 1.27, 2.5]),
    piece("lamp", "bedside-lamp", "LAMP", [0.3, 0.55, 0.3], { quantity: 2 }),
    piece("pillow", "pillows", "PILLOW", [0.44, 0.42, 0.15], { quantity: 2 }),
    RUG,
  ],
  "gift-set": [piece("vase", "centrepiece", "VASE", [0.16, 0.2, 0.16]), piece("pillow", "soft", "PILLOW", [0.44, 0.42, 0.15]), piece("art", "wall", "WALL_ART", [0.6, 0.8, 0.03], { form: "wall" })],
};

/** Footprints as the layout treats them: the plinth's for a piece on a plinth, none for rugs, pendants, wall pieces and pieces on pieces. */
function footprints(layout: SceneLayout): { key: string; corners: { x: number; z: number }[]; placement: Placement }[] {
  return layout.placements
    .filter((entry) => entry.form !== "rug" && entry.form !== "wall" && !entry.hangs && (entry.support === null || entry.support.startsWith("plinth:")))
    .map((entry) => {
      const plinth = layout.plinths.find((candidate) => candidate.id === entry.support);
      const halfX = plinth === undefined ? entry.size.x / 2 : plinth.size.x / 2;
      const halfZ = plinth === undefined ? entry.size.z / 2 : plinth.size.z / 2;
      const angle = plinth === undefined ? entry.rotationY : 0;
      const c = Math.cos(angle);
      const s = Math.sin(angle);
      const corners = [
        [-halfX, -halfZ],
        [halfX, -halfZ],
        [halfX, halfZ],
        [-halfX, halfZ],
      ].map(([dx, dz]) => ({ x: entry.position.x + c * dx! + s * dz!, z: entry.position.z - s * dx! + c * dz! }));
      return { key: entry.key, corners, placement: entry };
    });
}

const facing = (entry: Placement) => ({ x: Math.sin(entry.rotationY), z: Math.cos(entry.rotationY) });

describe("arrangeScene", () => {
  for (const template of Object.keys(SETS) as TemplateId[]) {
    it(`${template}: every piece drawn at its own size, none overlapping, all inside the room`, () => {
      const layout = arrangeScene(template, SETS[template]);
      const expected = SETS[template].reduce((sum, entry) => sum + entry.quantity, 0);
      expect(layout.placements).toHaveLength(expected);
      for (const entry of layout.placements) {
        // Nothing is ever scaled: the size placed is the size given.
        expect(entry.size).toEqual(SETS[template].find((candidate) => candidate.id === entry.id)!.size);
      }
      const solid = footprints(layout);
      for (let i = 0; i < solid.length; i += 1) {
        for (let j = i + 1; j < solid.length; j += 1) {
          const nested = template === "dining" && [solid[i]!.placement.id, solid[j]!.placement.id].includes("table") && [solid[i]!.placement.id, solid[j]!.placement.id].includes("chair");
          if (nested) continue;
          expect(footprintOverlap(solid[i]!.corners, solid[j]!.corners), `${solid[i]!.key} and ${solid[j]!.key}`).toBeNull();
        }
      }
      const { room, bounds } = layout;
      expect(bounds.min.x).toBeGreaterThan(room.minX);
      expect(bounds.max.x).toBeLessThan(room.maxX);
      expect(bounds.min.z).toBeGreaterThanOrEqual(room.backZ);
      expect(bounds.max.z).toBeLessThan(room.frontZ);
      expect(bounds.max.y).toBeLessThanOrEqual(room.height + 1e-9);
    });
  }

  it("is the same whatever order the pieces come in", () => {
    for (const template of Object.keys(SETS) as TemplateId[]) {
      expect(arrangeScene(template, [...SETS[template]].reverse())).toEqual(arrangeScene(template, SETS[template]));
    }
  });

  it("reading corner: the side table at the chair's arm, a floor lamp at its other shoulder, the rug under the front", () => {
    const layout = arrangeScene("reading-corner", SETS["reading-corner"]);
    const at = (id: string) => layout.placements.find((entry) => entry.id === id)!;
    expect(at("chair").position).toMatchObject({ x: 0, z: 0 });
    expect(at("table").position.x).toBeGreaterThan(0.3);
    expect(at("lamp").position.x).toBeLessThan(-0.3);
    expect(at("lamp").support).toBeNull();
    // The rug's front edge runs a little in front of the group.
    expect(at("rug").position.z + RUG.size.z / 2).toBeGreaterThan(at("chair").position.z);
  });

  it("a table lamp stands on the side table, not the floor", () => {
    const layout = arrangeScene("reading-corner", [CHAIR, SIDE_TABLE, TABLE_LAMP]);
    const lamp = layout.placements.find((entry) => entry.id === "lamp")!;
    expect(lamp.support).toBe("table#0");
    expect(lamp.position.y).toBeCloseTo(SIDE_TABLE.size.y, 6);
  });

  it("dining: four chairs face the table, the front left open for the street, the pendant over the table's centre", () => {
    const layout = arrangeScene("dining", SETS.dining);
    const chairs = layout.placements.filter((entry) => entry.id === "chair");
    expect(chairs).toHaveLength(4);
    for (const chair of chairs) {
      // Facing the nearest edge of the 1.8 × 0.9 m top, as a seat at a table does.
      const nearest = { x: Math.max(-0.9, Math.min(0.9, chair.position.x)), z: Math.max(-0.45, Math.min(0.45, chair.position.z)) };
      const towards = { x: nearest.x - chair.position.x, z: nearest.z - chair.position.z };
      const length = Math.hypot(towards.x, towards.z);
      const f = facing(chair);
      expect((f.x * towards.x + f.z * towards.z) / length).toBeGreaterThan(0.99);
      // Nobody sits with their back to the street.
      expect(chair.position.z).toBeLessThanOrEqual(0.001);
    }
    const pendant = layout.placements.find((entry) => entry.id === "pendant")!;
    expect(pendant.position).toMatchObject({ x: 0, z: 0 });
    // Its lowest point is well above the table top.
    expect(pendant.position.y - pendant.size.y).toBeGreaterThan(0.76 + 0.3);
  });

  it("bedroom: a lamp on a plinth either side of the bed, pillows on the bed at the headboard", () => {
    const layout = arrangeScene("bedroom", SETS.bedroom);
    const lamps = layout.placements.filter((entry) => entry.id === "lamp");
    expect(lamps.map((lamp) => Math.sign(lamp.position.x)).sort()).toEqual([-1, 1]);
    for (const lamp of lamps) expect(lamp.support?.startsWith("plinth:")).toBe(true);
    const pillows = layout.placements.filter((entry) => entry.id === "pillow");
    expect(pillows).toHaveLength(2);
    for (const pillow of pillows) {
      expect(pillow.support).toBe("bed#0");
      expect(pillow.position.z).toBeLessThan(0);
      expect(Math.abs(pillow.position.x)).toBeLessThan(0.8);
    }
  });

  it("gift set: the centrepiece on the tallest plinth, the picture on the back wall beside the group, centred at its tallest top", () => {
    const layout = arrangeScene("gift-set", SETS["gift-set"]);
    const vase = layout.placements.find((entry) => entry.id === "vase")!;
    const plinth = layout.plinths.find((entry) => entry.id === vase.support)!;
    expect(plinth.size.y).toBe(Math.max(...layout.plinths.map((entry) => entry.size.y)));
    const art = layout.placements.find((entry) => entry.id === "art")!;
    const gap = art.position.z - art.size.z / 2 - layout.room.backZ;
    expect(gap).toBeGreaterThanOrEqual(0);
    expect(gap).toBeLessThan(0.01);
    const tallest = Math.max(...layout.placements.filter((entry) => entry.form !== "wall").map((entry) => entry.position.y + entry.size.y));
    expect(art.position.y + art.size.y / 2).toBeCloseTo(tallest, 6);
    // Beside the plinths, never in front of or behind them.
    expect(art.position.x + art.size.x / 2).toBeLessThan(Math.min(...layout.plinths.map((entry) => entry.position.x - entry.size.x / 2)));
  });

  it("a window from a search still stands every piece, the largest in the middle", () => {
    const layout = arrangeScene(null, [CHAIR, SIDE_TABLE, piece("vase", null, "VASE", [0.16, 0.2, 0.16])]);
    expect(layout.placements).toHaveLength(3);
    expect(layout.placements.find((entry) => entry.id === "chair")!.position).toMatchObject({ x: 0, z: 0 });
    expect(layout.plinths).toHaveLength(1);
  });

  it("never overlaps, whatever the sizes (200 generated sets)", () => {
    let seed = 7;
    const random = () => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed / 2_147_483_648;
    };
    const templates = Object.keys(SETS) as TemplateId[];
    for (let run = 0; run < 200; run += 1) {
      const template = templates[run % templates.length]!;
      const set = SETS[template].map((entry) =>
        entry.form === "scan" ? { ...entry, size: { x: entry.size.x * (0.5 + random()), y: entry.size.y * (0.6 + random() * 0.8), z: entry.size.z * (0.5 + random()) } } : entry,
      );
      const layout = arrangeScene(template, set);
      const solid = footprints(layout);
      for (let i = 0; i < solid.length; i += 1) {
        for (let j = i + 1; j < solid.length; j += 1) {
          const ids = [solid[i]!.placement.id, solid[j]!.placement.id];
          if (template === "dining" && ids.includes("table") && ids.includes("chair")) continue;
          expect(footprintOverlap(solid[i]!.corners, solid[j]!.corners), `run ${run}: ${ids.join(" and ")}`).toBeNull();
        }
      }
    }
  });
});

describe("footprints and the separating axis test", () => {
  const square = (x: number, z: number, half = 0.5) => [
    { x: x - half, z: z - half },
    { x: x + half, z: z - half },
    { x: x + half, z: z + half },
    { x: x - half, z: z + half },
  ];

  it("finds the smallest push, pointing from the first to the second", () => {
    expect(footprintOverlap(square(0, 0), square(0.8, 0))).toMatchObject({ x: 1, z: 0 });
    expect(footprintOverlap(square(0, 0), square(0.8, 0))!.depth).toBeCloseTo(0.2, 9);
    expect(footprintOverlap(square(0, 0), square(0, -0.9))).toMatchObject({ z: -1 });
    expect(footprintOverlap(square(0, 0), square(1.01, 0))).toBeNull();
  });

  it("measures a turned rectangle's box", () => {
    expect(turnedHalfExtents({ x: 2, z: 1 }, 0)).toEqual({ x: 1, z: 0.5 });
    const quarter = turnedHalfExtents({ x: 2, z: 1 }, Math.PI / 2);
    expect(quarter.x).toBeCloseTo(0.5, 9);
    expect(quarter.z).toBeCloseTo(1, 9);
  });
});

describe("frameShot", () => {
  const bounds = { min: { x: -1.4, y: 0, z: -0.6 }, max: { x: 1.2, y: 1.6, z: 1.1 } };
  const corners = [bounds.min.x, bounds.max.x].flatMap((x) => [bounds.min.y, bounds.max.y].flatMap((y) => [bounds.min.z, bounds.max.z].map((z) => ({ x, y, z }))));

  for (const aspect of [0.6, 1, 1.78, 2.4]) {
    it(`fits the whole set and no more at aspect ${aspect}`, () => {
      const shot = frameShot(bounds, aspect, { margin: 0.1 });
      const inside = (eye: typeof shot.position) => corners.every((corner) => {
        const p = project(corner, eye, shot.target, shot.fovDeg, aspect);
        return Math.abs(p.x) <= 0.9 + 1e-3 && Math.abs(p.y) <= 0.9 + 1e-3;
      });
      expect(inside(shot.position)).toBe(true);
      // 3% closer and something falls outside: the shot is tight, not just safe.
      const closer = {
        x: shot.target.x + (shot.position.x - shot.target.x) * 0.97,
        y: shot.target.y + (shot.position.y - shot.target.y) * 0.97,
        z: shot.target.z + (shot.position.z - shot.target.z) * 0.97,
      };
      expect(inside(closer)).toBe(false);
      // The camera stands on the street side, above the floor.
      expect(shot.position.z).toBeGreaterThan(bounds.max.z);
      expect(shot.position.y).toBeGreaterThan(shot.target.y);
    });
  }

  it("a narrower screen needs the camera further back", () => {
    expect(frameShot(bounds, 0.6).position.z).toBeGreaterThan(frameShot(bounds, 1.78).position.z);
  });

  it("bounds include a pendant from its top down, and plinths", () => {
    const box = sceneBounds(
      [{ key: "p#0", id: "p", copy: 0, position: { x: 0, y: 2.9, z: 0 }, rotationY: 0, tiltX: 0, support: null, size: { x: 0.4, y: 1.2, z: 0.4 }, form: "scan", hangs: true }],
      [{ id: "plinth:x", position: { x: 1, y: 0, z: 0 }, size: { x: 0.4, y: 0.9, z: 0.4 } }],
    );
    expect(box.min.y).toBe(0);
    expect(box.max.y).toBeCloseTo(2.9, 9);
    expect(box.max.x).toBeCloseTo(1.2, 9);
  });
});
