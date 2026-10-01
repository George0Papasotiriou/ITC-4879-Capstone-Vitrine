/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Standing a window display in a 3D room: where each piece goes, by the part it plays in the set.
 */

import type { TemplateId } from "@/lib/optimize/templates";

/**
 * docs/adr/048. The shop window is a real room drawn in 3D, and every piece in
 * it is drawn at its true size: nothing here ever scales a piece. What this
 * module decides is WHERE each one goes, the way a stylist dresses a window —
 * by the part the piece plays in the set (its Budget Stylist slot):
 *
 *   anchor     the piece the set is built around (chair, sofa, bed, table)
 *   beside     a side table at the chair's arm, a floor lamp at its shoulder
 *   facing     the coffee table in front of the sofa, 45 cm of legroom away
 *   around     dining chairs at the table's ends and back, tucked in 10 cm
 *   flank      bedside lamps either side of the bed
 *   above      a pendant hanging over the table, from the ceiling
 *   under      a rug under the front of the group
 *   on         pillows on the bed, a table lamp on the side table
 *   plinth     small pieces (vases, table lamps, a pillow with nowhere to sit)
 *              on shop plinths, as a real shop window shows them
 *   wall       a picture or mirror hung on the back wall, centred at 1.45 m
 *
 * COORDINATES. Metres. The floor is y = 0, x runs left to right, and +z points
 * out of the window towards the street (and the camera). A rotation θ about the
 * vertical turns a piece's front from +z towards +x: its facing direction is
 * (sin θ, 0, cos θ). A pendant's origin is at its top.
 *
 * NO COLLISIONS. Each standing piece (or the plinth it stands on) has a
 * footprint: its x × z rectangle, turned by θ. Two footprints overlap exactly
 * when no separating axis exists among their four edge normals (the separating
 * axis theorem for convex polygons). When two overlap, the one that is not the
 * anchor is pushed out along the axis of least overlap — the minimum
 * translation vector — plus a 3 cm gap, and the check repeats until nothing
 * overlaps. A rug, a pendant, a picture on the wall and a piece standing on
 * another have no footprint of their own; dining chairs are allowed under the
 * table's top, which is where they belong.
 *
 * The room is built around the set afterwards: the back wall just behind the
 * anchor, room for the light at each side, and the floor running out to the
 * glass. The camera's shot is computed from the set's bounding box (frameShot).
 */

export type Vec3 = { x: number; y: number; z: number };

/** How a piece is drawn: its own 3D scan, or its photograph as a rug, a picture on the wall, or a cut-out. */
export type PieceForm = "scan" | "rug" | "wall" | "photo";

export type ScenePiece = {
  id: string;
  /** The Stylist slot it fills ("chair", "lamp", …); null when the window came from a search. */
  role: string | null;
  kind: string;
  quantity: number;
  /** Size in metres as drawn: x across, y up, z front to back. For a scan, measured from the scan itself. */
  size: Vec3;
  form: PieceForm;
  /** A pendant: drawn hanging from the ceiling, its origin at its top. */
  hangs: boolean;
};

export type Placement = {
  /** `<product id>#<copy>`: four dining chairs are one product, four placements. */
  key: string;
  id: string;
  copy: number;
  /** The centre of its footprint (x, z) and the height its base stands at (y); for a pendant, its top. */
  position: Vec3;
  rotationY: number;
  /** Leaning back (a pillow against a headboard), radians about x. */
  tiltX: number;
  /**
   * What it stands on: null for the floor, `plinth:<key>`, or another placement's
   * key. A piece on another piece is settled onto that piece's real surface when
   * the scene is drawn; `position.y` here is the estimate.
   */
  support: string | null;
  size: Vec3;
  form: PieceForm;
  hangs: boolean;
};

export type Plinth = { id: string; position: Vec3; size: Vec3 };

export type Room = { minX: number; maxX: number; backZ: number; frontZ: number; height: number };

export type Bounds = { min: Vec3; max: Vec3 };

export type SceneLayout = { placements: Placement[]; plinths: Plinth[]; room: Room; bounds: Bounds };

export const CEILING_M = 2.9;
const WALL_GAP = 0.08;
const SIDE_ROOM = 1.25;
const FRONT_ROOM = 1.5;
const PUSH_GAP = 0.03;
const PLINTH_HEIGHTS = [0.3, 0.45, 0.6, 0.75, 0.9] as const;
const WALL_CENTRE_M = 1.45;

