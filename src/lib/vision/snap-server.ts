/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Server side of search by photo: reading a stored photograph's palette, and searching the catalogue with it.
 */

import { runSearch } from "@/lib/catalog/server";
import { storage } from "@/lib/storage";
import { colorLabel } from "@/lib/search/vocabulary";
import { palette, pixelsFrom, searchableColours, withoutBackground, type PaletteEntry } from "@/lib/vision/palette";

/**
 * The photograph is read where it lives, in the shop's own storage: nothing is
 * sent anywhere (docs/adr/024). The colours it finds become a filter and a
 * query, so the answer comes from the same hybrid search a typed query uses.
 */

/** The palette of a stored photograph, or null when it cannot be read. */
export async function readPalette(storageKey: string): Promise<PaletteEntry[] | null> {
  const object = await (await storage()).getObject(storageKey);
  return object === null ? null : paletteOfImage(Buffer.from(object.body));
}

/**
 * The reading itself, on bytes: the same steps for a shopper's photograph and
 * for the evaluation that measures this against the catalogue's own colour
 * words (`pnpm evals:snap`).
 */
export async function paletteOfImage(bytes: Buffer): Promise<PaletteEntry[] | null> {
  const { default: sharp } = await import("sharp");
  try {
    // Small enough to be quick, large enough to keep the picture's colours.
    const small = await sharp(bytes).resize(200, 200, { fit: "inside" }).toBuffer({ resolveWithObject: true });

    // The middle of the picture, not its edges: a shopper photographs the thing
    // they mean, and a studio shot or a plain wall fills the border with a
    // colour that is not what they are asking about.
    const inset = 0.15;
    const width = Math.max(1, Math.round(small.info.width * (1 - inset * 2)));
    const height = Math.max(1, Math.round(small.info.height * (1 - inset * 2)));
    const { data, info } = await sharp(small.data)
      .extract({ left: Math.round(small.info.width * inset), top: Math.round(small.info.height * inset), width, height })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    // The plain ground of a studio shot is dropped before the colours are counted.
    const pixels = pixelsFrom(data, info.channels, 1);
    return palette(withoutBackground(pixels, info.width, info.height));
  } catch {
    return null;
  }
}

/**
 * What the shop has that looks like the photograph: its colours as filters,
 * their names as the query, so lexical matching helps where a product's copy
 * says "sand" and the palette says "beige".
 */
export async function snapSearch(seen: readonly PaletteEntry[], { category, locale = "en", limit = 12 }: { category?: string; locale?: "en" | "el"; limit?: number } = {}): Promise<string[]> {
  const colors = searchableColours(seen);
  if (colors.length === 0) return [];
  const query = colors.map((color) => colorLabel(color, locale)).join(" ");
  const result = await runSearch(query, {
    limit,
    filters: { colors, ...(category === undefined ? {} : { categories: [category] }) },
  });
  // A photograph's colours can be rare in the catalogue; without a match the
  // words alone still find something worth showing.
  if (result.ids.length > 0) return result.ids;
  return (await runSearch(query, { limit })).ids;
}
