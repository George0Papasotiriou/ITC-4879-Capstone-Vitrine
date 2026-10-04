/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * The shapes furniture is made of: rounded boxes, cushions, turned profiles, tubes and extruded outlines.
 */

import { add, cross, dot, length, Mesh, normalize, scale, sub, type Vec2, type Vec3 } from "@/lib/catalog/model/mesh";

/**
 * docs/adr/058. Six primitives draw every piece in the catalogue:
 *
 *   roundedBox  a box whose edges are quarter-cylinders and corners
 *               eighth-spheres — a drawer front, a seat platform, a mattress;
 *   cushion     a rounded box that crowns, can be button-tufted with the
 *               pleats running between the buttons, or channel-quilted;
 *   lathe       a profile turned round the vertical axis — a turned leg, a
 *               lamp's base and shade, a planter, a pedestal;
 *   tube        a circle swept along a path — a hairpin leg, a bentwood frame,
 *               a stool's foot ring, an arc lamp, a cushion's piping;
 *   extrude     an outline in plan raised to a thickness, its edges rounded —
 *               a round or oval table top, a headboard, a shaped panel;
 *   bend        any of them wrapped round a vertical axis — a barrel chair's back.
 *
 * Texture coordinates are metres along the surface, so materials tile at
 * their real scale. `period` (a texture's repeat, metres) lets a closed shape
 * snap its circumference to a whole number of repeats: no seam in the grain.
 */

export type ProfilePoint = { r: number; y: number; sharp?: boolean };

const TAU = Math.PI * 2;

/** A circumference rounded to a whole number of texture repeats, so the seam lines up. */
function wrapLength(circumference: number, period: number | undefined): number {
  if (period === undefined || period <= 0) return circumference;
  return Math.max(1, Math.round(circumference / period)) * period;
}

// ─── Rounded box ────────────────────────────────────────────────────────────

/**
 * Where grid lines fall along one axis of a rounded box: through the rounded
 * edge at even angles, then evenly across the flat part. The rounded part is
 * sampled at tan(θ) so that, once each point is pushed out onto the rounding
 * (below), the angles around the edge come out even.
 */
function axisSamples(half: number, radius: number, segments: number, step: number): number[] {
  const inner = half - radius;
  const out: number[] = [];
  if (radius > 1e-9) for (let k = segments; k >= 1; k -= 1) out.push(-(inner + radius * Math.tan((Math.PI / 4) * (k / segments))));
  if (inner > 1e-9) {
    const divisions = Math.max(1, Math.ceil((2 * inner) / step));
    for (let j = 0; j <= divisions; j += 1) out.push(-inner + (2 * inner * j) / divisions);
  } else out.push(0);
  if (radius > 1e-9) for (let k = 1; k <= segments; k += 1) out.push(inner + radius * Math.tan((Math.PI / 4) * (k / segments)));
  return out;
}

/** Arc length from the centre of a face to a grid coordinate, round the edge: textures run on round the corner. */
function surfaceCoordinate(s: number, inner: number, radius: number): number {
  const a = Math.abs(s);
  if (a <= inner || radius <= 1e-9) return s;
  return Math.sign(s) * (inner + radius * Math.atan((a - inner) / radius));
}

/** The six faces: which axis is the normal, and texture directions u, v with u × v pointing out. */
const FACES: { axis: number; sign: 1 | -1; u: [number, 1 | -1]; v: [number, 1 | -1] }[] = [
  { axis: 0, sign: 1, u: [2, -1], v: [1, 1] },
  { axis: 0, sign: -1, u: [2, 1], v: [1, 1] },
  { axis: 1, sign: 1, u: [0, 1], v: [2, -1] },
  { axis: 1, sign: -1, u: [0, 1], v: [2, 1] },
  { axis: 2, sign: 1, u: [0, 1], v: [1, 1] },
  { axis: 2, sign: -1, u: [0, -1], v: [1, 1] },
];

export type Axis = 0 | 1 | 2;

export type RoundedBoxOptions = {
  size: Vec3;
  radius: number;
  /** Steps round each rounded edge. */
  segments?: number;
  /**
   * Largest gap between grid lines on the flat parts, metres: small enough for a cushion to crown or a button
   * to dimple. One number for every axis, or one per axis (x, y, z): a tufted face needs a fine grid across it,
   * not through the cushion's depth.
   */
  step?: number | Vec3;
  /** The axis a wood grain or a weave runs along, where a face contains it. */
  grain?: Axis;
};

/**
 * A box centred on the origin with every edge rounded to `radius`.
 *
 * Each face is a grid; every grid point p on the plain box is pulled to the
 * nearest point q of the box shrunk by the radius, and set at
 * q + radius · (p − q)/|p − q|. On a flat part p − q is the face normal; on an
 * edge it swings round a quarter-circle; at a corner it covers an eighth of a
 * sphere. That direction is also the exact normal there, so the rounding is
 * lit smoothly with no extra work.
 */