const LAMP_KINDS = new Set(["LAMP", "HOME_LIGHTING_AND_LAMPS"]);
const SMALL_KINDS = new Set(["VASE", "PLANTER", "CANDLE", "PILLOW"]);

/** A lamp shorter than a metre stands on something; a taller one stands on the floor. */
const isTableLamp = (piece: ScenePiece) => LAMP_KINDS.has(piece.kind) && !piece.hangs && piece.size.y < 1;
/** Small things in a shop window stand on plinths. A floor planter does not. */
const isSmall = (piece: ScenePiece) => isTableLamp(piece) || (SMALL_KINDS.has(piece.kind) && piece.size.y < 0.75);

type Draft = Placement & {
  /** The footprint used for collisions: the plinth's, if it stands on one; none for rugs, pendants, wall pieces and pieces on pieces. */
  collider: { halfX: number; halfZ: number } | null;
  /** Keys it may overlap (dining chairs and their table). */
  nests: Set<string>;
  plinthHeight: number | null;
  /** Kept still while everything else is pushed clear of it. */
  fixed: boolean;
};

/** Half the extents of a turned rectangle's axis-aligned box. */
export function turnedHalfExtents(size: { x: number; z: number }, rotationY: number): { x: number; z: number } {
  const c = Math.abs(Math.cos(rotationY));
  const s = Math.abs(Math.sin(rotationY));
  return { x: (c * size.x + s * size.z) / 2, z: (s * size.x + c * size.z) / 2 };
}

/** The footprint of a plinth for a piece: its own footprint and a 6 cm margin, square, at least 32 cm. */
function plinthSide(piece: ScenePiece): number {
  return Math.max(0.32, Math.max(piece.size.x, piece.size.z) + 0.12);
}

/** The plinth height that brings a small piece's top near 1.05 m, from the shop's five heights. */
function plinthHeightFor(piece: ScenePiece, preferred?: number): number {
  const wanted = preferred ?? 1.05 - piece.size.y;
  return PLINTH_HEIGHTS.reduce((best, height) => (Math.abs(height - wanted) < Math.abs(best - wanted) ? height : best), PLINTH_HEIGHTS[0]);
}

function draft(piece: ScenePiece, copy: number, at: { x: number; z: number }, options: { rotationY?: number; y?: number; tiltX?: number; support?: string | null; plinth?: number | null; fixed?: boolean } = {}): Draft {
  const rotationY = options.rotationY ?? 0;
  const plinthHeight = options.plinth ?? null;
  const flat = piece.form === "rug" || piece.form === "wall" || piece.hangs;
  const onPiece = options.support !== undefined && options.support !== null && !options.support.startsWith("plinth:");
  const side = plinthSide(piece);
  const half = turnedHalfExtents(piece.size, rotationY);
  const key = `${piece.id}#${copy}`;
  return {
    key,
    id: piece.id,
    copy,
    position: { x: at.x, y: options.y ?? plinthHeight ?? 0, z: at.z },
    rotationY,
    tiltX: options.tiltX ?? 0,
    support: plinthHeight !== null ? `plinth:${key}` : (options.support ?? null),
    size: piece.size,
    form: piece.form,
    hangs: piece.hangs,
    collider: flat || onPiece ? null : plinthHeight !== null ? { halfX: side / 2, halfZ: side / 2 } : { halfX: half.x, halfZ: half.z },
    nests: new Set(),
    plinthHeight,
    fixed: options.fixed ?? false,
  };
}

/** Puts a small piece on a plinth, or a floor-sized one on the floor, at the same spot. */
function standing(piece: ScenePiece, copy: number, at: { x: number; z: number }, options: { rotationY?: number; plinthHeight?: number } = {}): Draft {
  return draft(piece, copy, at, { rotationY: options.rotationY ?? 0, plinth: isSmall(piece) ? plinthHeightFor(piece, options.plinthHeight) : null });
}

/** The pieces in a stable order: by their slot's place in the template, then by id. Input order never matters. */
function ordered(pieces: readonly ScenePiece[], roles: readonly string[]): ScenePiece[] {
  const rank = (piece: ScenePiece) => (piece.role === null ? roles.length : roles.indexOf(piece.role) === -1 ? roles.length : roles.indexOf(piece.role));
  return [...pieces].sort((a, b) => rank(a) - rank(b) || a.id.localeCompare(b.id));
}

const ROLES: Record<TemplateId, readonly string[]> = {
  "reading-corner": ["chair", "side-table", "lamp", "rug"],
  "living-room": ["sofa", "coffee-table", "lighting", "accent-seat", "rug"],
  dining: ["table", "chairs", "pendant"],
  bedroom: ["bed", "bedside-lamp", "pillows", "rug"],
  "gift-set": ["centrepiece", "soft", "wall"],
};

