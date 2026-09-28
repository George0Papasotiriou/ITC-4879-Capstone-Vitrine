/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Making an ABO 3D scan light enough for a phone: textures resized, duplicates and unused data removed.
 */

import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dedup, getBounds, prune, textureCompress, weld } from "@gltf-transform/functions";
import sharp from "sharp";

/**
 * docs/adr/035. ABO's models carry 2K–4K textures and average 19.5 MB; a phone
 * on a product page should not download that. Every step here keeps the file a
 * plain glTF 2.0 binary that three.js, model-viewer, Android's Scene Viewer
 * and iOS Quick Look all open without extra decoders:
 *
 *   dedup, prune  identical accessors, meshes and textures merged; anything
 *                 no node uses removed;
 *   weld          vertices that share every attribute merged, which also
 *                 shrinks the index buffers;
 *   textures      resized to at most 1024 px on the longer side and
 *                 re-encoded in their own format (JPEG stays JPEG, PNG stays
 *                 PNG) — no WebP or Basis, which some AR viewers cannot read.
 *
 * No geometry compression (Draco, meshopt): both need a decoder, which
 * model-viewer fetches from a third-party CDN.
 */

export type CompressedModel = { glb: Uint8Array; bytes: number; extentM: { x: number; y: number; z: number } };

/** Textures above this edge are resized; below it they are only re-encoded. */
export const TEXTURE_EDGE = 1024;

export async function compressModel(original: Uint8Array): Promise<CompressedModel> {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const document = await io.readBinary(original);
  await document.transform(dedup(), prune(), weld(), textureCompress({ encoder: sharp, resize: [TEXTURE_EDGE, TEXTURE_EDGE], quality: 82 }));
  const scene = document.getRoot().getDefaultScene() ?? document.getRoot().listScenes()[0];
  const bounds = scene === undefined ? { min: [0, 0, 0], max: [0, 0, 0] } : getBounds(scene);
  const glb = await io.writeBinary(document);
  return {
    glb,
    bytes: glb.byteLength,
    extentM: { x: bounds.max[0]! - bounds.min[0]!, y: bounds.max[1]! - bounds.min[1]!, z: bounds.max[2]! - bounds.min[2]! },
  };
}

/** The storage key of a compressed scan: one file per product, named by its ABO item. */
export const modelKey = (sourceId: string) => `catalog/abo-3d/${sourceId.toLowerCase().replace(/[^a-z0-9]/g, "")}.glb`;
