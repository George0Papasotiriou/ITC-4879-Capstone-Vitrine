/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * The pieces in the window: their own 3D scans, measured; rugs and pictures from their photographs, cut out of the studio white.
 */

import {
  Box3,
  BoxGeometry,
  CanvasTexture,
  Color,
  DoubleSide,
  Group,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  SRGBColorSpace,
  Vector3,
  type Material,
  type Object3D,
} from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

import type { PieceForm, Vec3 } from "@/lib/display/scene";

import { PIECE_LAYER } from "./contact-shadows";

/**
 * docs/adr/048.
 *
 * A SCAN is loaded as it is — the shop's compressed copy of the ABO model, in
 * metres (docs/adr/035) — and measured: its bounding box gives the size the
 * room is arranged with, so the arrangement uses the scan's real extent, not
 * the listing's (a bed's listed width can be the scan's depth). It is then
 * centred on its footprint and stood on the floor; a pendant, whose model
 * hangs below its origin, is hung by its top. Copies (four dining chairs)
 * share the loaded geometry and materials.
 *
 * A PHOTOGRAPH stands for a piece without a scan. Studio photographs are shot
 * on white, so the white is removed — but only the white connected to the
 * photograph's edges (a flood fill from the border), so a white vase keeps its
 * white body. The result is trimmed to what is left. A rug is laid flat at its
 * true width and depth, a picture or a clock hung on the wall at its true size,
 * anything else stood up as a cut-out (the camera is kept from seeing it
 * edge-on).
 */

export type EnginePiece = {
  id: string;
  role: string | null;
  kind: string;
  quantity: number;
  /** The scan's address, when the shop has one in storage. */
  model: string | null;
  /** The photograph through the shop's image optimizer (same origin). */
  image: string | null;
  /** Listed size in metres (x across, y up, z deep), when measured. */
  dims: Vec3 | null;
};

export type LoadedPiece = {
  piece: EnginePiece;
  form: PieceForm;
  size: Vec3;
  hangs: boolean;
  /** A new instance for one copy; scans share their geometry and materials. */
  make: () => Group;
  /** Materials the scene fades in and out (photograph pieces only). */
  fadeable: Material[];
};

const WALL_KINDS = new Set(["WALL_ART", "PICTURE_FRAME", "HOME_MIRROR", "CLOCK"]);
const STAND_IN: Vec3 = { x: 0.5, y: 0.6, z: 0.5 };

const loader = new GLTFLoader();
const scans = new Map<string, Promise<{ scene: Object3D; size: Vec3; hangs: boolean }>>();

function prepare(object: Object3D): void {
  object.traverse((child) => {
    child.layers.enable(PIECE_LAYER);
    if ((child as Mesh).isMesh) {
      const mesh = child as Mesh;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    }
  });
}

/** Loads and measures a scan once per address; every window that shows it reuses it. */
function loadScan(src: string, kind: string, onBytes: (loaded: number, total: number) => void) {
  let pending = scans.get(src);
  if (pending === undefined) {
    pending = loader
      .loadAsync(src, (event) => onBytes(event.loaded, event.total))
      .then((gltf) => {
        const scene = gltf.scene;
        scene.updateMatrixWorld(true);
        const box = new Box3().setFromObject(scene);
        const size = box.getSize(new Vector3());
        // A pendant's model hangs below its origin; it is hung by its top.
        const hangs = kind === "LIGHT_FIXTURE" && box.max.y <= 0.05 && box.min.y < -0.05;
        scene.position.set(-(box.min.x + box.max.x) / 2, hangs ? -box.max.y : -box.min.y, -(box.min.z + box.max.z) / 2);
        prepare(scene);
        return { scene, size: { x: size.x, y: size.y, z: size.z }, hangs };
      });
    scans.set(src, pending);
    // A failed load is forgotten, so the next window may try again.
    pending.catch(() => scans.delete(src));
  }
  return pending;
}

