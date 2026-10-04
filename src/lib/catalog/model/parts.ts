/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * The parts furniture shares: legs of every style, castors, drawer fronts, handles, buttons and nailheads.
 */

import { arcPath, cylinder, lathe, roundedBox, roundedPolyline, sphere, tube, type ProfilePoint } from "@/lib/catalog/model/geometry";
import type { MaterialSpec } from "@/lib/catalog/model/materials";
import { compose, cross, Mesh, normalize, rotationY, translation, type Mat4, type Vec3 } from "@/lib/catalog/model/mesh";
import type { ModelPart } from "@/lib/catalog/model/write";

/** Collects the parts of a piece as it is built. */
export class Build {
  readonly parts: ModelPart[] = [];

  add(mesh: Mesh, material: MaterialSpec, transform?: Mat4): Mesh {
    if (transform !== undefined) mesh.transform(transform);
    this.parts.push({ mesh, material });
    return mesh;
  }
}

/** A rotation by `angle` round any unit axis through the origin (Rodrigues' formula as a matrix). */
export function rotationAxis(axis: Vec3, angle: number): Mat4 {
  const [x, y, z] = normalize(axis);
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const t = 1 - c;
  return [t * x * x + c, t * x * y + s * z, t * x * z - s * y, 0, t * x * y - s * z, t * y * y + c, t * y * z + s * x, 0, t * x * z + s * y, t * y * z - s * x, t * z * z + c, 0, 0, 0, 0, 1];
}

/**
 * Where a leg stands, tilted outwards by `splay` radians round its top: the
 * foot moves away from the piece's centre, the way mid-century legs lean. The
 * leg is made `height / cos(splay)` long so the foot still reaches the floor.
 */
export function placeLeg(leg: Mesh, at: { x: number; z: number; top: number }, splay = 0): Mesh {
  const outward = normalize([at.x, 0, at.z], [0, 0, 1]);
  const tilt = splay === 0 ? compose() : rotationAxis(cross([0, -1, 0], outward), splay);
  // The leg is modelled standing on y = 0 with its top at y = length; hang it from its top, then tilt.
  const bounds = leg.bounds();
  const length = bounds.max[1];
  return leg.transform(compose(translation([at.x, at.top, at.z]), tilt, translation([0, -length, 0])));
}

// ─── Legs ───────────────────────────────────────────────────────────────────

export type LegStyle = "tapered" | "turned" | "square" | "block" | "bun" | "hairpin" | "metal-round" | "metal-square" | "cabriole";

/** A round leg narrowing towards the foot, with a small brass-like ferrule left to the caller. */
export function taperedLeg(height: number, top: number, foot: number): Mesh {
  const profile: ProfilePoint[] = [
    { r: 0, y: 0 },
    { r: foot * 0.92, y: 0 },
    { r: foot, y: foot * 0.08 },
    { r: top, y: height - top * 0.1 },
    { r: top * 0.92, y: height },
    { r: 0, y: height },
  ];
  return lathe(profile, { segments: 20, capBottom: false, capTop: false });
}

/**
 * A turned leg, as on a lathe in a joiner's shop: a foot, a long gently
 * swelling shaft, two beads and a cove, a square-ish block at the top where it
 * meets the frame. Built as a radius along the height.
 */
export function turnedLeg(height: number, radius: number): Mesh {
  const r = (t: number) => {
    // t from 0 (floor) to 1 (top).
    let value = radius * 0.72;
    if (t < 0.06) value = radius * (0.62 + 2 * t); // the foot
    else if (t < 0.12) value = radius * (0.95 - 2.5 * (t - 0.06)); // cove above the foot
    else if (t < 0.6) value = radius * (0.68 + 0.22 * Math.sin(Math.PI * ((t - 0.12) / 0.48))); // the swelling shaft
    else if (t < 0.66) value = radius * (0.7 + 0.32 * Math.sin(Math.PI * ((t - 0.6) / 0.06))); // a bead
    else if (t < 0.72) value = radius * 0.62;
    else if (t < 0.78) value = radius * (0.66 + 0.28 * Math.sin(Math.PI * ((t - 0.72) / 0.06))); // a second bead
    else value = radius * 0.98; // the top block
    return value;
  };
  const profile: ProfilePoint[] = [{ r: 0, y: 0 }];
  const steps = 48;
  for (let k = 0; k <= steps; k += 1) profile.push({ r: r(k / steps), y: (height * k) / steps });
  profile.push({ r: 0, y: height });
  return lathe(profile, { segments: 20, capBottom: false, capTop: false });
}

