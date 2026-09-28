/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Tests for making a 3D scan light: textures shrink, the size of the piece does not change.
 */

import { Document, NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { compressModel, modelKey, TEXTURE_EDGE } from "@/lib/catalog/model-compress";

/** A box 0.8 × 0.75 × 0.4 m with one large textured material — like an ABO scan, much smaller. */
async function scanLikeGlb(textureEdge: number): Promise<Uint8Array> {
  const document = new Document();
  const buffer = document.createBuffer();
  const [x, y, z] = [0.8, 0.75, 0.4];
  const corners = [
    [0, 0, 0], [x, 0, 0], [x, y, 0], [0, y, 0],
    [0, 0, z], [x, 0, z], [x, y, z], [0, y, z],
  ].flat();
  const position = document.createAccessor().setType("VEC3").setArray(new Float32Array(corners)).setBuffer(buffer);
  const uv = document.createAccessor().setType("VEC2").setArray(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1])).setBuffer(buffer);
  const indices = document
    .createAccessor()
    .setType("SCALAR")
    .setArray(new Uint16Array([0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6, 0, 4, 5, 0, 5, 1, 3, 2, 6, 3, 6, 7, 0, 3, 7, 0, 7, 4, 1, 5, 6, 1, 6, 2]))
    .setBuffer(buffer);
  // A gradient, not one flat colour: prune() rightly turns a single-colour texture into a plain colour.
  const pixels = new Uint8Array(textureEdge * textureEdge * 3);
  for (let row = 0; row < textureEdge; row += 1) {
    for (let column = 0; column < textureEdge; column += 1) {
      const at = (row * textureEdge + column) * 3;
      pixels.set([(column * 255) / textureEdge, (row * 255) / textureEdge, 70], at);
    }
  }
  const image = await sharp(pixels, { raw: { width: textureEdge, height: textureEdge, channels: 3 } }).jpeg({ quality: 95 }).toBuffer();
  const texture = document.createTexture("wood").setImage(new Uint8Array(image)).setMimeType("image/jpeg");
  const material = document.createMaterial("wood").setBaseColorTexture(texture);
  const primitive = document.createPrimitive().setAttribute("POSITION", position).setAttribute("TEXCOORD_0", uv).setIndices(indices).setMaterial(material);
  const mesh = document.createMesh("piece").addPrimitive(primitive);
  const node = document.createNode("piece").setMesh(mesh);
  document.createScene("scene").addChild(node);
  return new NodeIO().registerExtensions(ALL_EXTENSIONS).writeBinary(document);
}

async function textureSizes(glb: Uint8Array) {
  const document = await new NodeIO().registerExtensions(ALL_EXTENSIONS).readBinary(glb);
  return Promise.all(
    document
      .getRoot()
      .listTextures()
      .map(async (texture) => {
        const meta = await sharp(texture.getImage()!).metadata();
        return { width: meta.width, height: meta.height, mime: texture.getMimeType() };
      }),
  );
}

describe("compressModel", () => {
  it("shrinks a large texture to the edge limit and keeps its format", async () => {
    const original = await scanLikeGlb(2048);
    const model = await compressModel(original);
    expect(await textureSizes(model.glb)).toEqual([{ width: TEXTURE_EDGE, height: TEXTURE_EDGE, mime: "image/jpeg" }]);
    expect(model.bytes).toBe(model.glb.byteLength);
    expect(model.bytes).toBeLessThan(original.byteLength);
  });

  it("measures the piece in metres, unchanged by compression", async () => {
    const model = await compressModel(await scanLikeGlb(512));
    expect(model.extentM.x).toBeCloseTo(0.8, 5);
    expect(model.extentM.y).toBeCloseTo(0.75, 5);
    expect(model.extentM.z).toBeCloseTo(0.4, 5);
  });

  it("leaves a texture already under the limit at its size", async () => {
    const model = await compressModel(await scanLikeGlb(512));
    expect(await textureSizes(model.glb)).toEqual([{ width: 512, height: 512, mime: "image/jpeg" }]);
  });

  it("refuses a file that is not a glTF binary", async () => {
    await expect(compressModel(new TextEncoder().encode("not a model"))).rejects.toThrow();
  });
});

describe("modelKey", () => {
  it("names the stored file by the ABO item, lower case and safe", () => {
    expect(modelKey("B075QFCHM9")).toBe("catalog/abo-3d/b075qfchm9.glb");
    expect(modelKey("abo:B07-X/1")).toBe("catalog/abo-3d/abob07x1.glb");
  });
});
