/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Tests for attaching photographs to the model's messages.
 */

import type { ModelMessage } from "ai";
import { describe, expect, it } from "vitest";

import { attachPhotos, MAX_PHOTOS_PER_TURN, photoIdOf } from "@/lib/ai/surfaces/photos";

const ROOM = "0199a000-0000-7000-8000-000000000001";
const SOFA = "0199a000-0000-7000-8000-000000000002";
const OLD = "0199a000-0000-7000-8000-000000000003";
const bytes = new Uint8Array([1, 2, 3]);

const user = (text: string): ModelMessage => ({ role: "user", content: [{ type: "text", text }] });
const assistant = (text: string): ModelMessage => ({ role: "assistant", content: [{ type: "text", text }] });

describe("photoIdOf", () => {
  it("reads a well-formed id from the metadata and nothing else", () => {
    expect(photoIdOf({ metadata: { photo: { id: ROOM } } })).toBe(ROOM);
    expect(photoIdOf({ metadata: { photo: { id: "../../etc/passwd" } } })).toBeNull();
    expect(photoIdOf({ metadata: undefined })).toBeNull();
    expect(photoIdOf({ metadata: { photo: { id: 42 } } })).toBeNull();
  });
});

describe("attachPhotos", () => {
  it("adds the picture to the user message it came with, and leaves the others alone", async () => {
    const model = [user("hello"), assistant("hi"), user("find a table like this")];
    const ui = [{ role: "user" as const, metadata: undefined }, { role: "assistant" as const, metadata: undefined }, { role: "user" as const, metadata: { photo: { id: ROOM } } }];
    const out = await attachPhotos(model, ui, async (id) => (id === ROOM ? { bytes, mediaType: "image/webp" } : null));
    expect(out[0]).toEqual(model[0]);
    expect(out[1]).toEqual(model[1]);
    const parts = out[2]!.content as { type: string; mediaType?: string }[];
    expect(parts.map((part) => part.type)).toEqual(["text", "text", "file"]);
    expect(parts[2]!.mediaType).toBe("image/webp");
  });

  it("sends only the newest photographs and names the older ones in words", async () => {
    const ui = [OLD, ROOM, SOFA].map((id) => ({ role: "user" as const, metadata: { photo: { id } } }));
    const model = [user("a"), user("b"), user("c")];
    const loaded: string[] = [];
    const out = await attachPhotos(model, ui, async (id) => {
      loaded.push(id);
      return { bytes, mediaType: "image/webp" };
    });
    expect(loaded.sort()).toEqual([ROOM, SOFA].sort());
    expect(loaded).toHaveLength(MAX_PHOTOS_PER_TURN);
    const first = out[0]!.content as { type: string; text?: string }[];
    expect(first.some((part) => part.type === "file")).toBe(false);
    expect(first.at(-1)!.text).toMatch(/earlier in the conversation/);
  });

  it("says so when a photograph is gone or is not the shopper's, and never sends it", async () => {
    const out = await attachPhotos([user("this one")], [{ role: "user", metadata: { photo: { id: ROOM } } }], async () => null);
    const parts = out[0]!.content as { type: string; text?: string }[];
    expect(parts.some((part) => part.type === "file")).toBe(false);
    expect(parts.at(-1)!.text).toMatch(/no longer available/);
  });
});