/**
 * The photograph with its studio white removed: a flood fill from every edge
 * pixel through pixels that are near white (bright and nearly grey), made
 * transparent with a one-pixel soft edge, then trimmed to what remains.
 */
async function cutOut(src: string, keepRectangle: boolean): Promise<{ texture: CanvasTexture; aspect: number }> {
  const response = await fetch(src);
  if (!response.ok) throw new Error(`photograph ${response.status}`);
  const bitmap = await createImageBitmap(await response.blob());
  const width = bitmap.width;
  const height = bitmap.height;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true })!;
  context.drawImage(bitmap, 0, 0);
  bitmap.close();
  const image = context.getImageData(0, 0, width, height);
  const data = image.data;
  const white = (index: number) => {
    const r = data[index]!;
    const g = data[index + 1]!;
    const b = data[index + 2]!;
    return Math.min(r, g, b) > 236 && Math.max(r, g, b) - Math.min(r, g, b) < 14;
  };

  const background = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  let head = 0;
  let tail = 0;
  const seed = (x: number, y: number) => {
    const at = y * width + x;
    if (background[at] === 0 && white(at * 4)) {
      background[at] = 1;
      queue[tail++] = at;
    }
  };
  for (let x = 0; x < width; x += 1) {
    seed(x, 0);
    seed(x, height - 1);
  }
  for (let y = 0; y < height; y += 1) {
    seed(0, y);
    seed(width - 1, y);
  }
  while (head < tail) {
    const at = queue[head++]!;
    const x = at % width;
    const y = (at - x) / width;
    if (x > 0) seed(x - 1, y);
    if (x < width - 1) seed(x + 1, y);
    if (y > 0) seed(x, y - 1);
    if (y < height - 1) seed(x, y + 1);
  }

  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const at = y * width + x;
      if (background[at] === 1) {
        if (!keepRectangle) {
          // A soft edge: background next to the piece is half transparent rather than gone.
          const nearPiece = (x > 0 && background[at - 1] === 0) || (x < width - 1 && background[at + 1] === 0) || (y > 0 && background[at - width] === 0) || (y < height - 1 && background[at + width] === 0);
          data[at * 4 + 3] = nearPiece ? 96 : 0;
        }
      } else {
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    }
  }
  if (maxX < minX) {
    minX = 0;
    minY = 0;
    maxX = width - 1;
    maxY = height - 1;
  }
  context.putImageData(image, 0, 0);
  const trimmedWidth = maxX - minX + 1;
  const trimmedHeight = maxY - minY + 1;
  const trimmed = document.createElement("canvas");
  trimmed.width = trimmedWidth;
  trimmed.height = trimmedHeight;
  trimmed.getContext("2d")!.drawImage(canvas, minX, minY, trimmedWidth, trimmedHeight, 0, 0, trimmedWidth, trimmedHeight);
  const texture = new CanvasTexture(trimmed);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 8;
  return { texture, aspect: trimmedWidth / trimmedHeight };
}

function formOf(piece: EnginePiece): PieceForm {
  if (piece.kind === "RUG") return "rug";
  if (WALL_KINDS.has(piece.kind)) return "wall";
  return "photo";
}

