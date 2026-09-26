/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Unit tests for comfort settings: the cookie, partial updates, the attributes, and the script that applies them before paint.
 */

import { runInNewContext } from "node:vm";

import { describe, expect, it } from "vitest";

import { COMFORT_KEYS, comfortAttributes, comfortPatchSchema, DEFAULT_COMFORT, parseComfort, patchComfort, prepaintScript, serializeComfort } from "@/lib/comfort/settings";

describe("comfort settings", () => {
  it("keeps only what differs from the default, in characters a cookie can carry", () => {
    expect(serializeComfort(DEFAULT_COMFORT)).toBe("");
    const chosen = { ...DEFAULT_COMFORT, text: "125", contrast: "more", motion: "reduce" } as const;
    const cookie = serializeComfort(chosen);
    expect(cookie).toBe("text_125.contrast_more.motion_reduce");
    expect(cookie).toMatch(/^[\w.]*$/);
    expect(parseComfort(cookie)).toEqual(chosen);
  });

  it("ignores what it does not recognise instead of failing", () => {
    expect(parseComfort("text_999.colour_red.guide_on.__proto___x.junk")).toEqual({ ...DEFAULT_COMFORT, guide: "on" });
    expect(parseComfort(undefined)).toEqual(DEFAULT_COMFORT);
    expect(parseComfort("x".repeat(10_000))).toEqual(DEFAULT_COMFORT);
  });

  it("applies a partial update from a form or the Concierge, keeping only known values", () => {
    const next = patchComfort(DEFAULT_COMFORT, { text: "150", motion: "sideways", links: "underline", unknown: "on", guide: 1 });
    expect(next).toEqual({ ...DEFAULT_COMFORT, text: "150", links: "underline" });
  });

  it("marks <html> with every setting away from its default, and removes the rest", () => {
    const attributes = comfortAttributes({ ...DEFAULT_COMFORT, font: "readable" });
    expect(attributes["data-font"]).toBe("readable");
    expect(attributes["data-text"]).toBeNull();
    expect(Object.keys(attributes)).toHaveLength(COMFORT_KEYS.length);
  });
});

describe("the script that applies them before the first paint", () => {
  const run = (cookie: string) => {
    const set: Record<string, string> = {};
    runInNewContext(prepaintScript(), { document: { cookie, documentElement: { setAttribute: (name: string, value: string) => (set[name] = value) } } });
    return set;
  };

  it("sets the attributes the cookie asks for", () => {
    expect(run(`other=1; vt_comfort=text_125.spacing_wide; theme=x`)).toEqual({ "data-text": "125", "data-spacing": "wide" });
  });

  it("never sets a default, an unknown key or a value outside the lists", () => {
    expect(run("vt_comfort=text_100.onload_alert.text_1e3.motion_reduce")).toEqual({ "data-motion": "reduce" });
    expect(run("")).toEqual({});
    // A broken document does not stop the page: the script swallows its own errors.
    expect(() => runInNewContext(prepaintScript(), { document: null })).not.toThrow();
  });
});

describe("the schema the Concierge's tool and commands use", () => {
  it("names every setting, and refuses an empty or unknown change", () => {
    expect(Object.keys(comfortPatchSchema.shape).sort()).toEqual([...COMFORT_KEYS].sort());
    expect(comfortPatchSchema.safeParse({ text: "125" }).success).toBe(true);
    expect(comfortPatchSchema.safeParse({}).success).toBe(false);
    expect(comfortPatchSchema.safeParse({ text: "999" }).success).toBe(false);
    expect(comfortPatchSchema.safeParse({ colour: "red" }).success).toBe(false);
  });
});