const copiesOf = (piece: ScenePiece) => Array.from({ length: Math.max(1, Math.min(8, piece.quantity)) }, (_, copy) => copy);

function readingCorner(pieces: ScenePiece[]): Draft[] {
  const byRole = (role: string) => pieces.find((piece) => piece.role === role);
  const chair = byRole("chair") ?? pieces.find((piece) => piece.form !== "rug" && piece.form !== "wall");
  const drafts: Draft[] = [];
  if (chair === undefined) return generic(pieces);
  // The chair turns a little towards the window, as a reader would.
  const turn = -0.26;
  const seat = draft(chair, 0, { x: 0, z: 0 }, { rotationY: turn, fixed: true });
  drafts.push(seat);
  const chairHalf = turnedHalfExtents(chair.size, turn);

  const table = byRole("side-table");
  let tableDraft: Draft | null = null;
  if (table !== undefined) {
    const half = turnedHalfExtents(table.size, 0);
    tableDraft = draft(table, 0, { x: chairHalf.x + 0.1 + half.x, z: chairHalf.z * 0.15 });
    drafts.push(tableDraft);
  }
  const lamp = byRole("lamp");
  if (lamp !== undefined) {
    if (isTableLamp(lamp) && tableDraft !== null) {
      drafts.push(draft(lamp, 0, { x: tableDraft.position.x, z: tableDraft.position.z - 0.04 }, { y: table!.size.y, support: tableDraft.key, rotationY: -0.4 }));
    } else {
      const half = turnedHalfExtents(lamp.size, 0.4);
      drafts.push(standing(lamp, 0, { x: -(chairHalf.x + 0.04 + half.x), z: -chairHalf.z + half.z }, { rotationY: 0.4, plinthHeight: 0.6 }));
    }
  }
  return [...drafts, ...leftovers(pieces, drafts)];
}

function livingRoom(pieces: ScenePiece[]): Draft[] {
  const byRole = (role: string) => pieces.find((piece) => piece.role === role);
  const sofa = byRole("sofa") ?? pieces.find((piece) => piece.form !== "rug" && piece.form !== "wall");
  if (sofa === undefined) return generic(pieces);
  const drafts: Draft[] = [draft(sofa, 0, { x: 0, z: 0 }, { fixed: true })];
  const table = byRole("coffee-table");
  let tableDraft: Draft | null = null;
  if (table !== undefined) {
    tableDraft = draft(table, 0, { x: 0, z: sofa.size.z / 2 + 0.45 + table.size.z / 2 });
    drafts.push(tableDraft);
  }
  const light = byRole("lighting");
  if (light !== undefined) {
    if (light.hangs) {
      drafts.push(draft(light, 0, { x: tableDraft?.position.x ?? 0, z: tableDraft?.position.z ?? sofa.size.z / 2 + 0.6 }, { y: CEILING_M }));
    } else {
      const half = turnedHalfExtents(light.size, 0.3);
      drafts.push(standing(light, 0, { x: -(sofa.size.x / 2 + 0.12 + half.x), z: -sofa.size.z / 2 + half.z + 0.05 }, { rotationY: 0.3, plinthHeight: 0.55 }));
    }
  }
  const seat = byRole("accent-seat");
  if (seat !== undefined) {
    // At the open front corner, turned in towards the table, like an extra seat pulled up.
    const z = tableDraft === null ? sofa.size.z / 2 + 0.6 : tableDraft.position.z + 0.05;
    drafts.push(draft(seat, 0, { x: sofa.size.x / 2 - seat.size.x * 0.1, z }, { rotationY: -0.55 }));
  }
  return [...drafts, ...leftovers(pieces, drafts)];
}