async function photoPiece(piece: EnginePiece, form: PieceForm): Promise<LoadedPiece> {
  const dims = piece.dims ?? STAND_IN;
  const cut = piece.image === null ? null : await cutOut(piece.image, form === "rug").catch(() => null);
  const face = new MeshStandardMaterial({
    color: new Color(1, 1, 1),
    map: cut?.texture ?? null,
    roughness: form === "rug" ? 0.96 : 0.7,
    transparent: form !== "rug",
    alphaTest: form === "rug" ? 0 : 0.4,
    ...(form === "photo" ? { side: DoubleSide } : {}),
  });

  if (form === "rug") {
    // Laid flat; the photograph turned if its long side runs the other way to the rug's.
    // A rug listed without a sensible size is drawn at a common 160 × 230 cm.
    const size = { x: dims.x >= 0.2 ? dims.x : 1.6, y: 0.012, z: dims.z >= 0.2 ? dims.z : 2.3 };
    if (cut !== null && cut.aspect > 1 !== size.x > size.z) {
      cut.texture.center.set(0.5, 0.5);
      cut.texture.rotation = Math.PI / 2;
    }
    const edge = new MeshStandardMaterial({ color: new Color(0.42, 0.4, 0.38), roughness: 1 });
    const geometry = new BoxGeometry(size.x, size.y, size.z);
    return {
      piece,
      form,
      size,
      hangs: false,
      fadeable: [face, edge],
      make: () => {
        const holder = new Group();
        // A box's faces: +x, −x, +y (the top), −y, +z, −z.
        const mesh = new Mesh(geometry, [edge, edge, face, edge, edge, edge]);
        mesh.position.y = size.y / 2;
        mesh.receiveShadow = true;
        holder.add(mesh);
        return holder;
      },
    };
  }

  // Stood: true height from the listing, width from the photograph's own proportions so nothing is stretched.
  // Hung: listings give a picture's or a clock's measurements in any order, so its face is its two largest
  // measurements and its thickness the smallest; the photograph's proportions say which way up the face is.
  const sorted = [dims.x, dims.y, dims.z].sort((a, b) => b - a);
  const faceSize = { long: Math.min(sorted[0]!, 1.6), short: Math.min(sorted[1]!, 1.6) };
  let width: number;
  let height: number;
  if (form === "wall") {
    const aspect = cut?.aspect ?? faceSize.long / Math.max(0.01, faceSize.short);
    width = aspect >= 1 ? faceSize.long : faceSize.long * aspect;
    height = aspect >= 1 ? faceSize.long / aspect : faceSize.long;
  } else {
    height = dims.y;
    width = cut === null ? dims.x : height * cut.aspect;
  }
  const depth = form === "wall" ? Math.min(0.05, Math.max(0.015, sorted[2]!)) : 0.001;
  const geometry = new PlaneGeometry(width, height);
  return {
    piece,
    form,
    size: { x: width, y: height, z: form === "wall" ? depth : Math.max(0.05, dims.z * 0.2) },
    hangs: false,
    fadeable: [face],
    make: () => {
      const holder = new Group();
      const mesh = new Mesh(geometry, face);
      mesh.position.set(0, height / 2, form === "wall" ? depth / 2 : 0);
      mesh.castShadow = form === "photo";
      mesh.receiveShadow = true;
      mesh.layers.enable(PIECE_LAYER);
      holder.add(mesh);
      return holder;
    },
  };
}

/** Loads one piece; a scan that fails falls back to its photograph, and the window still opens. */
export async function loadPiece(piece: EnginePiece, onBytes: (loaded: number, total: number) => void): Promise<LoadedPiece> {
  if (piece.model !== null) {
    try {
      const scan = await loadScan(piece.model, piece.kind, onBytes);
      return {
        piece,
        form: "scan",
        size: scan.size,
        hangs: scan.hangs,
        fadeable: [],
        make: () => {
          const holder = new Group();
          holder.add(scan.scene.clone(true));
          return holder;
        },
      };
    } catch {
      // Fall through to the photograph.
    }
  }
  return photoPiece(piece, formOf(piece));
}

/** Where a lamp's light comes from: near the top of a standing lamp, inside the shade of a pendant. */
export function bulbOf(loaded: LoadedPiece, position: Vector3): Vector3 | null {
  const lamp = loaded.piece.kind === "LAMP" || loaded.piece.kind === "HOME_LIGHTING_AND_LAMPS" || loaded.piece.kind === "LIGHT_FIXTURE";
  if (!lamp) return null;
  return loaded.hangs ? position.clone().add(new Vector3(0, -loaded.size.y * 0.88, 0)) : position.clone().add(new Vector3(0, loaded.size.y * 0.8, 0));
}
