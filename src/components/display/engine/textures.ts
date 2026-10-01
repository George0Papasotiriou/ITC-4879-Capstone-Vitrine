/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * The shop window's surfaces, drawn by code: limewash plaster and a trowelled micro-cement floor.
 */

import { CanvasTexture, LinearSRGBColorSpace, RepeatWrapping, SRGBColorSpace } from "three";

/**
 * docs/adr/048. No image files: the walls and the floor are drawn when the
 * window opens, from seeded noise, the way the shop already draws its capsule
 * photographs and writes its own 3D files. The same seed always draws the same
 * wall.
 *
 * VALUE NOISE. Random values on a lattice, blended smoothly between lattice
 * points (a quintic fade, so there are no visible creases). The lattice wraps
 * at its period, which makes the texture tile without a seam. Fractal noise
 * adds octaves — each twice the frequency and half the amplitude of the last —
 * which is how plaster looks: broad clouds of tone with finer mottling inside.
 */

/** mulberry32: a small, fast, seeded generator. */
function generator(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function lattice(period: number, seed: number): Float32Array {
  const random = generator(seed);
  return Float32Array.from({ length: period * period }, () => random());
}

const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);

/** Tileable value noise at (x, y) in lattice units, wrapping at `period`. */
function noise(values: Float32Array, period: number, x: number, y: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = fade(x - x0);
  const fy = fade(y - y0);
  const at = (i: number, j: number) => values[(((j % period) + period) % period) * period + (((i % period) + period) % period)]!;
  const top = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * fx;
  const bottom = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * fx;
  return top + (bottom - top) * fy;
}

/** Fractal noise in [0, 1]: `octaves` layers, each double the frequency and half the weight. */
function fractal(layers: { values: Float32Array; period: number }[], u: number, v: number, stretch = 1): number {
  let sum = 0;
  let weight = 0;
  let amplitude = 1;
  layers.forEach(({ values, period }) => {
    sum += amplitude * noise(values, period, u * period * stretch, v * period);
    weight += amplitude;
    amplitude *= 0.5;
  });
  return sum / weight;
}

function canvas(size: number): { element: HTMLCanvasElement; context: CanvasRenderingContext2D; image: ImageData } {
  const element = document.createElement("canvas");
  element.width = size;
  element.height = size;
  const context = element.getContext("2d")!;
  return { element, context, image: context.createImageData(size, size) };
}

function texture(element: HTMLCanvasElement, colour: boolean): CanvasTexture {
  const result = new CanvasTexture(element);
  result.wrapS = RepeatWrapping;
  result.wrapT = RepeatWrapping;
  result.colorSpace = colour ? SRGBColorSpace : LinearSRGBColorSpace;
  result.anisotropy = 4;
  result.needsUpdate = true;
  return result;
}

export type Surface = { map: CanvasTexture; roughness: CanvasTexture };

/**
 * Limewash: soft clouds of tone (3 broad octaves) and a faint speckle, light
 * around 0.93 so the material's colour — the shop's plinth token — still sets
 * the wall's colour. Roughness follows the tone a little: limewash is chalky,
 * slightly glossier where it was brushed thinner.
 */
export function plaster(size = 512, seed = 11): Surface {
  const octaves = [4, 8, 16, 32].map((period, index) => ({ values: lattice(period, seed + index), period }));
  const speckle = generator(seed * 7);
  const tone = canvas(size);
  const rough = canvas(size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const n = fractal(octaves, x / size, y / size);
      const grain = (speckle() - 0.5) * 0.018;
      const light = 0.905 + n * 0.09 + grain;
      const index = (y * size + x) * 4;
      const value = Math.round(Math.min(1, light) * 255);
      tone.image.data.set([value, value, value, 255], index);
      const r = Math.round((0.84 + (1 - n) * 0.12) * 255);
      rough.image.data.set([r, r, r, 255], index);
    }
  }
  tone.context.putImageData(tone.image, 0, 0);
  rough.context.putImageData(rough.image, 0, 0);
  return { map: texture(tone.element, true), roughness: texture(rough.element, false) };
}

/**
 * Micro-cement: like plaster but stretched along one direction (the trowel's
 * sweep), with a slightly lower roughness so the window's light glances off it.
 */
export function cement(size = 512, seed = 23): Surface {
  const octaves = [4, 8, 16, 32, 64].map((period, index) => ({ values: lattice(period, seed + index), period }));
  const sweep = [8, 16].map((period, index) => ({ values: lattice(period, seed + 40 + index), period }));
  const speckle = generator(seed * 13);
  const tone = canvas(size);
  const rough = canvas(size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const u = x / size;
      const v = y / size;
      const cloud = fractal(octaves, u, v);
      const trowel = fractal(sweep, u, v, 0.25);
      const grain = (speckle() - 0.5) * 0.025;
      const light = 0.86 + cloud * 0.1 + (trowel - 0.5) * 0.05 + grain;
      const index = (y * size + x) * 4;
      const value = Math.round(Math.max(0, Math.min(1, light)) * 255);
      tone.image.data.set([value, value, value, 255], index);
      const r = Math.round((0.6 + trowel * 0.18 + cloud * 0.08) * 255);
      rough.image.data.set([r, r, r, 255], index);
    }
  }
  tone.context.putImageData(tone.image, 0, 0);
  rough.context.putImageData(rough.image, 0, 0);
  return { map: texture(tone.element, true), roughness: texture(rough.element, false) };
}

/** A soft round dot for the dust in the sunbeam. */
export function mote(size = 64): CanvasTexture {
  const { element, context } = canvas(size);
  const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(0.35, "rgba(255,255,255,0.45)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);
  const result = new CanvasTexture(element);
  result.colorSpace = SRGBColorSpace;
  return result;
}
