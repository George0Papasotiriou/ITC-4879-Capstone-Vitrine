/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Unit tests for fitting an AI mesh: the right way up and facing front, at the listed size.
 */

import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { getBounds } from "@gltf-transform/functions";
import { describe, expect, it } from "vitest";

import { makeModel, makeParts } from "@/lib/catalog/model";
import { bestOrientation, fitAiModel, meshPoints, MIN_FIT, ORIENTATIONS, type Rotation } from "@/lib/catalog/model/ai-fit";
import type { PieceFacts } from "@/lib/catalog/model/words";

const chair: PieceFacts = { slug: "wingback", kind: "CHAIR", title: "Button-Tufted Wingback Accent Chair", attributes: {}, materials: ["fabric", "wood"], colors: ["blue"], dims: { w: 80, d: 75, h: 105 } };

const transpose = (m: Rotation): Rotation => [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];
const apply = (m: Rotation, [x, y, z]: [number, number, number]): [number, number, number] => [m[0] * x + m[1] * y + m[2] * z, m[3] * x + m[4] * y + m[5] * z, m[6] * x + m[7] * y + m[8] * z];

describe("ORIENTATIONS", () => {
  it("are the 24 turns of a cube, all different, none a mirror", () => {
    expect(ORIENTATIONS).toHaveLength(24);
    expect(new Set(ORIENTATIONS.map((m) => m.join(","))).size).toBe(24);
  });
});

describe("bestOrientation", () => {
  const reference = meshPoints(makeParts(chair).parts.map((part) => part.mesh));

  it.each([3, 7, 13, 20])("finds the turn that undoes a mesh delivered on its side (orientation %i)", (k) => {
    // The "AI" mesh: the chair turned by an unknown orientation; the fit must find its inverse.
    const turned = reference.map((p) => apply(transpose(ORIENTATIONS[k]!), p));
    const best = bestOrientation(turned, reference);
    expect(best.rotation.join(",")).toBe(ORIENTATIONS[k]!.join(","));
    expect(best.fit).toBeGreaterThan(0.95);
  });

  it("tells a chair from a table: a different piece fits poorly", () => {
    const table = meshPoints(makeParts({ ...chair, slug: "t", kind: "TABLE", title: "Round Pedestal Dining Table", dims: { w: 110, d: 110, h: 75 } }).parts.map((part) => part.mesh));
    expect(bestOrientation(table, reference).fit).toBeLessThan(0.8);
  });
});

describe("fitAiModel", () => {
  it("returns a valid model at the listed size, standing on the floor, from one delivered sideways and ten times too big", async () => {
    // Simulate an AI delivery: the made chair, wrapped in a node that lays it on its back and scales it up.
    const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
    const document = await io.readBinary(await makeModel(chair));
    const scene = document.getRoot().getDefaultScene()!;
    const wrapper = document.createNode("delivery").setScale([10, 10, 10]).setRotation([Math.SQRT1_2, 0, 0, Math.SQRT1_2]);
    for (const child of scene.listChildren()) {
      scene.removeChild(child);
      wrapper.addChild(child);
    }
    scene.addChild(wrapper);
    const delivered = await io.writeBinary(document);

    const fitted = await fitAiModel(delivered, makeParts(chair).parts.map((part) => part.mesh), { w: 0.8, d: 0.75, h: 1.05 });
    expect(fitted.fit).toBeGreaterThan(Math.max(MIN_FIT, 0.9));
    const back = await io.readBinary(fitted.glb);
    const bounds = getBounds(back.getRoot().getDefaultScene()!);
    expect(bounds.max[0] - bounds.min[0]).toBeCloseTo(0.8, 2);
    expect(bounds.max[1] - bounds.min[1]).toBeCloseTo(1.05, 2);
    expect(bounds.max[2] - bounds.min[2]).toBeCloseTo(0.75, 2);
    expect(bounds.min[1]).toBeCloseTo(0, 2);
  }, 60_000);
});