export function roundedBox({ size, radius, segments = 4, step = Infinity, grain }: RoundedBoxOptions): Mesh {
  const half: Vec3 = [size[0] / 2, size[1] / 2, size[2] / 2];
  const r = Math.max(0, Math.min(radius, half[0], half[1], half[2]));
  const inner: Vec3 = [half[0] - r, half[1] - r, half[2] - r];
  const steps: Vec3 = typeof step === "number" ? [step, step, step] : step;
  const samples = [0, 1, 2].map((axis) => axisSamples(half[axis]!, r, Math.max(1, segments), steps[axis]!));
  const mesh = new Mesh();

  for (const face of FACES) {
    const [ua, us] = face.u;
    const [va, vs] = face.v;
    const uList = samples[ua]!;
    const vList = samples[va]!;
    const swap = grain !== undefined && grain === va && grain !== face.axis;
    const first = mesh.vertexCount;
    for (let j = 0; j < vList.length; j += 1) {
      for (let i = 0; i < uList.length; i += 1) {
        const p: Vec3 = [0, 0, 0];
        p[face.axis] = face.sign * half[face.axis]!;
        p[ua] = us * uList[i]!;
        p[va] = vs * vList[j]!;
        const q: Vec3 = [0, 1, 2].map((axis) => Math.max(-inner[axis]!, Math.min(inner[axis]!, p[axis]!))) as Vec3;
        const out: Vec3 = [0, 0, 0];
        out[face.axis] = face.sign;
        const n = r > 1e-9 ? normalize(sub(p, q), out) : out;
        const position = r > 1e-9 ? add(q, scale(n, r)) : p;
        const u = surfaceCoordinate(uList[i]!, inner[ua]!, r);
        const v = surfaceCoordinate(vList[j]!, inner[va]!, r);
        mesh.vertex(position, n, swap ? [v, u] : [u, v]);
      }
    }
    const row = uList.length;
    for (let j = 0; j + 1 < vList.length; j += 1) {
      for (let i = 0; i + 1 < row; i += 1) {
        const a = first + j * row + i;
        mesh.quad(a, a + 1, a + row + 1, a + row);
      }
    }
  }
  return mesh;
}

// ─── Cushion ────────────────────────────────────────────────────────────────

export type Tufting =
  | { kind: "buttons"; spacing: number; depth: number; rows?: number }
  | { kind: "channels"; count: number; depth: number }
  | { kind: "none" };

export type CushionOptions = {
  size: Vec3;
  radius: number;
  /** How far the face swells in the middle, metres. */
  crown: number;
  /** The face that crowns and is tufted: the top of a seat (+y) or the front of a back (+z). */
  face?: "top" | "front";
  tufting?: Tufting;
  grain?: Axis;
};

export type Cushion = { mesh: Mesh; buttons: { position: Vec3; normal: Vec3 }[]; piping: Vec3[][] };

const gaussian = (distance: number, sigma: number) => Math.exp(-(distance * distance) / (2 * sigma * sigma));

