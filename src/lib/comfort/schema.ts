/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * The comfort settings' schema, for boundaries that validate a change (the Concierge's tool and page commands).
 */

import { z } from "zod";

import { COMFORT_OPTIONS, type ComfortKey } from "@/lib/comfort/settings";

/**
 * Kept apart from settings.ts, which every page loads to apply the settings
 * before first paint: the schema library is for the boundaries that check a
 * change, and has no business in every page's download (docs/adr/034).
 */

/** A partial update, validated: at least one known setting, each with a value from its list. */
const option = <K extends ComfortKey>(key: K) => z.enum(COMFORT_OPTIONS[key]).optional();

export const comfortPatchSchema = z
  .object({
    text: option("text"),
    spacing: option("spacing"),
    contrast: option("contrast"),
    font: option("font"),
    motion: option("motion"),
    links: option("links"),
    targets: option("targets"),
    guide: option("guide"),
    shortcuts: option("shortcuts"),
  })
  .strict()
  .refine((patch) => Object.values(patch).some((value) => value !== undefined), "Name at least one setting to change.");
