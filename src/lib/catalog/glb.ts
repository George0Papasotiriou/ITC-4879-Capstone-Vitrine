/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Writing a glTF binary (.glb) model from boxes: the file format the phone's AR viewers read.
 */

/**
 * A model the shop can make for itself (docs/adr/025).
 *
 * Photographed products have no 3D scan, and the dataset's own models are a
 * large download nobody has approved yet. But the catalogue does know each
 * piece's real width, depth and height — which is the thing an AR view is
 * actually asked: will it fit, and how big is it in this room? So the shop
 * builds a simplified shape at those exact dimensions and hands it to the
 * phone. Every screen that shows it says it is a stand-in.
 *
 * The file is written here rather than by a library: a .glb is a 12-byte
 * header and two chunks, and writing them is less code than the dependency
 * would be. Everything is in metres with Y up and the piece standing on
 * y = 0, which is what Scene Viewer, Quick Look and WebXR expect of a model
 * meant to be placed on a floor.
 */

/** A rectangular part, in metres, centred on (x, y, z). */
export type Part = {
  x: number;
  y: number;
  z: number;
  width: number;
  height: number;
  depth: number;
  /** sRGB hex, as the design tokens and the catalogue write colours. */
  color: string;
};

const MAGIC = 0x46546c67;
const JSON_CHUNK = 0x4e4f534a;
const BIN_CHUNK = 0x004e4942;

/** A box as six faces of four corners each, so every face keeps its own normal and the shape reads as solid. */
const FACES: { normal: [number, number, number]; corners: [number, number, number][] }[] = [
  { normal: [0, 0, 1], corners: [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]] },
  { normal: [0, 0, -1], corners: [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]] },
  { normal: [1, 0, 0], corners: [[1, -1, 1], [1, -1, -1], [1, 1, -1], [1, 1, 1]] },
  { normal: [-1, 0, 0], corners: [[-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1]] },
  { normal: [0, 1, 0], corners: [[-1, 1, 1], [1, 1, 1], [1, 1, -1], [-1, 1, -1]] },
  { normal: [0, -1, 0], corners: [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]] },
];

/**
 * sRGB to linear light. glTF base colours are linear, so a colour pasted
 * straight from a hex value would come out pale and chalky.
 */
function linear(channel: number): number {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

/** [r, g, b, 1] in linear light from "#rrggbb"; anything unreadable falls back to a mid grey. */
export function baseColor(hex: string): [number, number, number, number] {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (match === null) return [linear(150), linear(150), linear(150), 1];
  const value = Number.parseInt(match[1]!, 16);
  return [linear((value >> 16) & 255), linear((value >> 8) & 255), linear(value & 255), 1];
}

/** Positions, normals and indices for one part, ready to be concatenated. */
function geometry(part: Part): { positions: Float32Array; normals: Float32Array; indices: Uint16Array; min: number[]; max: number[] } {
  const positions = new Float32Array(FACES.length * 4 * 3);
  const normals = new Float32Array(FACES.length * 4 * 3);
  const indices = new Uint16Array(FACES.length * 6);
  const half = [part.width / 2, part.height / 2, part.depth / 2];
  const centre = [part.x, part.y, part.z];
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];

  let vertex = 0;
  let index = 0;
  for (const face of FACES) {
    const first = vertex;
    for (const corner of face.corners) {
      for (let axis = 0; axis < 3; axis += 1) {
        const value = centre[axis]! + corner[axis]! * half[axis]!;
        positions[vertex * 3 + axis] = value;
        normals[vertex * 3 + axis] = face.normal[axis]!;
        min[axis] = Math.min(min[axis]!, value);
        max[axis] = Math.max(max[axis]!, value);
      }
      vertex += 1;
    }
    // Two triangles per face, wound anticlockwise seen from outside.
    indices[index] = first;
    indices[index + 1] = first + 1;
    indices[index + 2] = first + 2;
    indices[index + 3] = first;
    indices[index + 4] = first + 2;
    indices[index + 5] = first + 3;
    index += 6;
  }
  return { positions, normals, indices, min, max };
}

/** Four bytes at a time: every chunk and every view in a .glb starts on a multiple of four. */
const padded = (length: number) => length + ((4 - (length % 4)) % 4);

/**
 * A .glb holding one mesh with one part per primitive. Parts arrive in metres,
 * placed by the caller so the piece stands on y = 0 and is centred on x and z.
 */
export function glbFromParts(parts: readonly Part[], { name = "Vitrine piece" }: { name?: string } = {}): Uint8Array {
  if (parts.length === 0) throw new RangeError("A model needs at least one part");

  const bufferViews: Record<string, number>[] = [];
  const accessors: Record<string, unknown>[] = [];
  const primitives: Record<string, unknown>[] = [];
  const materials: Record<string, unknown>[] = [];
  const chunks: Uint8Array[] = [];
  let offset = 0;

  const view = (data: ArrayBufferView, target: number): number => {
    const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    chunks.push(bytes);
    bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.byteLength, target });
    const gap = padded(bytes.byteLength) - bytes.byteLength;
    if (gap > 0) chunks.push(new Uint8Array(gap));
    offset += padded(bytes.byteLength);
    return bufferViews.length - 1;
  };

  for (const part of parts) {
    const { positions, normals, indices, min, max } = geometry(part);
    const positionView = view(positions, 34962);
    const normalView = view(normals, 34962);
    const indexView = view(indices, 34963);

    accessors.push({ bufferView: positionView, componentType: 5126, count: positions.length / 3, type: "VEC3", min, max });
    accessors.push({ bufferView: normalView, componentType: 5126, count: normals.length / 3, type: "VEC3" });
    accessors.push({ bufferView: indexView, componentType: 5123, count: indices.length, type: "SCALAR" });

    materials.push({ pbrMetallicRoughness: { baseColorFactor: baseColor(part.color), metallicFactor: 0, roughnessFactor: 0.85 } });
    primitives.push({
      attributes: { POSITION: accessors.length - 3, NORMAL: accessors.length - 2 },
      indices: accessors.length - 1,
      material: materials.length - 1,
    });
  }

  const binary = new Uint8Array(offset);
  let written = 0;
  for (const chunk of chunks) {
    binary.set(chunk, written);
    written += chunk.byteLength;
  }

  const gltf = {
    asset: { version: "2.0", generator: "Vitrine (student project)" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name }],
    meshes: [{ name, primitives }],
    materials,
    accessors,
    bufferViews,
    buffers: [{ byteLength: binary.byteLength }],
  };

  const json = new TextEncoder().encode(JSON.stringify(gltf));
  const jsonLength = padded(json.byteLength);
  const total = 12 + 8 + jsonLength + 8 + binary.byteLength;

  const file = new Uint8Array(total);
  const header = new DataView(file.buffer);
  header.setUint32(0, MAGIC, true);
  header.setUint32(4, 2, true);
  header.setUint32(8, total, true);
  header.setUint32(12, jsonLength, true);
  header.setUint32(16, JSON_CHUNK, true);
  file.set(json, 20);
  // The JSON chunk is padded with spaces and the binary chunk with zeroes, as
  // the specification requires; a reader that ignores the padding is not one
  // this shop can assume.
  file.fill(0x20, 20 + json.byteLength, 20 + jsonLength);
  header.setUint32(20 + jsonLength, binary.byteLength, true);
  header.setUint32(24 + jsonLength, BIN_CHUNK, true);
  file.set(binary, 28 + jsonLength);
  return file;
}