/** Shortest distance from point p to the segment a–b, in the face's own 2D coordinates. */
function toSegment([px, py]: Vec2, [ax, ay]: Vec2, [bx, by]: Vec2): number {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/**
 * Buttons in a diamond pattern: rows offset by half a spacing, as a
 * Chesterfield or a tufted headboard is laid out, kept a margin inside the face.
 */
export function diamondGrid(width: number, height: number, spacing: number, rows?: number): Vec2[] {
  const margin = spacing * 0.55;
  const usableW = Math.max(0, width - 2 * margin);
  const usableH = Math.max(0, height - 2 * margin);
  const columns = Math.max(1, Math.round(usableW / spacing));
  const rowCount = rows ?? Math.max(1, Math.round(usableH / (spacing * 0.8)));
  const points: Vec2[] = [];
  for (let row = 0; row <= rowCount; row += 1) {
    const y = rowCount === 0 ? 0 : -usableH / 2 + (usableH * row) / rowCount;
    const odd = row % 2 === 1;
    const count = odd ? columns : columns + 1;
    for (let c = 0; c < count; c += 1) {
      const x = -usableW / 2 + (usableW * (odd ? c + 0.5 : c)) / columns;
      points.push([x, y]);
    }
  }
  return points;
}

/**
 * An upholstered cushion. The crowning face swells by
 * crown · (1 − (2u/w)²)(1 − (2v/h)²), most in the middle and nothing at the
 * seams. Buttons pull the face in with a Gaussian dimple each, and the fabric
 * between neighbouring buttons folds into the diamond's pleats (a shallower
 * Gaussian along each segment); channels are vertical Gaussian grooves. The
 * normals are worked out again afterwards, so every fold catches the light.
 */
export function cushion({ size, radius, crown, face = "top", tufting = { kind: "none" }, grain }: CushionOptions): Cushion {
  // A tufted face needs a fine grid for its dimples and pleats; a plain cushion only enough to crown smoothly.
  // The face's own coordinates: (u, v) across it, n out of it — the grid is fine across the face, coarse through it.
  const [nAxis, uAxis, vAxis] = face === "top" ? [1, 0, 2] : [2, 0, 1];
  const fine = Math.max(0.014, tufting.kind === "buttons" ? tufting.spacing / 5.5 : tufting.kind === "channels" ? 0.02 : 0.07);
  const steps: Vec3 = [fine, fine, fine];
  steps[nAxis] = 0.08;
  const mesh = roundedBox({ size, radius, segments: 4, step: steps, grain });
  const half: Vec3 = [size[0] / 2, size[1] / 2, size[2] / 2];
  const faceW = size[uAxis]!;
  const faceH = size[vAxis]!;

  const buttons = tufting.kind === "buttons" ? diamondGrid(faceW, faceH, tufting.spacing, tufting.rows) : [];
  // Neighbouring buttons, joined by the pleats of the diamond.
  const pleats: [Vec2, Vec2][] = [];
  if (tufting.kind === "buttons") {
    for (let a = 0; a < buttons.length; a += 1) {
      for (let b = a + 1; b < buttons.length; b += 1) {
        const d = Math.hypot(buttons[a]![0] - buttons[b]![0], buttons[a]![1] - buttons[b]![1]);
        if (d < tufting.spacing * 1.05 && Math.abs(buttons[a]![1] - buttons[b]![1]) > 1e-6) pleats.push([buttons[a]!, buttons[b]!]);
      }
    }
  }
  const channels =
    tufting.kind === "channels" ? Array.from({ length: tufting.count - 1 }, (_, k) => -faceW / 2 + (faceW * (k + 1)) / tufting.count) : [];

  /** How far the face is pushed out (+) or pulled in (−) at (u, v). */
  const relief = (u: number, v: number): number => {
    const fu = Math.max(0, 1 - (2 * u / faceW) ** 2);
    const fv = Math.max(0, 1 - (2 * v / faceH) ** 2);
    let offset = crown * fu * fv;
    if (tufting.kind === "buttons") {
      const sigma = tufting.spacing * 0.16;
      let pull = 0;
      for (const [bu, bv] of buttons) pull = Math.max(pull, gaussian(Math.hypot(u - bu, v - bv), sigma));
      let fold = 0;
      for (const [a, b] of pleats) fold = Math.max(fold, gaussian(toSegment([u, v], a, b), sigma * 0.45));
      offset -= tufting.depth * Math.max(pull, fold * 0.45) * (0.4 + 0.6 * fu * fv);
    } else if (tufting.kind === "channels") {
      const sigma = faceW / tufting.count / 9;
      let groove = 0;
      for (const c of channels) groove = Math.max(groove, gaussian(u - c, sigma));
      offset -= tufting.depth * groove * Math.min(1, 4 * fv);
    }
    return offset;
  };

  for (let v = 0; v < mesh.vertexCount; v += 1) {
    const p = mesh.position(v);
    // Only the crowning half moves, fading in from the middle of the cushion to the face.
    const t = p[nAxis]! / half[nAxis]!;
    if (t <= 0) continue;
    const weight = Math.min(1, t) ** 3;
    p[nAxis] = p[nAxis]! + relief(p[uAxis]!, p[vAxis]!) * weight;
    mesh.setPosition(v, p);
  }
  mesh.recomputeNormals();

  const out: Vec3 = [0, 0, 0];
  out[nAxis] = 1;
  const placed = buttons.map(([u, v]) => {
    const position: Vec3 = [0, 0, 0];
    position[uAxis] = u;
    position[vAxis] = v;
    position[nAxis] = half[nAxis]! + relief(u, v);
    return { position, normal: out };
  });

  // The welt round the crowning face, where its seam meets the sides: a rounded rectangle at 45° on the edge.
  const r = Math.min(radius, half[0], half[1], half[2]);
  const inset = r * (1 - Math.SQRT1_2);
  const ring = roundedRectanglePath(faceW - 2 * inset, faceH - 2 * inset, Math.max(0.002, r * 0.7), 5).map(([u, v]) => {
    const p: Vec3 = [0, 0, 0];
    p[uAxis] = u;
    p[vAxis] = v;
    p[nAxis] = half[nAxis]! - inset;
    return p;
  });
  return { mesh, buttons: placed, piping: [ring] };
}

// ─── Lathe ──────────────────────────────────────────────────────────────────

/**
 * A profile turned a full circle round the y axis. The profile runs from
 * bottom to top as (radius, height); a point marked `sharp` keeps a crisp
 * edge (it is emitted twice, with the normals of the segment before and after).
 */
export function lathe(profile: readonly ProfilePoint[], { segments = 40, period, capBottom = true, capTop = true }: { segments?: number; period?: number; capBottom?: boolean; capTop?: boolean } = {}): Mesh {
  const mesh = new Mesh();
  const maxR = Math.max(...profile.map((point) => point.r), 1e-6);
  const around = wrapLength(TAU * maxR, period);

  // Rings: one per profile point, two at a sharp one.
  type Ring = { r: number; y: number; nr: number; ny: number; v: number };
  const rings: Ring[] = [];
  let travelled = 0;
  const outward = (dr: number, dy: number): [number, number] => {
    const l = Math.hypot(dr, dy) || 1;
    return [dy / l, -dr / l];
  };
  for (let i = 0; i < profile.length; i += 1) {
    const point = profile[i]!;
    if (i > 0) travelled += Math.hypot(point.r - profile[i - 1]!.r, point.y - profile[i - 1]!.y);
    const before = profile[Math.max(0, i - 1)]!;
    const after = profile[Math.min(profile.length - 1, i + 1)]!;
    if (point.sharp === true && i > 0 && i < profile.length - 1) {
      const [n1r, n1y] = outward(point.r - before.r, point.y - before.y);
      const [n2r, n2y] = outward(after.r - point.r, after.y - point.y);
      rings.push({ r: point.r, y: point.y, nr: n1r, ny: n1y, v: travelled });
      rings.push({ r: point.r, y: point.y, nr: n2r, ny: n2y, v: travelled });
    } else {
      const [nr, ny] = outward(after.r - before.r, after.y - before.y);
      rings.push({ r: point.r, y: point.y, nr, ny, v: travelled });
    }
  }

  const ringStart: number[] = [];
  for (const ring of rings) {
    ringStart.push(mesh.vertexCount);
    for (let j = 0; j <= segments; j += 1) {
      const theta = (TAU * j) / segments;
      const c = Math.cos(theta);
      const s = Math.sin(theta);
      // u runs along the profile and v round it, so a wood grain follows a turned leg's length.
      mesh.vertex([ring.r * c, ring.y, -ring.r * s], [ring.nr * c, ring.ny, -ring.nr * s], [ring.v, (around * j) / segments]);
    }
  }
  for (let k = 0; k + 1 < rings.length; k += 1) {
    // Two rings at the same point (a sharp edge) are not joined: there is nothing between them.
    if (rings[k]!.r === rings[k + 1]!.r && rings[k]!.y === rings[k + 1]!.y) continue;
    for (let j = 0; j < segments; j += 1) {
      const a = ringStart[k]! + j;
      const d = ringStart[k + 1]! + j;
      // A ring of radius 0 is a single point (a pole): one triangle, not a quad with a side of no length.
      if (rings[k]!.r <= 1e-9) mesh.triangle(a, d + 1, d);
      else if (rings[k + 1]!.r <= 1e-9) mesh.triangle(a, a + 1, d);
      else mesh.quad(a, a + 1, d + 1, d);
    }
  }

  const disc = (ring: Ring, up: boolean) => {
    if (ring.r <= 1e-6) return;
    const centre = mesh.vertex([0, ring.y, 0], [0, up ? 1 : -1, 0], [0, 0]);
    const first = mesh.vertexCount;
    for (let j = 0; j <= segments; j += 1) {
      const theta = (TAU * j) / segments;
      mesh.vertex([ring.r * Math.cos(theta), ring.y, -ring.r * Math.sin(theta)], [0, up ? 1 : -1, 0], [ring.r * Math.cos(theta), ring.r * Math.sin(theta)]);
    }
    for (let j = 0; j < segments; j += 1) {
      if (up) mesh.triangle(centre, first + j, first + j + 1);
      else mesh.triangle(centre, first + j + 1, first + j);
    }
  };
  if (capBottom) disc(rings[0]!, false);
  if (capTop) disc(rings[rings.length - 1]!, true);
  return mesh;
}

/** A cylinder with softened rims, standing on y = 0. */
export function cylinder(radius: number, height: number, { bevel = Math.min(radius, height) * 0.15, segments = 40, period }: { bevel?: number; segments?: number; period?: number } = {}): Mesh {
  return lathe(roundedProfile(radius, radius, height, bevel), { segments, period });
}

/** A profile from radius `bottom` to radius `top` over `height`, its two rims rounded by `bevel`. */
export function roundedProfile(bottom: number, top: number, height: number, bevel: number): ProfilePoint[] {
  const b = Math.max(0, Math.min(bevel, bottom, top, height / 2));
  const points: ProfilePoint[] = [{ r: 0, y: 0 }];
  if (b <= 1e-6) return [{ r: 0, y: 0 }, { r: bottom, y: 0, sharp: true }, { r: top, y: height, sharp: true }, { r: 0, y: height }];
  for (let k = 0; k <= 4; k += 1) {
    const a = (Math.PI / 2) * (k / 4);
    points.push({ r: bottom - b + b * Math.sin(a), y: b - b * Math.cos(a) });
  }
  for (let k = 0; k <= 4; k += 1) {
    const a = (Math.PI / 2) * (k / 4);
    points.push({ r: top - b + b * Math.cos(a), y: height - b + b * Math.sin(a) });
  }
  points.push({ r: 0, y: height });
  return points;
}

/** A sphere of the given radius, centred on the origin. */
export function sphere(radius: number, { segments = 24, rings = 14 }: { segments?: number; rings?: number } = {}): Mesh {
  const profile: ProfilePoint[] = [];
  for (let k = 0; k <= rings; k += 1) {
    const a = -Math.PI / 2 + (Math.PI * k) / rings;
    profile.push({ r: Math.max(0, radius * Math.cos(a)), y: radius * Math.sin(a) });
  }
  return lathe(profile, { segments, capBottom: false, capTop: false });
}

// ─── Tube ───────────────────────────────────────────────────────────────────

/** v turned by `angle` round the unit `axis` (Rodrigues' formula). */
function rotateAbout(v: Vec3, axis: Vec3, angle: number): Vec3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return add(add(scale(v, c), scale(cross(axis, v), s)), scale(axis, dot(axis, v) * (1 - c)));
}

