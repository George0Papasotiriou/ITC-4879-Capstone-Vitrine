/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Writes a made model as a glTF binary (.glb): meshes merged per material, textures embedded, Khronos material extensions.
 */

import { Document, NodeIO, type Material, type Texture, type TextureInfo } from "@gltf-transform/core";
import {
  KHRMaterialsClearcoat,
  KHRMaterialsEmissiveStrength,
  KHRMaterialsIOR,
  KHRMaterialsSheen,
  KHRMaterialsTransmission,
  KHRMaterialsVolume,
  KHRMeshQuantization,
  KHRTextureTransform,
} from "@gltf-transform/extensions";
import { quantize, weld } from "@gltf-transform/functions";

import type { MaterialSpec } from "@/lib/catalog/model/materials";
import { Mesh } from "@/lib/catalog/model/mesh";
import { TEXTURE_TILE_M, textureSet, type TextureSet } from "@/lib/catalog/model/textures";
import type { Rgb } from "@/lib/vision/palette";

/**
 * docs/adr/058. The file is written with glTF-Transform (already the shop's
 * tool for compressing scans, docs/adr/035) rather than by hand as the first
 * stand-ins were (docs/adr/025): with textures, samplers and five material
 * extensions, the hand-written writer would grow into a worse copy of it.
 *
 * Parts that share a material are merged into one mesh, so a sofa is a
 * handful of draw calls however many cushions and buttons it has. Texture
 * coordinates arrive in metres and are divided by each texture's tile size
 * here, so the drawn textures repeat at their real scale.
 */

export type ModelPart = { mesh: Mesh; material: MaterialSpec };

export type ModelInput = {
  name: string;
  parts: readonly ModelPart[];
  /** Photographs a material refers to by `photo` key (a rug's own picture), as JPEG. */
  photos?: Readonly<Record<string, { jpeg: Uint8Array; repeat: [number, number]; swatch?: [number, number] }>>;
  /** Written into the file's extras: which generator made it, from what. */
  extras?: Record<string, unknown>;
};