function dining(pieces: ScenePiece[]): Draft[] {
  const byRole = (role: string) => pieces.find((piece) => piece.role === role);
  const table = byRole("table") ?? pieces.find((piece) => piece.form !== "rug" && piece.form !== "wall");
  if (table === undefined) return generic(pieces);
  // The table's long side runs along the window.
  const turn = table.size.z > table.size.x ? Math.PI / 2 : 0;
  const length = Math.max(table.size.x, table.size.z);
  const width = Math.min(table.size.x, table.size.z);
  const tableDraft = draft(table, 0, { x: 0, z: 0 }, { rotationY: turn, fixed: true });
  const drafts: Draft[] = [tableDraft];

  const chair = byRole("chairs");
  if (chair !== undefined) {
    const count = copiesOf(chair).length;
    // Tucked in: the seat's front edge 10 cm under the table top.
    const tuck = 0.1;
    const spots: { x: number; z: number; rotationY: number }[] = [];
    if (count >= 3) {
      spots.push({ x: -(length / 2 + chair.size.z / 2 - tuck), z: 0, rotationY: Math.PI / 2 });
      spots.push({ x: length / 2 + chair.size.z / 2 - tuck, z: 0, rotationY: -Math.PI / 2 });
    }
    const rest = count - spots.length;
    const back = Math.ceil(rest / 2);
    const front = rest - back;
    // The front stays open when it can, so the street sees the table laid.
    const backCount = count <= 4 ? rest : back;
    const frontCount = count <= 4 ? 0 : front;
    for (let index = 0; index < backCount; index += 1) {
      spots.push({ x: -length / 2 + (length * (index + 0.5)) / backCount, z: -(width / 2 + chair.size.z / 2 - tuck), rotationY: 0 });
    }
    for (let index = 0; index < frontCount; index += 1) {
      spots.push({ x: -length / 2 + (length * (index + 0.5)) / frontCount, z: width / 2 + chair.size.z / 2 - tuck, rotationY: Math.PI });
    }
    spots.slice(0, count).forEach((spot, copy) => {
      const seat = draft(chair, copy, { x: spot.x, z: spot.z }, { rotationY: spot.rotationY });
      seat.nests.add(tableDraft.key);
      tableDraft.nests.add(seat.key);
      drafts.push(seat);
    });
  }
  const pendant = byRole("pendant");
  if (pendant !== undefined) drafts.push(draft(pendant, 0, { x: 0, z: 0 }, { y: CEILING_M }));
  return [...drafts, ...leftovers(pieces, drafts)];
}

function bedroom(pieces: ScenePiece[]): Draft[] {
  const byRole = (role: string) => pieces.find((piece) => piece.role === role);
  const bed = byRole("bed") ?? pieces.find((piece) => piece.form !== "rug" && piece.form !== "wall");
  if (bed === undefined) return generic(pieces);
  const bedDraft = draft(bed, 0, { x: 0, z: 0 }, { fixed: true });
  const drafts: Draft[] = [bedDraft];
  const lamp = byRole("bedside-lamp");
  if (lamp !== undefined) {
    copiesOf(lamp)
      .slice(0, 2)
      .forEach((copy) => {
        const side = copy === 0 ? -1 : 1;
        const reach = isSmall(lamp) ? plinthSide(lamp) / 2 : turnedHalfExtents(lamp.size, 0).x;
        // A plinth at nightstand height stands in for the nightstand the set does not include.
        drafts.push(standing(lamp, copy, { x: side * (bed.size.x / 2 + 0.1 + reach), z: -bed.size.z / 2 + Math.max(0.3, reach) }, { plinthHeight: 0.6 }));
      });
  }
  const pillow = byRole("pillows");
  // A headboard alone (under a metre deep) has no mattress to rest on; a "headboard" whose scan is a whole bed does.
  if (pillow !== undefined && bed.size.z < 1) {
    // The pillows sit on a low plinth in front of it.
    const count = Math.min(2, copiesOf(pillow).length);
    for (let copy = 0; copy < count; copy += 1) {
      const side = plinthSide(pillow) / 2;
      const x = count === 1 ? 0 : (copy === 0 ? -1 : 1) * (side + 0.04);
      drafts.push(draft(pillow, copy, { x, z: bed.size.z / 2 + 0.3 + side }, { plinth: 0.45, rotationY: copy === 0 ? 0.12 : -0.12 }));
    }
  } else if (pillow !== undefined) {
    const count = Math.min(2, copiesOf(pillow).length);
    for (let copy = 0; copy < count; copy += 1) {
      const x = count === 1 ? 0 : (copy === 0 ? -1 : 1) * Math.min(bed.size.x / 4, bed.size.x / 2 - pillow.size.x / 2);
      // Leaning back against the headboard; the scene settles it onto the mattress.
      drafts.push(draft(pillow, copy, { x, z: -bed.size.z / 2 + 0.3 }, { y: Math.min(bed.size.y, 0.65) * 0.8, support: bedDraft.key, tiltX: -0.22 }));
    }
  }
  return [...drafts, ...leftovers(pieces, drafts)];
}

