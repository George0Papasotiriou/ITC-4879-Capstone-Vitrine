/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Test runs only: one specimen piece gets a 3D model, so the end-to-end tests can turn a scan in the room planner.
 */

/**
 * docs/adr/052. The throwaway test database holds the 25 specimen products,
 * none of which has an ABO scan, and its storage is empty, so nothing in an
 * end-to-end run would ever be drawn in 3D. scripts/local.mjs runs this for
 * `--ephemeral` starts only: the Angela coffee table, which no other test
 * uses, is given a model made by the shop's own GLB writer from its listed
 * measurements (src/lib/catalog/glb.ts, the shape the AR view uses), stored
 * and recorded exactly as the catalogue-models job stores a real scan. So the
 * storage check, the loading, the drawing and the turning are all the real
 * ones; only the model's shape is simpler than a scan.
 */

import { uuidv7 } from "uuidv7";

import { glbFromParts } from "@/lib/catalog/glb";
import { modelKey } from "@/lib/catalog/model-compress";
import { shapeColour, shapeFor } from "@/lib/catalog/shape";
import { sql } from "@/lib/db/client";
import { storage } from "@/lib/storage";

const E2E_SCANNED_SLUG = "angela-modern-turned-leg-wood-shelf-storage-coffee-b07dbft2yg";

const [piece] = await sql<{ id: string; source_id: string; kind: string; dims_cm: { w: number; d: number; h: number } | null; colors: string[] }[]>`
  SELECT id, source_id, kind, dims_cm, colors FROM products WHERE slug = ${E2E_SCANNED_SLUG}
`;
if (piece === undefined || piece.dims_cm === null) {
  console.log("[e2e-scan] the specimen piece is not in this catalogue; nothing to do");
} else {
  const model = glbFromParts(shapeFor(piece.kind, piece.dims_cm, shapeColour(piece.colors)), { name: "Test model" });
  const key = modelKey(piece.source_id);
  await (await storage()).putObject({ key, body: model, contentType: "model/gltf-binary" });
  await sql`
    INSERT INTO product_media (id, product_id, kind, src, bytes, alt_en, position)
    VALUES (${uuidv7()}, ${piece.id}, 'model', ${`/media/${key}`}, ${model.byteLength}, 'A 3D model of the piece', 0)
    ON CONFLICT DO NOTHING
  `;
  console.log(`[e2e-scan] ${E2E_SCANNED_SLUG} has a 3D model (${model.byteLength} bytes)`);
}
await sql.end();
