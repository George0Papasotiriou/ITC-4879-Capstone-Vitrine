/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * ABO turntable ("spin") and 3D model metadata: reading the index files, and choosing which frames to keep.
 */

/**
 * docs/adr/035. ABO photographs 8,222 products on a turntable, as 24 or 72
 * frames at equal angles (spins/metadata/spins.csv.gz), and has glTF models
 * of 7,953 (3dmodels/metadata/3dmodels.csv.gz, with each model's extent in
 * metres). These are the pure parts: reading the two index files, and taking
 * an even subset of frames so a full turn stays smooth at a quarter of the
 * download.
 */

export type SpinFrame = { spinId: string; azimuth: number; path: string; width: number; height: number };

/** spin_id,azimuth,image_id,height,width,path → frames grouped by spin, in turning order. */
export function parseSpinIndex(csv: string): Map<string, SpinFrame[]> {
  const spins = new Map<string, SpinFrame[]>();
  for (const line of csv.split("\n").slice(1)) {
    const [spinId, azimuth, , height, width, path] = line.trim().split(",");
    if (spinId === undefined || path === undefined || spinId === "") continue;
    const frames = spins.get(spinId) ?? [];
    frames.push({ spinId, azimuth: Number(azimuth), path, width: Number(width), height: Number(height) });
    spins.set(spinId, frames);
  }
  for (const frames of spins.values()) frames.sort((a, b) => a.azimuth - b.azimuth);
  return spins;
}

/**
 * `count` frames at equal steps round the turn, starting from the front
 * (azimuth 0). From 72 frames, 24 keeps every third (15° apart); a spin that
 * already has 24 or fewer keeps them all.
 */
export function pickFrames<T>(frames: readonly T[], count: number): T[] {
  if (frames.length <= count) return [...frames];
  const step = frames.length / count;
  return Array.from({ length: count }, (_, index) => frames[Math.round(index * step) % frames.length]!);
}

export type ModelEntry = { modelId: string; path: string; extentM: { x: number; y: number; z: number }; textures: number; faces: number };

/** 3dmodel_id,path,meshes,materials,textures,images,…,vertices,faces,extent_x,extent_y,extent_z → by model id. */
export function parseModelIndex(csv: string): Map<string, ModelEntry> {
  const lines = csv.split("\n");
  const header = (lines[0] ?? "").trim().split(",");
  const column = (name: string) => header.indexOf(name);
  const [id, path, textures, faces, x, y, z] = ["3dmodel_id", "path", "textures", "faces", "extent_x", "extent_y", "extent_z"].map(column);
  const models = new Map<string, ModelEntry>();
  for (const line of lines.slice(1)) {
    const cells = line.trim().split(",");
    const modelId = cells[id!];
    if (modelId === undefined || modelId === "") continue;
    models.set(modelId, {
      modelId,
      path: cells[path!]!,
      extentM: { x: Number(cells[x!]), y: Number(cells[y!]), z: Number(cells[z!]) },
      textures: Number(cells[textures!]),
      faces: Number(cells[faces!]),
    });
  }
  return models;
}

/**
 * Whether a model's size agrees with the listing's measurements: the model's
 * extent (glTF is Y-up, so height is y) against width × depth × height in
 * centimetres, within `tolerance` on each side, allowing width and depth to be
 * swapped (a listing does not say which way the piece faces the camera).
 */
export function extentMatches(extentM: { x: number; y: number; z: number }, dimsCm: { w: number; d: number; h: number } | null, tolerance = 0.25): boolean | null {
  if (dimsCm === null) return null;
  const close = (metres: number, cm: number) => Math.abs(metres * 100 - cm) <= tolerance * cm;
  const height = close(extentM.y, dimsCm.h);
  const straight = close(extentM.x, dimsCm.w) && close(extentM.z, dimsCm.d);
  const turned = close(extentM.x, dimsCm.d) && close(extentM.z, dimsCm.w);
  return height && (straight || turned);
}
