/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Tests for saving a room to the shopper's list.
 */

import { describe, expect, it } from "vitest";

import { MAX_ROOMS, withRoom } from "@/lib/prefs/rooms";

const living = { name: "Living room", wallCm: 240 };
const study = { name: "Study", wallCm: 120 };

describe("withRoom", () => {
  it("adds a new room at the end", () => {
    expect(withRoom([living], study)).toEqual([living, study]);
  });

  it("replaces a room of the same name where it stands, ignoring case", () => {
    expect(withRoom([living, study], { name: "living ROOM ", wallCm: 260, depthCm: 400 })).toEqual([{ name: "living ROOM ", wallCm: 260, depthCm: 400 }, study]);
  });

  it("refuses a sixth room, but still corrects one of the five", () => {
    const full = Array.from({ length: MAX_ROOMS }, (_, index) => ({ name: `Room ${index + 1}`, wallCm: 200 }));
    expect(withRoom(full, study)).toBeNull();
    expect(withRoom(full, { name: "Room 3", wallCm: 310 })?.[2]).toEqual({ name: "Room 3", wallCm: 310 });
  });
});