/**
 * A circle swept along a path. The circle's frame is carried along by
 * parallel transport — each step turns the previous frame by the smallest
 * rotation that takes the old direction to the new one — so the tube never
 * twists the way a frame built from fixed "up" would at a vertical stretch.
 * A closed path spreads any twist left over at the end evenly round the loop.
 */
export function tube(
  path: readonly Vec3[],
  radius: number | ((t: number) => number),
  { segments = 12, closed = false, caps = true, period }: { segments?: number; closed?: boolean; caps?: boolean; period?: number } = {},
): Mesh {
  const mesh = new Mesh();
  const count = path.length;
  if (count < 2) return mesh;
  const radiusAt = typeof radius === "number" ? () => radius : radius;
  const tangents: Vec3[] = path.map((point, i) => {
    const prev = closed ? path[(i - 1 + count) % count]! : path[Math.max(0, i - 1)]!;
    const next = closed ? path[(i + 1) % count]! : path[Math.min(count - 1, i + 1)]!;
    return normalize(sub(next, prev), [0, 1, 0]);
  });
  const normals: Vec3[] = [];
  const t0 = tangents[0]!;
  normals.push(normalize(cross(t0, Math.abs(t0[1]) < 0.95 ? [0, 1, 0] : [1, 0, 0])));
  for (let i = 1; i < count; i += 1) {
    const axis = cross(tangents[i - 1]!, tangents[i]!);
    const l = length(axis);
    const previous = normals[i - 1]!;
    normals.push(l < 1e-9 ? previous : normalize(rotateAbout(previous, scale(axis, 1 / l), Math.acos(Math.max(-1, Math.min(1, dot(tangents[i - 1]!, tangents[i]!)))))));
  }
  if (closed) {
    // The frame carried all the way round, against the one it started with: share out the difference.
    const last = normals[count - 1]!;
    const axis = cross(tangents[count - 1]!, t0);
    const carried = length(axis) < 1e-9 ? last : rotateAbout(last, normalize(axis), Math.acos(Math.max(-1, Math.min(1, dot(tangents[count - 1]!, t0)))));
    const twist = Math.atan2(dot(cross(carried, normals[0]!), t0), dot(carried, normals[0]!));
    for (let i = 0; i < count; i += 1) normals[i] = rotateAbout(normals[i]!, tangents[i]!, (twist * i) / count);
  }

  const lengths = [0];
  for (let i = 1; i < count; i += 1) lengths.push(lengths[i - 1]! + length(sub(path[i]!, path[i - 1]!)));
  const total = lengths[count - 1]! + (closed ? length(sub(path[0]!, path[count - 1]!)) : 0);
  const typical = radiusAt(0.5);
  const around = wrapLength(TAU * typical, period);

  const ringStart: number[] = [];
  const rows = closed ? count + 1 : count;
  for (let row = 0; row < rows; row += 1) {
    const i = row % count;
    const t = total === 0 ? 0 : (row === count ? total : lengths[i]!) / total;
    const r = radiusAt(t);
    const n = normals[i]!;
    const b = cross(tangents[i]!, n);
    ringStart.push(mesh.vertexCount);
    for (let j = 0; j <= segments; j += 1) {
      const phi = (TAU * j) / segments;
      const dir = add(scale(n, Math.cos(phi)), scale(b, Math.sin(phi)));
      // u along the tube, v round it: grain and brushing run the length of a rod.
      mesh.vertex(add(path[i]!, scale(dir, r)), dir, [row === count ? total : lengths[i]!, (around * j) / segments]);
    }
  }
  for (let row = 0; row + 1 < rows; row += 1) {
    for (let j = 0; j < segments; j += 1) {
      const a = ringStart[row]! + j;
      const d = ringStart[row + 1]! + j;
      mesh.quad(a, a + 1, d + 1, d);
    }
  }
  if (!closed && caps) {
    for (const [end, sign] of [
      [0, -1],
      [count - 1, 1],
    ] as const) {
      const r = radiusAt(end === 0 ? 0 : 1);
      const n = normals[end]!;
      const b = cross(tangents[end]!, n);
      const out = scale(tangents[end]!, sign);
      const centre = mesh.vertex(path[end]!, out, [0, 0]);
      const first = mesh.vertexCount;
      for (let j = 0; j <= segments; j += 1) {
        const phi = (TAU * j) / segments;
        mesh.vertex(add(path[end]!, scale(add(scale(n, Math.cos(phi)), scale(b, Math.sin(phi))), r)), out, [r * Math.cos(phi), r * Math.sin(phi)]);
      }
      for (let j = 0; j < segments; j += 1) {
        if (sign > 0) mesh.triangle(centre, first + j, first + j + 1);
        else mesh.triangle(centre, first + j + 1, first + j);
      }
    }
  }
  return mesh;
}

