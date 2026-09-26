/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * A signed-in shopper's preferences and comfort settings, kept on their account.
 */

import type postgres from "postgres";

import { parseComfort, serializeComfort } from "@/lib/comfort/settings";
import { EMPTY_PREFERENCES, preferencesSchema, type Preferences } from "@/lib/prefs/preferences";

/**
 * docs/adr/033. One row per person. The document is checked on the way in and
 * on the way out, so a row written by an older version, or edited by hand,
 * can never put something the shop does not understand in front of anyone:
 * what does not parse is read as nothing.
 */

type Sql = postgres.Sql;

const parse = (raw: unknown): Preferences => {
  const value = typeof raw === "string" ? (JSON.parse(raw) as unknown) : raw;
  const result = preferencesSchema.safeParse(value ?? {});
  return result.success ? result.data : EMPTY_PREFERENCES;
};

export function createPreferenceStore(sql: Sql) {
  async function forUser(userId: string): Promise<{ preferences: Preferences; comfort: string; updatedAt: Date | null }> {
    const [row] = await sql<{ data: unknown; comfort: string; updated_at: Date }[]>`
      SELECT data, comfort, updated_at FROM user_preferences WHERE user_id = ${userId}
    `;
    if (row === undefined) return { preferences: EMPTY_PREFERENCES, comfort: "", updatedAt: null };
    // The comfort string is re-read through its parser, so only known settings come back.
    return { preferences: parse(row.data), comfort: serializeComfort(parseComfort(row.comfort)), updatedAt: new Date(row.updated_at) };
  }

  async function save(userId: string, preferences: Preferences): Promise<Preferences> {
    const checked = preferencesSchema.parse(preferences);
    await sql`
      INSERT INTO user_preferences (user_id, data, updated_at) VALUES (${userId}, ${JSON.stringify(checked)}::text::jsonb, now())
      ON CONFLICT (user_id) DO UPDATE SET data = excluded.data, updated_at = now()
    `;
    return checked;
  }

  async function saveComfort(userId: string, comfort: string): Promise<string> {
    const clean = serializeComfort(parseComfort(comfort));
    await sql`
      INSERT INTO user_preferences (user_id, comfort, updated_at) VALUES (${userId}, ${clean}, now())
      ON CONFLICT (user_id) DO UPDATE SET comfort = excluded.comfort, updated_at = now()
    `;
    return clean;
  }

  /** Everything the account keeps about how the shop is shown to them, gone. */
  async function clear(userId: string): Promise<void> {
    await sql`DELETE FROM user_preferences WHERE user_id = ${userId}`;
  }

  return { forUser, save, saveComfort, clear };
}

export type PreferenceStore = ReturnType<typeof createPreferenceStore>;
