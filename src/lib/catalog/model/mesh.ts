/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * A triangle mesh with smooth normals and texture coordinates, and the few transforms a furniture model needs.
 */

/**
 * docs/adr/058. Everything the modeler draws ends up as one of these: indexed
 * triangles, each vertex with a position (metres, Y up), a unit normal for
 * shading, and texture coordinates *in metres* — so a wood grain or a fabric
 * weave keeps its real scale whether it lands on a stool or a sofa.
 *
 * Triangles are wound anticlockwise seen from outside, the glTF convention.
 */

export type Vec2 = [number, number];
export type Vec3 = [number, number, number];

export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const length = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
export function normalize(a: Vec3, fallback: Vec3 = [0, 1, 0]): Vec3 {
  const l = length(a);
  return l < 1e-12 ? fallback : [a[0] / l, a[1] / l, a[2] / l];
}
export const lerp3 = (a: Vec3, b: Vec3, t: number): Vec3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/**
 * A 4×4 transform, column-major as glTF and WebGL store it: the point (x, y, z)
 * becomes (m0·x + m4·y + m8·z + m12, …).
 */
export type Mat4 = number[];

export const identity = (): Mat4 => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

export function multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Array<number>(16).fill(0);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      let sum = 0;
      for (let k = 0; k < 4; k += 1) sum += a[k * 4 + row]! * b[column * 4 + k]!;
      out[column * 4 + row] = sum;
    }
  }
  return out;
}

/** Applied right to left: compose(a, b, c) moves a point by c, then b, then a. */
export const compose = (...transforms: Mat4[]): Mat4 => transforms.reduce((all, next) => multiply(all, next), identity());

export const translation = ([x, y, z]: Vec3): Mat4 => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
export const scaling = ([x, y, z]: Vec3): Mat4 => [x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0, 0, 0, 0, 1];

export function rotationX(angle: number): Mat4 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1];
}
export function rotationY(angle: number): Mat4 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1];
}
export function rotationZ(angle: number): Mat4 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

export function transformPoint(m: Mat4, [x, y, z]: Vec3): Vec3 {
  return [m[0]! * x + m[4]! * y + m[8]! * z + m[12]!, m[1]! * x + m[5]! * y + m[9]! * z + m[13]!, m[2]! * x + m[6]! * y + m[10]! * z + m[14]!];
}

/**
 * Normals do not move like points: under a stretch they must lean the other
 * way, so they are carried by the inverse transpose of the matrix's 3×3 part
 * (for a rotation that is the rotation itself; for a stretch, its reciprocal).
 */
function normalMatrix(m: Mat4): number[] {
  const [a, b, c, d, e, f, g, h, i] = [m[0]!, m[4]!, m[8]!, m[1]!, m[5]!, m[9]!, m[2]!, m[6]!, m[10]!];
  // Cofactors of the row-major 3×3 [[a b c] [d e f] [g h i]]: the inverse transpose is cofactor / determinant.
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const D = -(b * i - c * h);
  const E = a * i - c * g;
  const F = -(a * h - b * g);
  const G = b * f - c * e;
  const H = -(a * f - c * d);
  const I = a * e - b * d;
  const det = a * A + b * B + c * C;
  const k = Math.abs(det) < 1e-18 ? 0 : 1 / det;
  return [A * k, B * k, C * k, D * k, E * k, F * k, G * k, H * k, I * k];
}

export class Mesh {
  positions: number[] = [];
  normals: number[] = [];
  uvs: number[] = [];
  indices: number[] = [];

  get vertexCount(): number {
    return this.positions.length / 3;
  }

  get triangleCount(): number {
    return this.indices.length / 3;
  }

  vertex(position: Vec3, normal: Vec3, uv: Vec2): number {
    this.positions.push(position[0], position[1], position[2]);
    this.normals.push(normal[0], normal[1], normal[2]);
    this.uvs.push(uv[0], uv[1]);
    return this.vertexCount - 1;
  }