// ─── Paths ──────────────────────────────────────────────────────────────────

/** A polyline with each inner corner rounded by a fillet of `radius` (a quadratic curve through the corner). */
export function roundedPolyline(points: readonly Vec3[], radius: number, steps = 6): Vec3[] {
  if (points.length < 3 || radius <= 0) return [...points];
  const out: Vec3[] = [points[0]!];
  for (let i = 1; i + 1 < points.length; i += 1) {
    const p = points[i]!;
    const toPrev = sub(points[i - 1]!, p);
    const toNext = sub(points[i + 1]!, p);
    const d = Math.min(radius, length(toPrev) / 2, length(toNext) / 2);
    const a = add(p, scale(normalize(toPrev), d));
    const b = add(p, scale(normalize(toNext), d));
    for (let k = 0; k <= steps; k += 1) {
      const t = k / steps;
      // Quadratic Bézier a → p → b.
      out.push(add(add(scale(a, (1 - t) * (1 - t)), scale(p, 2 * (1 - t) * t)), scale(b, t * t)));
    }
  }
  out.push(points[points.length - 1]!);
  return out;
}

/** A circular arc in a plane through `centre`, from angle `from` to `to` (radians). */
export function arcPath(centre: Vec3, radius: number, from: number, to: number, plane: "xy" | "xz" | "zy", steps = 16): Vec3[] {
  const out: Vec3[] = [];
  for (let k = 0; k <= steps; k += 1) {
    const a = from + ((to - from) * k) / steps;
    const c = radius * Math.cos(a);
    const s = radius * Math.sin(a);
    out.push(plane === "xy" ? [centre[0] + c, centre[1] + s, centre[2]] : plane === "xz" ? [centre[0] + c, centre[1], centre[2] + s] : [centre[0], centre[1] + s, centre[2] + c]);
  }
  return out;
}