function giftSet(pieces: ScenePiece[]): Draft[] {
  const byRole = (role: string) => pieces.find((piece) => piece.role === role);
  const centre = byRole("centrepiece") ?? pieces.find((piece) => piece.form === "scan" || piece.form === "photo");
  if (centre === undefined) return generic(pieces);
  // Stepped plinths, tallest in the middle: the classic shop-window arrangement.
  const centreDraft = isSmall(centre) ? draft(centre, 0, { x: 0, z: 0 }, { plinth: 0.9, fixed: true }) : draft(centre, 0, { x: 0, z: 0 }, { fixed: true });
  const drafts: Draft[] = [centreDraft];
  const reach = centreDraft.collider?.halfX ?? 0.2;
  const soft = byRole("soft");
  if (soft !== undefined) {
    const side = plinthSide(soft) / 2;
    drafts.push(draft(soft, 0, { x: reach + 0.22 + side, z: 0.12 }, { plinth: 0.45, rotationY: -0.3 }));
  }
  // A still life hangs its picture beside the objects, centred at the height of the tallest one's top,
  // not at a room's 1.45 m — so the vignette reads as one group and the camera can come close.
  const wall = byRole("wall") ?? pieces.find((piece) => piece.form === "wall");
  if (wall !== undefined) {
    const tallest = Math.max(...drafts.map((entry) => entry.position.y + entry.size.y));
    drafts.push(draft(wall, 0, { x: -(reach + 0.3 + wall.size.x / 2), z: 0 }, { y: Math.max(0.5, tallest - wall.size.y / 2) }));
  }
  return [...drafts, ...leftovers(pieces, drafts)];
}

/** A window from a search, with no slots: the largest piece in the middle, the rest beside it, tallest outermost. */
function generic(pieces: ScenePiece[]): Draft[] {
  const standingPieces = pieces.filter((piece) => piece.form !== "rug" && piece.form !== "wall" && !piece.hangs);
  if (standingPieces.length === 0) return pieces.filter((piece) => piece.hangs).map((piece) => draft(piece, 0, { x: 0, z: 0 }, { y: CEILING_M }));
  const volume = (piece: ScenePiece) => piece.size.x * piece.size.y * piece.size.z;
  const anchor = [...standingPieces].sort((a, b) => volume(b) - volume(a) || a.id.localeCompare(b.id))[0]!;
  const drafts: Draft[] = [isSmall(anchor) ? draft(anchor, 0, { x: 0, z: 0 }, { plinth: plinthHeightFor(anchor), fixed: true }) : draft(anchor, 0, { x: 0, z: 0 }, { fixed: true })];
  const others = standingPieces.filter((piece) => piece !== anchor).sort((a, b) => a.size.y - b.size.y || a.id.localeCompare(b.id));
  let left = drafts[0]!.collider?.halfX ?? anchor.size.x / 2;
  let right = left;
  others.forEach((piece, index) => {
    const reach = isSmall(piece) ? plinthSide(piece) / 2 : piece.size.x / 2;
    if (index % 2 === 0) {
      drafts.push(standing(piece, 0, { x: -(left + 0.25 + reach), z: -0.1 }));
      left += 0.25 + 2 * reach;
    } else {
      drafts.push(standing(piece, 0, { x: right + 0.25 + reach, z: -0.1 }));
      right += 0.25 + 2 * reach;
    }
  });
  const hanging = pieces.filter((piece) => piece.hangs);
  hanging.forEach((piece) => drafts.push(draft(piece, 0, { x: 0, z: 0 }, { y: CEILING_M })));
  return drafts;
}

/** Rugs go under the group's front; pictures and mirrors on the back wall (its z is set once the wall is known). */
function rugsAndWalls(pieces: ScenePiece[], placed: Draft[]): Draft[] {
  const drafts: Draft[] = [];
  const box = footprintBox(placed);
  for (const piece of pieces) {
    if (placed.some((entry) => entry.id === piece.id)) continue;
    if (piece.form === "rug") {
      const centreX = box === null ? 0 : (box.minX + box.maxX) / 2;
      const front = box === null ? 0 : box.maxZ;
      // Its front edge a little beyond the group's front, so the rug reads as under it.
      drafts.push(draft(piece, 0, { x: centreX, z: front + 0.15 - piece.size.z / 2 }, { y: 0 }));
    } else if (piece.form === "wall") {
      drafts.push(draft(piece, 0, { x: box === null ? 0 : box.minX + piece.size.x / 2, z: 0 }, { y: WALL_CENTRE_M - piece.size.y / 2 }));
    }
  }
  return drafts;
}

