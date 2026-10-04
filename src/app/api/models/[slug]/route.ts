/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * The 3D model of a product: its scan when it has one, otherwise the model the shop makes of it.
 */

import { serverEnv } from "@/env";
import { getProduct } from "@/lib/catalog/server";
import { canMakeModel } from "@/lib/catalog/model";
import { madeModelFor, type ModelPiece } from "@/lib/catalog/model/serve";
import { loggerForRequest } from "@/lib/log";
import { storage } from "@/lib/storage";

/**
 * docs/adr/035, docs/adr/058. The best model the shop has wins: the piece's
 * own scan, then the model the shop makes from its measurements, words and
 * photograph. A made model is built the first time it is asked for and stored
 * (src/lib/catalog/model/serve.ts); this answer is then a redirect to the
 * stored file, as a scan's is, which Scene Viewer and model-viewer both follow.
 */

export const runtime = "nodejs";

export async function GET(request: Request, context: RouteContext<"/api/models/[slug]">): Promise<Response> {
  const { slug } = await context.params;
  const product = await getProduct(slug.replace(/\.glb$/, ""), "en");
  // The piece's own scan first, then a checked AI model of it, then the model the shop makes.
  const stored = product?.model ?? product?.aiModel ?? null;
  if (stored !== null) {
    return new Response(null, { status: 302, headers: { location: stored.src, "cache-control": "public, max-age=3600" } });
  }
  if (product === null || product.dimsCm === null || !canMakeModel(product.kind, product.dimsCm)) {
    return Response.json({ error: "no_model", message: "This piece has no 3D model." }, { status: 404 });
  }

  const studio = product.media.find((image) => image.studio !== false) ?? product.media[0] ?? null;
  const piece: ModelPiece = {
    slug: product.slug,
    kind: product.kind,
    title: product.title,
    attributes: product.attributes,
    materials: product.materials,
    colors: product.colors,
    dims: product.dimsCm,
    studio: studio?.src ?? null,
    images: product.media.map((image) => ({ src: image.src, width: image.width, height: image.height, studio: image.studio !== false })),
  };
  const files = await storage();
  const made = await madeModelFor(piece, {
    files,
    photo: async (src) => {
      const response = await fetch(new URL(src, serverEnv().APP_URL), { signal: AbortSignal.timeout(15_000) });
      return response.ok ? new Uint8Array(await response.arrayBuffer()) : null;
    },
  }).catch((error: unknown) => {
    loggerForRequest(request.headers).error({ err: error, slug }, "made model failed");
    return null;
  });
  if (made === null) return Response.json({ error: "model_failed", message: "The 3D model could not be made just now. Try again in a moment." }, { status: 503 });
  if (made.key !== null) {
    return new Response(null, { status: 302, headers: { location: `/media/${made.key}`, "cache-control": "public, max-age=3600" } });
  }
  // Built without its photograph (the network failed): served once, not stored, so the next request tries again.
  return new Response(made.glb as BodyInit, {
    headers: {
      "content-type": "model/gltf-binary",
      "content-length": String(made.glb.byteLength),
      "cache-control": "no-store",
      "content-disposition": `inline; filename="${slug.replace(/[^a-z0-9-]/gi, "")}.glb"`,
    },
  });
}