/** sRGB 0–255 to linear 0–1, as glTF's colour factors are. */
export function linearChannel(channel: number): number {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

const linearRgb = ({ r, g, b }: Rgb): [number, number, number] => [linearChannel(r), linearChannel(g), linearChannel(b)];

/** Merges meshes with the same material, keeping their order. */
export function mergeByMaterial(parts: readonly ModelPart[]): { material: MaterialSpec; mesh: Mesh }[] {
  const groups = new Map<string, { material: MaterialSpec; mesh: Mesh }>();
  for (const part of parts) {
    if (part.mesh.triangleCount === 0) continue;
    const group = groups.get(part.material.key);
    if (group === undefined) groups.set(part.material.key, { material: part.material, mesh: part.mesh.clone() });
    else group.mesh.append(part.mesh);
  }
  return [...groups.values()];
}

export async function writeModel({ name, parts, photos = {}, extras }: ModelInput): Promise<Uint8Array> {
  const groups = mergeByMaterial(parts);
  if (groups.length === 0) throw new RangeError("A model needs at least one part");

  const document = new Document();
  document.getRoot().getAsset().generator = "Vitrine made models (student project)";
  const buffer = document.createBuffer();
  const sheenExtension = document.createExtension(KHRMaterialsSheen);
  const clearcoatExtension = document.createExtension(KHRMaterialsClearcoat);
  const transmissionExtension = document.createExtension(KHRMaterialsTransmission);
  const iorExtension = document.createExtension(KHRMaterialsIOR);
  const volumeExtension = document.createExtension(KHRMaterialsVolume);
  const emissiveExtension = document.createExtension(KHRMaterialsEmissiveStrength);
  const transformExtension = document.createExtension(KHRTextureTransform);
  // An extension nothing uses is still declared by glTF-Transform; unused ones are dropped before writing.
  const used = new Set<string>();

  // Each drawn texture set and photograph is embedded once, however many materials use it.
  const sets = new Map<string, TextureSet>();
  for (const { material } of groups) if (material.texture !== null && !sets.has(material.texture)) sets.set(material.texture, await textureSet(material.texture));
  const textures = new Map<string, Texture>();
  const texture = (key: string, image: Uint8Array) => {
    let found = textures.get(key);
    if (found === undefined) {
      found = document.createTexture(key).setImage(image).setMimeType("image/jpeg");
      textures.set(key, found);
    }
    return found;
  };
  const sampled = (info: TextureInfo | null) => {
    // Trilinear filtering: the drawn detail stays smooth as it recedes, rather than shimmering.
    info?.setMinFilter(9987).setMagFilter(9729);
  };

  const mesh = document.createMesh(name);
  for (const { material: spec, mesh: geometry } of groups) {
    const set = spec.texture === null ? null : sets.get(spec.texture)!;
    const photo = spec.photo === undefined ? undefined : photos[spec.photo];
    const material = document.createMaterial(spec.key);
    // The drawn albedo darkens the colour by its own average; dividing it out keeps the colour as photographed.
    const base = linearRgb(spec.colour);
    const lift = set !== null && photo === undefined ? 1 / set.meanLinear : 1;
    material.setBaseColorFactor([Math.min(1, base[0] * lift), Math.min(1, base[1] * lift), Math.min(1, base[2] * lift), spec.opacity ?? 1]);
    material.setRoughnessFactor(Math.min(1, spec.roughness));
    material.setMetallicFactor(spec.metallic);
    if (spec.opacity !== undefined && spec.opacity < 1) material.setAlphaMode("BLEND");
    material.setDoubleSided(spec.doubleSided === true);

    if (set !== null) {
      if (photo !== undefined) {
        material.setBaseColorTexture(texture(`photo-${spec.photo}`, photo.jpeg));
        if (photo.swatch !== undefined) {
          // A swatch, not the whole rug: repeated across it, mirrored at every edge so no seam shows.
          material.getBaseColorTextureInfo()?.setWrapS(33648).setWrapT(33648);
          material.getBaseColorTextureInfo()?.setExtension("KHR_texture_transform", transformExtension.createTransform().setScale(photo.swatch));
          used.add("KHR_texture_transform");
        }
      } else {
        material.setBaseColorTexture(texture(`${set.kind}-albedo`, set.albedo));
      }
      material.setNormalTexture(texture(`${set.kind}-normal`, set.normal)).setNormalScale(spec.normalScale ?? 1);
      material.setMetallicRoughnessTexture(texture(`${set.kind}-orm`, set.orm));
      material.setOcclusionTexture(texture(`${set.kind}-orm`, set.orm)).setOcclusionStrength(0.8);
      for (const info of [material.getBaseColorTextureInfo(), material.getNormalTextureInfo(), material.getMetallicRoughnessTextureInfo(), material.getOcclusionTextureInfo()]) sampled(info);
      if (photo !== undefined) {
        // The photograph spans the rug once; the drawn pile repeats across it at its real size.
        for (const info of [material.getNormalTextureInfo(), material.getMetallicRoughnessTextureInfo(), material.getOcclusionTextureInfo()]) {
          info?.setExtension("KHR_texture_transform", transformExtension.createTransform().setScale(photo.repeat));
        }
        used.add("KHR_texture_transform");
      }
    }

    if (spec.sheen !== undefined) {
      material.setExtension("KHR_materials_sheen", sheenExtension.createSheen().setSheenColorFactor(linearRgb(spec.sheen.colour)).setSheenRoughnessFactor(spec.sheen.roughness));
      used.add("KHR_materials_sheen");
    }
    if (spec.clearcoat !== undefined) {
      material.setExtension("KHR_materials_clearcoat", clearcoatExtension.createClearcoat().setClearcoatFactor(spec.clearcoat.factor).setClearcoatRoughnessFactor(spec.clearcoat.roughness));
      used.add("KHR_materials_clearcoat");
    }
    if (spec.transmission !== undefined) {
      material.setExtension("KHR_materials_transmission", transmissionExtension.createTransmission().setTransmissionFactor(spec.transmission.factor));
      material.setExtension("KHR_materials_ior", iorExtension.createIOR().setIOR(spec.transmission.ior));
      material.setExtension("KHR_materials_volume", volumeExtension.createVolume().setThicknessFactor(spec.transmission.thickness).setAttenuationColor(linearRgb(spec.colour)).setAttenuationDistance(0.5));
      used.add("KHR_materials_transmission").add("KHR_materials_ior").add("KHR_materials_volume");
    }
    if (spec.emissive !== undefined) {
      // Up to 1 the strength scales the factor itself; beyond it, glTF needs the emissive-strength extension.
      const [r, g, b] = linearRgb(spec.emissive.colour);
      const s = Math.min(1, spec.emissive.strength);
      material.setEmissiveFactor([r * s, g * s, b * s]);
      if (spec.emissive.strength > 1) {
        material.setExtension("KHR_materials_emissive_strength", emissiveExtension.createEmissiveStrength().setEmissiveStrength(spec.emissive.strength));
        used.add("KHR_materials_emissive_strength");
      }
    }

    mesh.addPrimitive(primitive(document, buffer, geometry, photo !== undefined ? 1 : set === null ? null : TEXTURE_TILE_M[set.kind], material));
  }

  for (const extension of document.getRoot().listExtensionsUsed()) if (!used.has(extension.extensionName)) extension.dispose();

  const node = document.createNode(name).setMesh(mesh);
  if (extras !== undefined) node.setExtras(extras);
  document.createScene(name).addChild(node);
  document.getRoot().setDefaultScene(document.getRoot().listScenes()[0]!);

  // Smaller files for phones: identical vertices merged, then positions, normals and tangents stored as
  // 16-bit integers (KHR_mesh_quantization, read by three.js, Scene Viewer and Quick Look's converter alike) —
  // a tenth of a millimetre on a two-metre sofa. Texture coordinates stay floats: they run past 1, as the
  // textures repeat at their real size.
  await document.transform(weld(), quantize({ pattern: /^(POSITION|NORMAL|TANGENT)$/, quantizePosition: 14, quantizeNormal: 10 }));

  const io = new NodeIO().registerExtensions([
    KHRMeshQuantization,
    KHRMaterialsSheen,
    KHRMaterialsClearcoat,
    KHRMaterialsTransmission,
    KHRMaterialsIOR,
    KHRMaterialsVolume,
    KHRMaterialsEmissiveStrength,
    KHRTextureTransform,
  ]);
  return io.writeBinary(document);
}

/**
 * One merged mesh as a glTF primitive: positions, normals and indices; and,
 * when the material is textured, texture coordinates (in tiles) and tangents,
 * so every viewer bends the light of a normal map the same way rather than
 * guessing a tangent space of its own.
 */
function primitive(document: Document, buffer: ReturnType<Document["createBuffer"]>, geometry: Mesh, tile: number | null, material: Material) {
  const indexArray = geometry.vertexCount > 65_535 ? new Uint32Array(geometry.indices) : new Uint16Array(geometry.indices);
  const made = document
    .createPrimitive()
    .setAttribute("POSITION", document.createAccessor().setType("VEC3").setArray(new Float32Array(geometry.positions)).setBuffer(buffer))
    .setAttribute("NORMAL", document.createAccessor().setType("VEC3").setArray(new Float32Array(geometry.normals)).setBuffer(buffer))
    .setIndices(document.createAccessor().setType("SCALAR").setArray(indexArray).setBuffer(buffer))
    .setMaterial(material);
  if (tile !== null) {
    const uvs = new Float32Array(geometry.uvs.length);
    for (let i = 0; i < uvs.length; i += 1) uvs[i] = geometry.uvs[i]! / tile;
    made.setAttribute("TEXCOORD_0", document.createAccessor().setType("VEC2").setArray(uvs).setBuffer(buffer));
    made.setAttribute("TANGENT", document.createAccessor().setType("VEC4").setArray(geometry.tangents()).setBuffer(buffer));
  }
  return made;
}