/** Anything the grammar had no part for still goes in the window, beside the group. */
function leftovers(pieces: ScenePiece[], placed: Draft[]): Draft[] {
  const box = footprintBox(placed);
  let right = box === null ? 0 : box.maxX;
  const drafts: Draft[] = [];
  for (const piece of pieces) {
    if (placed.some((entry) => entry.id === piece.id) || piece.form === "rug" || piece.form === "wall") continue;
    if (piece.hangs) {
      drafts.push(draft(piece, 0, { x: 0, z: 0 }, { y: CEILING_M }));
      continue;
    }
    const reach = isSmall(piece) ? plinthSide(piece) / 2 : piece.size.x / 2;
    drafts.push(standing(piece, 0, { x: right + 0.25 + reach, z: 0 }));
    right += 0.25 + 2 * reach;
  }
  return drafts;
}

function footprintBox(drafts: readonly Draft[]): { minX: number; maxX: number; minZ: number; maxZ: number } | null {
  const solid = drafts.filter((entry) => entry.collider !== null);
  if (solid.length === 0) return null;
  return {
    minX: Math.min(...solid.map((entry) => entry.position.x - entry.collider!.halfX)),
    maxX: Math.max(...solid.map((entry) => entry.position.x + entry.collider!.halfX)),
    minZ: Math.min(...solid.map((entry) => entry.position.z - entry.collider!.halfZ)),
    maxZ: Math.max(...solid.map((entry) => entry.position.z + entry.collider!.halfZ)),
  };
}

/** The four corners of a footprint, turned. A plinth is square, so its turn does not matter. */
function corners(entry: Draft): { x: number; z: number }[] {
  const plinth = entry.plinthHeight !== null;
  const halfX = plinth ? entry.collider!.halfX : entry.size.x / 2;
  const halfZ = plinth ? entry.collider!.halfZ : entry.size.z / 2;
  const angle = plinth ? 0 : entry.rotationY;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [
    [-halfX, -halfZ],
    [halfX, -halfZ],
    [halfX, halfZ],
    [-halfX, halfZ],
  ].map(([dx, dz]) => ({ x: entry.position.x + c * dx! + s * dz!, z: entry.position.z - s * dx! + c * dz! }));
}

/**
 * The separating axis test for two footprints. Returns the minimum translation
 * that moves `b` clear of `a` (its direction points from a to b), or null when
 * they do not overlap.
 */
export function footprintOverlap(a: { x: number; z: number }[], b: { x: number; z: number }[]): { x: number; z: number; depth: number } | null {
  let best: { x: number; z: number; depth: number } | null = null;
  for (const polygon of [a, b]) {
    for (let index = 0; index < polygon.length; index += 1) {
      const p = polygon[index]!;
      const q = polygon[(index + 1) % polygon.length]!;
      const length = Math.hypot(q.x - p.x, q.z - p.z);
      if (length === 0) continue;
      // The edge's normal is a candidate separating axis.
      const axis = { x: -(q.z - p.z) / length, z: (q.x - p.x) / length };
      const project = (points: { x: number; z: number }[]) => points.map((point) => point.x * axis.x + point.z * axis.z);
      const pa = project(a);
      const pb = project(b);
      const depth = Math.min(Math.max(...pa), Math.max(...pb)) - Math.max(Math.min(...pa), Math.min(...pb));
      if (depth <= 0) return null;
      if (best === null || depth < best.depth) best = { ...axis, depth };
    }
  }
  if (best === null) return null;
  const centre = (points: { x: number; z: number }[]) => ({ x: points.reduce((sum, point) => sum + point.x, 0) / points.length, z: points.reduce((sum, point) => sum + point.z, 0) / points.length });
  const ca = centre(a);
  const cb = centre(b);
  // Point the push from a towards b.
  const sign = (cb.x - ca.x) * best.x + (cb.z - ca.z) * best.z < 0 ? -1 : 1;
  // `+ 0` turns a negative zero into zero.
  return { x: best.x * sign + 0, z: best.z * sign + 0, depth: best.depth };
}