  triangle(a: number, b: number, c: number): void {
    this.indices.push(a, b, c);
  }

  /** Four corners anticlockwise seen from outside, as two triangles. */
  quad(a: number, b: number, c: number, d: number): void {
    this.indices.push(a, b, c, a, c, d);
  }

  append(other: Mesh): this {
    const offset = this.vertexCount;
    // One at a time: spreading a large mesh into push() would overflow the call stack.
    for (const value of other.positions) this.positions.push(value);
    for (const value of other.normals) this.normals.push(value);
    for (const value of other.uvs) this.uvs.push(value);
    for (const index of other.indices) this.indices.push(index + offset);
    return this;
  }

  clone(): Mesh {
    return new Mesh().append(this);
  }

  /** Moves, turns or stretches the mesh in place. A mirroring transform also flips the winding, so faces stay outward. */
  transform(m: Mat4): this {
    const n = normalMatrix(m);
    for (let v = 0; v < this.vertexCount; v += 1) {
      const p = transformPoint(m, [this.positions[v * 3]!, this.positions[v * 3 + 1]!, this.positions[v * 3 + 2]!]);
      this.positions[v * 3] = p[0];
      this.positions[v * 3 + 1] = p[1];
      this.positions[v * 3 + 2] = p[2];
      const [x, y, z] = [this.normals[v * 3]!, this.normals[v * 3 + 1]!, this.normals[v * 3 + 2]!];
      const turned = normalize([n[0]! * x + n[1]! * y + n[2]! * z, n[3]! * x + n[4]! * y + n[5]! * z, n[6]! * x + n[7]! * y + n[8]! * z]);
      this.normals[v * 3] = turned[0];
      this.normals[v * 3 + 1] = turned[1];
      this.normals[v * 3 + 2] = turned[2];
    }
    const determinant = m[0]! * (m[5]! * m[10]! - m[9]! * m[6]!) - m[4]! * (m[1]! * m[10]! - m[9]! * m[2]!) + m[8]! * (m[1]! * m[6]! - m[5]! * m[2]!);
    if (determinant < 0) {
      for (let t = 0; t < this.indices.length; t += 3) [this.indices[t + 1], this.indices[t + 2]] = [this.indices[t + 2]!, this.indices[t + 1]!];
    }
    return this;
  }

  translate(offset: Vec3): this {
    return this.transform(translation(offset));
  }

  position(v: number): Vec3 {
    return [this.positions[v * 3]!, this.positions[v * 3 + 1]!, this.positions[v * 3 + 2]!];
  }

  normal(v: number): Vec3 {
    return [this.normals[v * 3]!, this.normals[v * 3 + 1]!, this.normals[v * 3 + 2]!];
  }

  setPosition(v: number, p: Vec3): void {
    this.positions[v * 3] = p[0];
    this.positions[v * 3 + 1] = p[1];
    this.positions[v * 3 + 2] = p[2];
  }

