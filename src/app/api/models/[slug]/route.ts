/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * The 3D model of a product, built from its dimensions when it is asked for.
 */

import { getProduct } from "@/lib/catalog/server";
import { glbFromParts } from "@/lib/catalog/glb";
import { hasShape, shapeColour, shapeFor } from "@/lib/catalog/shape";

/**
 * Made, not stored (docs/adr/025). The model is a few dozen boxes derived from
 * the product's own measurements, so keeping files in a bucket would only add
 * something else to invalidate when a merchandiser corrects a dimension. It is
 * small — a few kilobytes — and cached by the browser and any CDN in front.
 */

export const runtime = "nodejs";

export async function GET(_request: Request, context: RouteContext<"/api/models/[slug]">): Promise<Response> {
  const { slug } = await context.params;
  const product = await getProduct(slug.replace(/\.glb$/, ""), "en");
  if (product === null || !hasShape(product.kind, product.dimsCm)) {
    return Response.json({ error: "no_model", message: "This piece has no 3D shape." }, { status: 404 });
  }

  const model = glbFromParts(shapeFor(product.kind, product.dimsCm!, shapeColour(product.colors)), { name: product.title });
  return new Response(model as BodyInit, {
    headers: {
      "content-type": "model/gltf-binary",
      "content-length": String(model.byteLength),
      // The shape follows the catalogue, so it changes only when a dimension does.
      "cache-control": "public, max-age=3600, stale-while-revalidate=86400",
      "content-disposition": `inline; filename="${slug.replace(/[^a-z0-9-]/gi, "")}.glb"`,
    },
  });
}