/** Pushes footprints apart until none overlap; the anchor never moves, and a piece on another moves with it. */
function relax(drafts: Draft[]): void {
  const solid = drafts.filter((entry) => entry.collider !== null);
  for (let round = 0; round < 60; round += 1) {
    let moved = false;
    for (let i = 0; i < solid.length; i += 1) {
      for (let j = i + 1; j < solid.length; j += 1) {
        const a = solid[i]!;
        const b = solid[j]!;
        if (a.nests.has(b.key) || (a.fixed && b.fixed)) continue;
        const push = footprintOverlap(corners(a), corners(b));
        if (push === null) continue;
        // Move the one that is not fixed; between two free pieces, the later (smaller part in the set) moves.
        const mover = b.fixed ? a : b;
        const direction = mover === b ? 1 : -1;
        const step = push.depth + PUSH_GAP;
        shift(drafts, mover, { x: push.x * step * direction, z: push.z * step * direction });
        moved = true;
      }
    }
    if (!moved) return;
  }
}

function shift(drafts: Draft[], entry: Draft, by: { x: number; z: number }): void {
  entry.position = { ...entry.position, x: entry.position.x + by.x, z: entry.position.z + by.z };
  for (const rider of drafts) {
    if (rider.support === entry.key) rider.position = { ...rider.position, x: rider.position.x + by.x, z: rider.position.z + by.z };
  }
}

const round = (value: number) => Math.round(value * 1000) / 1000;

/**
 * Where every piece of a window goes. `template` is the Stylist's room; null
 * (a window from a search) uses the generic row.
 */
export function arrangeScene(template: TemplateId | null, input: readonly ScenePiece[]): SceneLayout {
  const pieces = ordered(input, template === null ? [] : ROLES[template]);
  const drafts: Draft[] =
    template === "reading-corner"
      ? readingCorner(pieces)
      : template === "living-room"
        ? livingRoom(pieces)
        : template === "dining"
          ? dining(pieces)
          : template === "bedroom"
            ? bedroom(pieces)
            : template === "gift-set"
              ? giftSet(pieces)
              : generic(pieces);
  relax(drafts);
  // Rugs and wall pieces follow the group where the push left it.
  drafts.push(...rugsAndWalls(pieces, drafts));

  // The room, built around the set: the back wall just behind the furthest-back footprint.
  const box = footprintBox(drafts) ?? { minX: -0.5, maxX: 0.5, minZ: -0.5, maxZ: 0.5 };
  const rugs = drafts.filter((entry) => entry.form === "rug");
  const minZ = Math.min(box.minZ, ...rugs.map((rug) => rug.position.z - rug.size.z / 2));
  const maxZ = Math.max(box.maxZ, ...rugs.map((rug) => rug.position.z + rug.size.z / 2));
  const minX = Math.min(box.minX, ...rugs.map((rug) => rug.position.x - rug.size.x / 2));
  const maxX = Math.max(box.maxX, ...rugs.map((rug) => rug.position.x + rug.size.x / 2));
  const room: Room = { minX: round(minX - SIDE_ROOM), maxX: round(maxX + SIDE_ROOM), backZ: round(minZ - WALL_GAP), frontZ: round(maxZ + FRONT_ROOM), height: CEILING_M };
  for (const entry of drafts) {
    if (entry.form === "wall") entry.position = { ...entry.position, z: room.backZ + entry.size.z / 2 + 0.005 };
  }

  const plinths: Plinth[] = drafts
    .filter((entry) => entry.plinthHeight !== null)
    .map((entry) => ({
      id: `plinth:${entry.key}`,
      position: { x: round(entry.position.x), y: 0, z: round(entry.position.z) },
      size: { x: round(entry.collider!.halfX * 2), y: entry.plinthHeight!, z: round(entry.collider!.halfZ * 2) },
    }));
  const placements: Placement[] = drafts.map((entry) => ({
    key: entry.key,
    id: entry.id,
    copy: entry.copy,
    position: { x: round(entry.position.x), y: round(entry.position.y), z: round(entry.position.z) },
    rotationY: round(entry.rotationY),
    tiltX: entry.tiltX,
    support: entry.support,
    size: entry.size,
    form: entry.form,
    hangs: entry.hangs,
  }));
  return { placements, plinths, room, bounds: sceneBounds(placements, plinths) };
}