/** A square leg, slightly tapered, its edges softened. */
export function squareLeg(height: number, size: number, taper = 0.75): Mesh {
  const leg = roundedBox({ size: [size, height, size], radius: size * 0.08, segments: 2, step: height / 4, grain: 1 });
  // Narrow the lower part: scale x and z by height.
  for (let v = 0; v < leg.vertexCount; v += 1) {
    const [x, y, z] = leg.position(v);
    const t = (y + height / 2) / height;
    const k = taper + (1 - taper) * t;
    leg.setPosition(v, [x * k, y + height / 2, z * k]);
  }
  return leg;
}

/** A low turned bun foot, as under a Chesterfield or a traditional chest. */
export function bunFoot(radius: number, height: number): Mesh {
  const profile: ProfilePoint[] = [{ r: 0, y: 0 }];
  for (let k = 0; k <= 16; k += 1) {
    const t = k / 16;
    profile.push({ r: radius * (0.55 + 0.45 * Math.sin(Math.PI * Math.min(1, t * 1.15))), y: height * t });
  }
  profile.push({ r: radius * 0.5, y: height }, { r: 0, y: height });
  return lathe(profile, { segments: 20, capBottom: false, capTop: false });
}

/** A hairpin leg: one steel rod bent into a long V, its two ends at the top. */
export function hairpinLeg(height: number, spread: number, rod = 0.0055): Mesh {
  const path = roundedPolyline(
    [
      [-spread / 2, height, 0],
      [0, 0.01, 0],
      [spread / 2, height, 0],
    ],
    0.03,
    8,
  );
  return tube(path, rod, { segments: 10 });
}

/** A cabriole leg: the S-curved leg of traditional pieces, a tube of changing thickness along an S. */
export function cabrioleLeg(height: number, radius: number): Mesh {
  const path: Vec3[] = [];
  for (let k = 0; k <= 20; k += 1) {
    const t = k / 20;
    // Knee out, ankle in, foot out a little.
    const z = radius * (1.3 * Math.sin(Math.PI * t) * (t > 0.5 ? 1 : 0.6) - 0.9 * Math.sin(Math.PI * 2 * t) * 0.4);
    path.push([0, height * (1 - t), z]);
  }
  return tube(path, (t) => radius * (1 - 0.45 * Math.sin(Math.PI * Math.min(1, t * 1.1)) + (t > 0.92 ? 0.4 : 0)), { segments: 14 });
}

/** A leg of the given style, standing on y = 0. */
export function leg(style: LegStyle, height: number, thickness: number): Mesh {
  switch (style) {
    case "tapered":
      return taperedLeg(height, thickness / 2, thickness * 0.3);
    case "turned":
      return turnedLeg(height, thickness / 2);
    case "square":
      return squareLeg(height, thickness, 0.78);
    case "block":
      return squareLeg(height, thickness, 1);
    case "bun":
      return bunFoot(thickness / 2, height);
    case "hairpin":
      return hairpinLeg(height, thickness * 2.2);
    case "metal-round":
      return cylinder(thickness / 2, height, { bevel: thickness * 0.1, segments: 16 });
    case "metal-square":
      return roundedBox({ size: [thickness, height, thickness], radius: thickness * 0.15, segments: 2 }).translate([0, height / 2, 0]);
    case "cabriole":
      return cabrioleLeg(height, thickness / 2);
  }
}

