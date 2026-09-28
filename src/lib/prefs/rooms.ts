/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * The shopper's saved rooms as a list: adding one, or replacing one of the same name.
 */

import type { Room } from "@/lib/prefs/preferences";

/** Five rooms: a home, not a portfolio. Kept here, free of the schema library, so pages can use it in the browser. */
export const MAX_ROOMS = 5;

/**
 * The list after saving `room` (docs/adr/034): a room of the same name
 * (ignoring case and spaces at the ends) is replaced where it stands, so
 * measuring the living room again corrects it rather than adding a second
 * one; a new name is added at the end. Null when the list is full.
 */
export function withRoom(rooms: readonly Room[], room: Room): Room[] | null {
  const key = room.name.trim().toLocaleLowerCase();
  const index = rooms.findIndex((existing) => existing.name.trim().toLocaleLowerCase() === key);
  if (index >= 0) return rooms.map((existing, position) => (position === index ? room : existing));
  if (rooms.length >= MAX_ROOMS) return null;
  return [...rooms, room];
}