  bounds(): { min: Vec3; max: Vec3 } {
    const min: Vec3 = [Infinity, Infinity, Infinity];
    const max: Vec3 = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < this.positions.length; i += 1) {
      const axis = i % 3;
      min[axis] = Math.min(min[axis]!, this.positions[i]!);
      max[axis] = Math.max(max[axis]!, this.positions[i]!);
    }
    return { min, max };
  }

  /**
   * Normals again from the triangles, after the surface has been pushed about
   * (a cushion's crown, a button's dimple). Each triangle adds its normal,
   * weighted by its area, to its corners; vertices at the same place (the seam
   * of a turned leg, the edge between two faces of a rounded box) are summed
   * together so no seam shows in the light.
   */
  recomputeNormals(): this {
    const key = (v: number) => `${Math.round(this.positions[v * 3]! * 1e5)},${Math.round(this.positions[v * 3 + 1]! * 1e5)},${Math.round(this.positions[v * 3 + 2]! * 1e5)}`;
    const groups = new Map<string, number[]>();
    for (let v = 0; v < this.vertexCount; v += 1) {
      const k = key(v);
      const group = groups.get(k);
      if (group === undefined) groups.set(k, [v]);
      else group.push(v);
    }
    const sums = new Map<string, Vec3>();
    for (let t = 0; t < this.indices.length; t += 3) {
      const [a, b, c] = [this.indices[t]!, this.indices[t + 1]!, this.indices[t + 2]!];
      // The cross product's length is twice the area: larger triangles count for more.
      const face = cross(sub(this.position(b), this.position(a)), sub(this.position(c), this.position(a)));
      for (const v of [a, b, c]) {
        const k = key(v);
        sums.set(k, add(sums.get(k) ?? [0, 0, 0], face));
      }
    }
    for (const [k, members] of groups) {
      const sum = sums.get(k);
      for (const v of members) {
        const n = sum === undefined ? this.normal(v) : normalize(sum, this.normal(v));
        this.normals[v * 3] = n[0];
        this.normals[v * 3 + 1] = n[1];
        this.normals[v * 3 + 2] = n[2];
      }
    }
    return this;
  }

  /**
   * Tangents for normal maps: the direction in which the texture's u grows,
   * along the surface, with a fourth number saying whether v grows the
   * matching way (+1) or the mirrored way (−1). Worked out per triangle from
   * how its corners' positions change with their texture coordinates, summed at
   * each vertex and made perpendicular to the normal (Gram–Schmidt).
   */
  tangents(): Float32Array<ArrayBuffer> {
    const count = this.vertexCount;
    const tan = new Float64Array(count * 3);
    const bit = new Float64Array(count * 3);
    for (let t = 0; t < this.indices.length; t += 3) {
      const [a, b, c] = [this.indices[t]!, this.indices[t + 1]!, this.indices[t + 2]!];
      const e1 = sub(this.position(b), this.position(a));
      const e2 = sub(this.position(c), this.position(a));
      const du1 = this.uvs[b * 2]! - this.uvs[a * 2]!;
      const dv1 = this.uvs[b * 2 + 1]! - this.uvs[a * 2 + 1]!;
      const du2 = this.uvs[c * 2]! - this.uvs[a * 2]!;
      const dv2 = this.uvs[c * 2 + 1]! - this.uvs[a * 2 + 1]!;
      const det = du1 * dv2 - du2 * dv1;
      if (Math.abs(det) < 1e-14) continue;
      const r = 1 / det;
      const sdir = scale(sub(scale(e1, dv2), scale(e2, dv1)), r);
      const tdir = scale(sub(scale(e2, du1), scale(e1, du2)), r);
      for (const v of [a, b, c]) {
        for (let axis = 0; axis < 3; axis += 1) {
          tan[v * 3 + axis] = tan[v * 3 + axis]! + sdir[axis]!;
          bit[v * 3 + axis] = bit[v * 3 + axis]! + tdir[axis]!;
        }
      }
    }
    const out = new Float32Array(count * 4);
    for (let v = 0; v < count; v += 1) {
      const n = this.normal(v);
      const t: Vec3 = [tan[v * 3]!, tan[v * 3 + 1]!, tan[v * 3 + 2]!];
      // Gram–Schmidt: remove the part of t along n. A vertex no triangle could orient gets any perpendicular.
      let ortho = normalize(sub(t, scale(n, dot(n, t))), [0, 0, 0]);
      if (ortho[0] === 0 && ortho[1] === 0 && ortho[2] === 0) ortho = normalize(cross(Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0], n));
      const handed = dot(cross(n, ortho), [bit[v * 3]!, bit[v * 3 + 1]!, bit[v * 3 + 2]!]) < 0 ? -1 : 1;
      out.set([ortho[0], ortho[1], ortho[2], handed], v * 4);
    }
    return out;
  }
}