/** The box around everything in the window, pendants and plinths included. */
export function sceneBounds(placements: readonly Placement[], plinths: readonly Plinth[] = []): Bounds {
  const min = { x: Infinity, y: Infinity, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };
  const take = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number) => {
    min.x = Math.min(min.x, x0);
    max.x = Math.max(max.x, x1);
    min.y = Math.min(min.y, y0);
    max.y = Math.max(max.y, y1);
    min.z = Math.min(min.z, z0);
    max.z = Math.max(max.z, z1);
  };
  for (const entry of placements) {
    const half = turnedHalfExtents(entry.size, entry.rotationY);
    const bottom = entry.hangs ? entry.position.y - entry.size.y : entry.position.y;
    take(entry.position.x - half.x, entry.position.x + half.x, bottom, bottom + entry.size.y, entry.position.z - half.z, entry.position.z + half.z);
  }
  for (const plinth of plinths) {
    take(plinth.position.x - plinth.size.x / 2, plinth.position.x + plinth.size.x / 2, 0, plinth.size.y, plinth.position.z - plinth.size.z / 2, plinth.position.z + plinth.size.z / 2);
  }
  if (!Number.isFinite(min.x)) return { min: { x: -0.5, y: 0, z: -0.5 }, max: { x: 0.5, y: 1, z: 0.5 } };
  return { min, max };
}

export type CameraShot = { position: Vec3; target: Vec3; fovDeg: number };

/** Where a point lands on screen for a camera at `eye` looking at `target`: normalised device coordinates, and its distance ahead. */
export function project(point: Vec3, eye: Vec3, target: Vec3, fovDeg: number, aspect: number): { x: number; y: number; ahead: number } {
  const forward = normalise({ x: target.x - eye.x, y: target.y - eye.y, z: target.z - eye.z });
  const right = normalise(cross(forward, { x: 0, y: 1, z: 0 }));
  const up = cross(right, forward);
  const offset = { x: point.x - eye.x, y: point.y - eye.y, z: point.z - eye.z };
  const ahead = dot(offset, forward);
  const tan = Math.tan((fovDeg * Math.PI) / 360);
  return { x: dot(offset, right) / (ahead * tan * aspect), y: dot(offset, up) / (ahead * tan), ahead };
}

/**
 * The shot that shows the whole box, no closer and no further than needed.
 *
 * The camera looks at the box's centre (a little low, where the eye rests on
 * furniture) from the street side, `elevationDeg` above the horizontal and
 * `azimuthDeg` to the side. The distance d is the smallest at which every
 * corner of the box projects inside the frame, less a margin:
 *
 *   |x_ndc| = |x_cam| / (z_cam · tan(fov/2) · aspect) ≤ 1 − margin, and the same for y
 *
 * Every corner's on-screen size shrinks as d grows, so the condition is
 * monotone in d and a bisection finds the smallest d to a millimetre.
 */
export function frameShot(bounds: Bounds, aspect: number, options: { fovDeg?: number; elevationDeg?: number; azimuthDeg?: number; margin?: number } = {}): CameraShot {
  const fovDeg = options.fovDeg ?? 35;
  const elevation = ((options.elevationDeg ?? 9) * Math.PI) / 180;
  const azimuth = ((options.azimuthDeg ?? 0) * Math.PI) / 180;
  const margin = options.margin ?? 0.1;
  const height = bounds.max.y - bounds.min.y;
  const target = {
    x: (bounds.min.x + bounds.max.x) / 2,
    y: bounds.min.y + height * 0.44,
    z: (bounds.min.z + bounds.max.z) / 2,
  };
  const direction = { x: Math.sin(azimuth) * Math.cos(elevation), y: Math.sin(elevation), z: Math.cos(azimuth) * Math.cos(elevation) };
  const box = [bounds.min.x, bounds.max.x].flatMap((x) => [bounds.min.y, bounds.max.y].flatMap((y) => [bounds.min.z, bounds.max.z].map((z) => ({ x, y, z }))));
  const eyeAt = (distance: number) => ({ x: target.x + direction.x * distance, y: target.y + direction.y * distance, z: target.z + direction.z * distance });
  const fits = (distance: number) =>
    box.every((corner) => {
      const p = project(corner, eyeAt(distance), target, fovDeg, aspect);
      return p.ahead > 0.1 && Math.abs(p.x) <= 1 - margin && Math.abs(p.y) <= 1 - margin;
    });
  let low = 0.1;
  let high = 1;
  while (!fits(high) && high < 200) high *= 2;
  for (let step = 0; step < 40 && high - low > 0.001; step += 1) {
    const mid = (low + high) / 2;
    if (fits(mid)) high = mid;
    else low = mid;
  }
  const eye = eyeAt(high);
  return { position: { x: round(eye.x), y: round(eye.y), z: round(eye.z) }, target: { x: round(target.x), y: round(target.y), z: round(target.z) }, fovDeg };
}

const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: Vec3, b: Vec3): Vec3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const normalise = (a: Vec3): Vec3 => {
  const length = Math.hypot(a.x, a.y, a.z) || 1;
  return { x: a.x / length, y: a.y / length, z: a.z / length };
};