/** A swivel castor: a wheel in a fork on a short stem. */
export function castor(wheel: number): { wheel: Mesh; fork: Mesh } {
  const r = wheel / 2;
  const tyre = lathe(
    [
      { r: 0, y: -r * 0.55 },
      { r: r * 0.7, y: -r * 0.55 },
      { r: r, y: -r * 0.3 },
      { r: r, y: r * 0.3 },
      { r: r * 0.7, y: r * 0.55 },
      { r: 0, y: r * 0.55 },
    ],
    { segments: 20 },
  );
  // Stand the wheel on its edge: its axis along x.
  tyre.transform(compose(translation([0, r, 0]), [0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]));
  const fork = roundedBox({ size: [r * 1.3, r * 1.1, r * 1.2], radius: r * 0.25, segments: 2 }).translate([0, r * 1.45, -r * 0.2]);
  fork.append(cylinder(r * 0.22, r * 0.9).translate([0, r * 1.9, 0]));
  return { wheel: tyre, fork };
}

// ─── Fittings ───────────────────────────────────────────────────────────────

export type HandleStyle = "bar" | "knob" | "cup" | "ring" | "none";

/** A handle on a front facing +z, centred at `at`. */
export function handle(style: HandleStyle, at: Vec3, width: number): Mesh {
  switch (style) {
    case "bar": {
      const length = Math.max(0.06, Math.min(0.24, width * 0.35));
      const path = roundedPolyline(
        [
          [-length / 2, 0, 0],
          [-length / 2, 0, 0.028],
          [length / 2, 0, 0.028],
          [length / 2, 0, 0],
        ],
        0.008,
        5,
      );
      return tube(path, 0.0055, { segments: 10 }).translate(at);
    }
    case "knob": {
      const knob = lathe(
        [
          { r: 0, y: 0 },
          { r: 0.006, y: 0 },
          { r: 0.005, y: 0.012 },
          { r: 0.015, y: 0.022 },
          { r: 0.014, y: 0.03 },
          { r: 0, y: 0.033 },
        ],
        { segments: 18 },
      );
      // Point it out of the front: y → +z.
      return knob.transform(compose(translation(at), [1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1]));
    }
    case "cup": {
      const cup = roundedBox({ size: [0.09, 0.03, 0.022], radius: 0.01, segments: 3 });
      return cup.translate([at[0], at[1], at[2] + 0.011]);
    }
    case "ring": {
      const ring = tube(arcPath([0, 0, 0], 0.022, 0, Math.PI * 2, "xy", 24), 0.004, { closed: true, segments: 8 });
      return ring.translate([at[0], at[1] - 0.02, at[2] + 0.008]);
    }
    case "none":
      return new Mesh();
  }
}

/** An upholstery button, a flattened dome. */
export function button(radius = 0.013): Mesh {
  // A small dome, so few facets: a sofa can carry a hundred and fifty of them.
  return lathe(
    [
      { r: radius, y: -radius * 0.3 },
      { r: radius * 0.9, y: radius * 0.18 },
      { r: radius * 0.45, y: radius * 0.4 },
      { r: 0, y: radius * 0.44 },
    ],
    { segments: 9, capBottom: false },
  );
}

/** Buttons placed on a face, each turned so its dome points along the face's normal. */
export function buttons(at: readonly { position: Vec3; normal: Vec3 }[], radius = 0.013): Mesh {
  const out = new Mesh();
  for (const { position, normal } of at) {
    const b = button(radius);
    // The button's dome points along +y; turn +y onto the normal.
    const axis = cross([0, 1, 0], normal);
    const angle = Math.acos(Math.max(-1, Math.min(1, normal[1])));
    const turn = Math.hypot(axis[0], axis[1], axis[2]) < 1e-6 ? (normal[1] < 0 ? rotationAxis([1, 0, 0], Math.PI) : compose()) : rotationAxis(axis, angle);
    out.append(b.transform(compose(translation(position), turn)));
  }
  return out;
}

