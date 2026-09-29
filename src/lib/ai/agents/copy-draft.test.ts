/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Tests for staff copy drafts: figures kept or flagged, the shape checked, and the product's words fenced as data.
 */

import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";

import { draftCopy, figuresIn, missingFigures } from "@/lib/ai/agents/copy-draft";
import { FENCE_OPEN } from "@/lib/ai/guardrails/untrusted";

const SOURCE = {
  title: "Oak coffee table, 120 cm",
  description: "Solid oak top, 120 x 60 x 45 cm, holds up to 25 kg. Oil finish, 1.5 cm thick.",
  highlights: ["Solid oak", "Assembly takes 15 minutes"],
};

function model(json: unknown, seen?: { prompt?: string }) {
  return new MockLanguageModelV4({
    doGenerate: async (options) => {
      if (seen !== undefined) seen.prompt = JSON.stringify(options.prompt);
      return {
        content: [{ type: "text", text: JSON.stringify(json) }],
        finishReason: { unified: "stop", raw: undefined },
        usage: { inputTokens: { total: 300, noCache: 300, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 120, text: 120, reasoning: 0 } },
        warnings: [],
      };
    },
  });
}

describe("figures", () => {
  it("reads numbers the same way whichever decimal mark a language uses", () => {
    expect(figuresIn("1.5 cm and 1,5 cm")).toEqual(["1.5"]);
    expect(figuresIn("1,250.75 and 1.250,75")).toEqual(["1250.75"]);
    expect(figuresIn("120 x 60 x 45 cm")).toEqual(["120", "60", "45"]);
  });

  it("names what a draft lost", () => {
    const draft = { title: "Δρύινο τραπεζάκι, 120 cm", description: "Μασίφ δρυς, 120 x 60 x 45 cm, αντέχει έως 25 kg. Πάχος 1,5 cm.", highlights: ["Μασίφ δρυς"] };
    expect(missingFigures(SOURCE, draft)).toEqual(["15"]);
  });
});

describe("draftCopy", () => {
  it("returns the model's draft in the checked shape, with its usage and the figures it lost", async () => {
    const seen: { prompt?: string } = {};
    const result = await draftCopy({
      model: model({ title: "Oak coffee table, 120 cm", description: "Solid oak, 120 x 60 x 45 cm; takes 25 kg. Oiled, 1.5 cm thick.", highlights: ["Solid oak", "Quick to assemble"] }, seen),
      modelId: "gemini-test",
      task: "tighten",
      source: SOURCE,
    });
    expect(result).toMatchObject({ model: "gemini-test", prompt: "copy-v1", missingFigures: ["15"], usage: { inputTokens: 300, outputTokens: 120 } });
    expect(result?.draft.highlights).toEqual(["Solid oak", "Quick to assemble"]);
    // The product's words reach the model fenced, as data.
    expect(seen.prompt).toContain(FENCE_OPEN.replace(/"/g, '\\"'));
  });

  it("gives nothing when the model's answer does not have the shape", async () => {
    await expect(draftCopy({ model: model({ title: "" }), modelId: "gemini-test", task: "greek", source: SOURCE })).rejects.toThrow();
  });
});
