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

import { cutoutFromWhite } from "@/lib/vision/cutout";
import { quadFromMask, targetRectangle, warp } from "@/lib/vision/rectify";

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
 * A PHOTOGRAPH stands for a piece without a scan — always its studio
 * photograph (on white), never a room scene. The white is removed by the
 * shop's edge flood fill (cutout.ts), so a white vase keeps its white body. A
 * picture or a clock is hung on the wall at its true size, anything else
 * stood up as a cut-out. A rug's studio photograph shows it lying at an angle,
 * so it is rectified back to the flat rug seen from above (rectify.ts) and
 * laid on the floor at its true width and depth. A piece with no studio
 * photograph, or a rug whose outline cannot be found, is left out of the room
 * (it stays in the list below the window) rather than drawn wrong.
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

/** The photograph's pixels, read from the shop's image optimizer (same origin, so the canvas is not tainted). */
async function pixels(src: string): Promise<{ data: Uint8ClampedArray<ArrayBuffer>; width: number; height: number }> {
  const response = await fetch(src);
  if (!response.ok) throw new Error(`photograph ${response.status}`);
  const bitmap = await createImageBitmap(await response.blob());
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext("2d", { willReadFrequently: true })!;
  context.drawImage(bitmap, 0, 0);
  bitmap.close();
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  return { data: image.data, width: canvas.width, height: canvas.height };
}

function textureOf(rgba: Uint8ClampedArray<ArrayBuffer>, width: number, height: number, crop?: { x: number; y: number; width: number; height: number }): CanvasTexture {
  const full = document.createElement("canvas");
  full.width = width;
  full.height = height;
  full.getContext("2d")!.putImageData(new ImageData(rgba, width, height), 0, 0);
  let canvas = full;
  if (crop !== undefined) {
    canvas = document.createElement("canvas");
    canvas.width = crop.width;
    canvas.height = crop.height;
    canvas.getContext("2d")!.drawImage(full, crop.x, crop.y, crop.width, crop.height, 0, 0, crop.width, crop.height);
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

/**
 * A picture, a clock or a stand-in piece: its studio photograph cut out of the
 * white by the shop's own edge flood fill (src/lib/vision/cutout.ts), trimmed
 * to the piece.
 */
async function cutOut(src: string): Promise<{ texture: CanvasTexture; aspect: number } | null> {
  const photo = await pixels(src);
  const cut = cutoutFromWhite(photo.data, photo.width, photo.height);
  if (!cut.removed || cut.box.width < 8 || cut.box.height < 8) return null;
  return { texture: textureOf(cut.rgba, cut.width, cut.height, cut.box), aspect: cut.box.width / cut.box.height };
}

/**
 * A rug seen from straight above, from its studio photograph taken at an
 * angle: cut out, its four corners found, warped flat at its true proportions
 * (src/lib/vision/rectify.ts). Null when the photograph does not show a whole
 * rug on white — the rug is then left out of the room rather than drawn wrong.
 */
async function flatRug(src: string, size: { x: number; z: number }): Promise<CanvasTexture | null> {
  const photo = await pixels(src);
  const cut = cutoutFromWhite(photo.data, photo.width, photo.height);
  if (!cut.removed) return null;
  const mask = new Uint8Array(cut.width * cut.height);
  for (let index = 0; index < mask.length; index += 1) mask[index] = cut.rgba[index * 4 + 3]! > 200 ? 1 : 0;
  const quad = quadFromMask({ data: mask, width: cut.width, height: cut.height });
  if (quad === null) return null;
  const long = Math.max(size.x, size.z);
  const short = Math.min(size.x, size.z);
  const target = targetRectangle(quad, { long, short }, 1024);
  const flat = warp({ data: photo.data, width: photo.width, height: photo.height }, quad, target);
  const texture = textureOf(flat, target.width, target.height);
  // The texture's width runs along the rug's x; turn it if the photograph's long side came out the other way.
  if (target.width >= target.height !== size.x >= size.z) {
    texture.center.set(0.5, 0.5);
    texture.rotation = Math.PI / 2;
  }
  return texture;
}

function formOf(piece: EnginePiece): PieceForm {
  if (piece.kind === "RUG") return "rug";
  if (WALL_KINDS.has(piece.kind)) return "wall";
  return "photo";
}

/** A piece drawn from its studio photograph, or null when there is none fit to draw it from. */
async function photoPiece(piece: EnginePiece, form: PieceForm): Promise<LoadedPiece | null> {
  if (piece.image === null) return null;
  const dims = piece.dims ?? STAND_IN;

  if (form === "rug") {
    // A rug listed without a sensible size is drawn at a common 160 × 230 cm.
    const size = { x: dims.x >= 0.2 ? dims.x : 1.6, y: 0.012, z: dims.z >= 0.2 ? dims.z : 2.3 };
    const texture = await flatRug(piece.image, size).catch(() => null);
    if (texture === null) return null;
    const face = new MeshStandardMaterial({ color: new Color(1, 1, 1), map: texture, roughness: 0.96 });
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

  const cut = await cutOut(piece.image).catch(() => null);
  if (cut === null) return null;
  const face = new MeshStandardMaterial({
    color: new Color(1, 1, 1),
    map: cut.texture,
    roughness: 0.7,
    transparent: true,
    alphaTest: 0.4,
    ...(form === "photo" ? { side: DoubleSide } : {}),
  });

  // Stood: true height from the listing, width from the photograph's own proportions so nothing is stretched.
  // Hung: listings give a picture's or a clock's measurements in any order, so its face is its two largest
  // measurements and its thickness the smallest; the photograph's proportions say which way up the face is.
  const sorted = [dims.x, dims.y, dims.z].sort((a, b) => b - a);
  const faceSize = { long: Math.min(sorted[0]!, 1.6), short: Math.min(sorted[1]!, 1.6) };
  let width: number;
  let height: number;
  if (form === "wall") {
    width = cut.aspect >= 1 ? faceSize.long : faceSize.long * cut.aspect;
    height = cut.aspect >= 1 ? faceSize.long / cut.aspect : faceSize.long;
  } else {
    height = dims.y;
    width = height * cut.aspect;
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
export async function loadPiece(piece: EnginePiece, onBytes: (loaded: number, total: number) => void): Promise<LoadedPiece | null> {
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