/** Decorative nailheads along a path, every `spacing` metres, facing `normal`. */
export function nailheads(path: readonly Vec3[], normal: Vec3, spacing = 0.022, radius = 0.0055): Mesh {
  const out = new Mesh();
  // Each head is a ball squashed to 55% along the normal (I + (s − 1)·n·nᵀ): a dome on the fabric.
  const [nx, ny, nz] = normalize(normal);
  const k = 0.55 - 1;
  const squash: Mat4 = [1 + k * nx * nx, k * nx * ny, k * nx * nz, 0, k * nx * ny, 1 + k * ny * ny, k * ny * nz, 0, k * nx * nz, k * ny * nz, 1 + k * nz * nz, 0, 0, 0, 0, 1];
  let carried = 0;
  for (let i = 1; i < path.length; i += 1) {
    const a = path[i - 1]!;
    const b = path[i]!;
    const length = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    let s = carried;
    while (s <= length) {
      const t = length === 0 ? 0 : s / length;
      const p: Vec3 = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
      const head = sphere(radius, { segments: 10, rings: 6 });
      head.transform(compose(translation(p), squash));
      out.append(head);
      s += spacing;
    }
    carried = s - length;
  }
  return out;
}

/** A set of drawers, fronts slightly proud of the carcase, with handles. */
export function drawerFronts(
  area: { x: number; y: number; width: number; height: number; front: number },
  rows: number,
  columns: number,
  { gap = 0.004, thickness = 0.018, handleStyle = "bar" as HandleStyle, radius = 0.003 } = {},
): { fronts: Mesh; handles: Mesh } {
  const fronts = new Mesh();
  const handles = new Mesh();
  const cellW = (area.width - gap * (columns + 1)) / columns;
  const cellH = (area.height - gap * (rows + 1)) / rows;
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const cx = area.x - area.width / 2 + gap + cellW / 2 + column * (cellW + gap);
      const cy = area.y + gap + cellH / 2 + row * (cellH + gap);
      fronts.append(roundedBox({ size: [cellW, cellH, thickness], radius, segments: 2 }).translate([cx, cy, area.front - thickness / 2 + 0.004]));
      handles.append(handle(handleStyle, [cx, cy + (handleStyle === "knob" ? 0 : cellH * 0.12), area.front + 0.004], cellW));
    }
  }
  return { fronts, handles };
}

/** A shaker door: a flat frame round a recessed panel, with a handle on the opening side. */
export function shakerDoor(width: number, height: number, thickness = 0.02): Mesh {
  const frame = new Mesh();
  const rail = Math.min(0.07, width * 0.18, height * 0.18);
  frame.append(roundedBox({ size: [width, rail, thickness], radius: 0.003, segments: 2 }).translate([0, height / 2 - rail / 2, 0]));
  frame.append(roundedBox({ size: [width, rail, thickness], radius: 0.003, segments: 2 }).translate([0, -height / 2 + rail / 2, 0]));
  frame.append(roundedBox({ size: [rail, height - 2 * rail, thickness], radius: 0.003, segments: 2 }).translate([-width / 2 + rail / 2, 0, 0]));
  frame.append(roundedBox({ size: [rail, height - 2 * rail, thickness], radius: 0.003, segments: 2 }).translate([width / 2 - rail / 2, 0, 0]));
  frame.append(roundedBox({ size: [width - 2 * rail + 0.004, height - 2 * rail + 0.004, thickness * 0.5], radius: 0.002, segments: 1 }).translate([0, 0, -thickness * 0.3]));
  return frame;
}

/** A round seat or top seen from above, as a turned disc with a rounded rim. */
export function disc(radius: number, thickness: number, rim = thickness * 0.4): Mesh {
  return cylinder(radius, thickness, { bevel: rim, segments: 48 });
}

export { rotationY };