/** A closed rounded rectangle in the (u, v) plane, anticlockwise, as 2D points. */
export function roundedRectanglePath(width: number, depth: number, radius: number, steps = 6): Vec2[] {
  const r = Math.max(0, Math.min(radius, width / 2, depth / 2));
  const hw = width / 2 - r;
  const hd = depth / 2 - r;
  const corners: [number, number, number][] = [
    [hw, hd, 0],
    [-hw, hd, Math.PI / 2],
    [-hw, -hd, Math.PI],
    [hw, -hd, (3 * Math.PI) / 2],
  ];
  const out: Vec2[] = [];
  for (const [cx, cy, start] of corners) {
    for (let k = 0; k <= steps; k += 1) {
      const a = start + (Math.PI / 2) * (k / steps);
      out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
  }
  return dedupe(out);
}

/** A superellipse |x/a|^n + |y/b|^n = 1: n = 2 is an ellipse, larger n squarer — the soft-square of modern tables and ottomans. */
export function superellipsePath(width: number, depth: number, exponent: number, steps = 64): Vec2[] {
  const out: Vec2[] = [];
  for (let k = 0; k < steps; k += 1) {
    const t = (TAU * k) / steps;
    const c = Math.cos(t);
    const s = Math.sin(t);
    out.push([(width / 2) * Math.sign(c) * Math.abs(c) ** (2 / exponent), (depth / 2) * Math.sign(s) * Math.abs(s) ** (2 / exponent)]);
  }
  return out;
}

function dedupe(points: Vec2[]): Vec2[] {
  return points.filter((p, i) => {
    const q = points[(i + 1) % points.length]!;
    return Math.hypot(p[0] - q[0], p[1] - q[1]) > 1e-7;
  });
}

// ─── Extrusion ──────────────────────────────────────────────────────────────

const signedArea = (outline: readonly Vec2[]) => outline.reduce((sum, [x, y], i) => sum + x * outline[(i + 1) % outline.length]![1] - outline[(i + 1) % outline.length]![0] * y, 0) / 2;

/**
 * An outline (anticlockwise) cut into triangles. Points in a straight line
 * with their neighbours are skipped first — a rounded corner's tiny arcs and
 * a long straight edge make such points, and they cannot be ear tips. A
 * convex outline (a table top) is then a fan from its first point; any other
 * (an L-shaped desk) is cut by ear clipping: repeatedly take a convex corner
 * whose triangle holds no reflex corner inside or on its edges — a notch's
 * corner lying exactly on the cut would leave a sliver outside the outline.
 */
export function triangulate(outline: readonly Vec2[]): [number, number, number][] {
  const cross2 = (a: Vec2, b: Vec2, c: Vec2) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  let indices = outline.map((_, i) => i);
  // Drop points in line with their neighbours (repeat: removing one can line up the next).
  for (let changed = true; changed && indices.length > 3; ) {
    changed = false;
    for (let k = 0; k < indices.length && indices.length > 3; k += 1) {
      const a = outline[indices[(k - 1 + indices.length) % indices.length]!]!;
      const b = outline[indices[k]!]!;
      const c = outline[indices[(k + 1) % indices.length]!]!;
      const scale = Math.hypot(c[0] - a[0], c[1] - a[1]) ** 2 || 1;
      if (Math.abs(cross2(a, b, c)) <= 1e-9 * scale) {
        indices.splice(k, 1);
        changed = true;
        k -= 1;
      }
    }
  }
  const out: [number, number, number][] = [];
  const convex = indices.every((_, k) => cross2(outline[indices[(k - 1 + indices.length) % indices.length]!]!, outline[indices[k]!]!, outline[indices[(k + 1) % indices.length]!]!) > 0);
  if (convex) {
    for (let k = 1; k + 1 < indices.length; k += 1) out.push([indices[0]!, indices[k]!, indices[k + 1]!]);
    return out;
  }
  const insideOrOn = (p: Vec2, a: Vec2, b: Vec2, c: Vec2) => cross2(a, b, p) >= -1e-12 && cross2(b, c, p) >= -1e-12 && cross2(c, a, p) >= -1e-12;
  const reflex = (k: number) => cross2(outline[indices[(k - 1 + indices.length) % indices.length]!]!, outline[indices[k]!]!, outline[indices[(k + 1) % indices.length]!]!) <= 0;
  let guard = 0;
  while (indices.length > 3 && guard < 100_000) {
    guard += 1;
    let clipped = false;
    for (let k = 0; k < indices.length; k += 1) {
      const ia = indices[(k - 1 + indices.length) % indices.length]!;
      const ib = indices[k]!;
      const ic = indices[(k + 1) % indices.length]!;
      const [a, b, c] = [outline[ia]!, outline[ib]!, outline[ic]!];
      if (cross2(a, b, c) <= 0) continue;
      if (indices.some((other, position) => other !== ia && other !== ib && other !== ic && reflex(position) && insideOrOn(outline[other]!, a, b, c))) continue;
      out.push([ia, ib, ic]);
      indices = indices.filter((_, position) => position !== k);
      clipped = true;
      break;
    }
    if (!clipped) break;
  }
  if (indices.length === 3) out.push([indices[0]!, indices[1]!, indices[2]!]);
  return out;
}

/**
 * An outline in plan (x, z) raised from y = 0 to y = `height`, its top and
 * bottom edges rounded by `bevel` (a quarter-circle each). Each side edge
 * keeps the outline's own normal at a sharp corner and blends it where the
 * outline curves, so a round top is smooth and an L-shaped desk keeps its
 * corners.
 */
export function extrude(outline2d: readonly Vec2[], { height, bevel = 0, bevelSegments = 3, bottom = true }: { height: number; bevel?: number; bevelSegments?: number; bottom?: boolean }): Mesh {
  const outline = signedArea(outline2d) < 0 ? [...outline2d].reverse() : [...outline2d];
  const n = outline.length;
  const mesh = new Mesh();
  const b = Math.max(0, Math.min(bevel, height / 2));

  // Outward normals of each edge, in the plane: for an anticlockwise outline, (dy, −dx).
  const edgeNormal = outline.map((p, i) => {
    const q = outline[(i + 1) % n]!;
    const l = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1;
    return [(q[1] - p[1]) / l, -(q[0] - p[0]) / l] as Vec2;
  });
  // At each corner: the blended normal, the mitre to inset along, and whether the corner is sharp.
  const corner = outline.map((_, i) => {
    const before = edgeNormal[(i - 1 + n) % n]!;
    const after = edgeNormal[i]!;
    const sum: Vec2 = [before[0] + after[0], before[1] + after[1]];
    const l = Math.hypot(sum[0], sum[1]) || 1;
    const blended: Vec2 = [sum[0] / l, sum[1] / l];
    const cosHalf = Math.max(0.2, blended[0] * after[0] + blended[1] * after[1]);
    const sharp = before[0] * after[0] + before[1] * after[1] < Math.cos((35 * Math.PI) / 180);
    return { blended, mitre: [blended[0] / cosHalf, blended[1] / cosHalf] as Vec2, sharp };
  });

  // The rows up the side: (inset, y, how much of the normal points up).
  const rows: { inset: number; y: number; out: number; up: number }[] = [];
  if (b > 1e-6) {
    for (let k = 0; k <= bevelSegments; k += 1) {
      const a = (Math.PI / 2) * (1 - k / bevelSegments);
      rows.push({ inset: b * (1 - Math.cos(a)), y: b - b * Math.sin(a), out: Math.cos(a), up: -Math.sin(a) });
    }
    for (let k = 0; k <= bevelSegments; k += 1) {
      const a = (Math.PI / 2) * (k / bevelSegments);
      rows.push({ inset: b * (1 - Math.cos(a)), y: height - b + b * Math.sin(a), out: Math.cos(a), up: Math.sin(a) });
    }
  } else {
    rows.push({ inset: 0, y: 0, out: 1, up: 0 }, { inset: 0, y: height, out: 1, up: 0 });
  }

  const inset = (i: number, amount: number): Vec2 => [outline[i]![0] - corner[i]!.mitre[0] * amount, outline[i]![1] - corner[i]!.mitre[1] * amount];
  let along = 0;
  for (let i = 0; i < n; i += 1) {
    const j = (i + 1) % n;
    const edgeLength = Math.hypot(outline[j]![0] - outline[i]![0], outline[j]![1] - outline[i]![1]);
    const first = mesh.vertexCount;
    for (const row of rows) {
      for (const [k, u] of [
        [i, along],
        [j, along + edgeLength],
      ] as const) {
        const planar = corner[k]!.sharp ? edgeNormal[i]! : corner[k]!.blended;
        const p = inset(k, row.inset);
        mesh.vertex([p[0], row.y, p[1]], normalize([planar[0] * row.out, row.up, planar[1] * row.out]), [u, row.y]);
      }
    }
    for (let r = 0; r + 1 < rows.length; r += 1) {
      const a = first + r * 2;
      orientedQuad(mesh, a, a + 1, a + 3, a + 2, [edgeNormal[i]![0], 0, edgeNormal[i]![1]]);
    }
    along += edgeLength;
  }

  // Caps: the innermost rows, flat. They are cut into triangles as the outline itself is: an inset ring can
  // fold by a hair where a corner's radius is no larger than the bevel, and the outline cannot.
  const pattern = triangulate(outline);
  const cap = (row: { inset: number; y: number }, up: boolean) => {
    const ring = outline.map((_, i) => inset(i, row.inset));
    const first = mesh.vertexCount;
    for (const p of ring) mesh.vertex([p[0], row.y, p[1]], [0, up ? 1 : -1, 0], [p[0], p[1]]);
    for (const [a, bb, c] of pattern) orientedTriangle(mesh, first + a, first + bb, first + c, [0, up ? 1 : -1, 0]);
  };
  cap(rows[rows.length - 1]!, true);
  if (bottom) cap(rows[0]!, false);
  return mesh;
}

/** A quad wound so that it faces `expected`, whatever order its corners came in. */
function orientedQuad(mesh: Mesh, a: number, b: number, c: number, d: number, expected: Vec3): void {
  const normal = cross(sub(mesh.position(b), mesh.position(a)), sub(mesh.position(c), mesh.position(a)));
  if (dot(normal, expected) >= 0) mesh.quad(a, b, c, d);
  else mesh.quad(a, d, c, b);
}

function orientedTriangle(mesh: Mesh, a: number, b: number, c: number, expected: Vec3): void {
  const normal = cross(sub(mesh.position(b), mesh.position(a)), sub(mesh.position(c), mesh.position(a)));
  if (dot(normal, expected) >= 0) mesh.triangle(a, b, c);
  else mesh.triangle(a, c, b);
}

// ─── Deformations ───────────────────────────────────────────────────────────

/**
 * Wraps a shape round a vertical axis in front of it, at distance `radius`
 * from its back face plane z = 0: x becomes an angle x / radius. A straight
 * padded slab becomes a barrel chair's curved back. Normals are recomputed.
 */
export function bend(mesh: Mesh, radius: number): Mesh {
  for (let v = 0; v < mesh.vertexCount; v += 1) {
    const [x, y, z] = mesh.position(v);
    const a = x / radius;
    const distance = radius - z;
    mesh.setPosition(v, [distance * Math.sin(a), y, radius - distance * Math.cos(a)]);
  }
  return mesh.recomputeNormals();
}

/** Every vertex pushed along its normal by `offset(position, normal)`, then the normals worked out again. */
export function displace(mesh: Mesh, offset: (position: Vec3, normal: Vec3) => number): Mesh {
  for (let v = 0; v < mesh.vertexCount; v += 1) mesh.setPosition(v, add(mesh.position(v), scale(mesh.normal(v), offset(mesh.position(v), mesh.normal(v)))));
  return mesh.recomputeNormals();
}

// ─── Sweep ──────────────────────────────────────────────────────────────────

/**
 * A wall's cross-section run round a closed outline in plan — the lathe's
 * idea along any path rather than a circle. Each profile point is
 * (offset outwards from the outline, height); the outline's outward normal at
 * each point carries it. A basket's woven wall, rolled rim and inside face,
 * round a rounded rectangle, is one sweep.
 */
export function sweep(outline2d: readonly Vec2[], profile: readonly ProfilePoint[], { period }: { period?: number } = {}): Mesh {
  const outline = signedArea(outline2d) < 0 ? [...outline2d].reverse() : [...outline2d];
  const n = outline.length;
  const mesh = new Mesh();
  const normals = outline.map((p, i) => {
    const prev = outline[(i - 1 + n) % n]!;
    const next = outline[(i + 1) % n]!;
    const tx = next[0] - prev[0];
    const ty = next[1] - prev[1];
    const l = Math.hypot(tx, ty) || 1;
    return [ty / l, -tx / l] as Vec2;
  });
  const lengths = [0];
  for (let i = 1; i <= n; i += 1) lengths.push(lengths[i - 1]! + Math.hypot(outline[i % n]![0] - outline[i - 1]![0], outline[i % n]![1] - outline[i - 1]![1]));
  const total = lengths[n]!;
  const around = wrapLength(total, period);
  // Profile normals, as in lathe: perpendicular to the profile's own direction.
  const profileNormals = profile.map((point, i) => {
    const before = profile[Math.max(0, i - 1)]!;
    const after = profile[Math.min(profile.length - 1, i + 1)]!;
    const dr = after.r - before.r;
    const dy = after.y - before.y;
    const l = Math.hypot(dr, dy) || 1;
    return [dy / l, -dr / l] as Vec2;
  });
  let travelled = 0;
  const vs: number[] = [];
  for (let k = 0; k < profile.length; k += 1) {
    if (k > 0) travelled += Math.hypot(profile[k]!.r - profile[k - 1]!.r, profile[k]!.y - profile[k - 1]!.y);
    vs.push(travelled);
  }
  const rowStart: number[] = [];
  for (let k = 0; k < profile.length; k += 1) {
    rowStart.push(mesh.vertexCount);
    const { r, y } = profile[k]!;
    const [nr, ny] = profileNormals[k]!;
    for (let i = 0; i <= n; i += 1) {
      const p = outline[i % n]!;
      const m = normals[i % n]!;
      mesh.vertex([p[0] + m[0] * r, y, p[1] + m[1] * r], normalize([m[0] * nr, ny, m[1] * nr]), [(lengths[i]! / total) * around, vs[k]!]);
    }
  }
  for (let k = 0; k + 1 < profile.length; k += 1) {
    for (let i = 0; i < n; i += 1) {
      const a = rowStart[k]! + i;
      const d = rowStart[k + 1]! + i;
      orientedQuad(mesh, a, a + 1, d + 1, d, scale(add(mesh.normal(a), mesh.normal(d + 1)), 0.5));
    }
  }
  return mesh;
}
