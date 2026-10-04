/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Catalogue media beyond photographs: ABO turntable spins for the 360° view.
 */

/**
 * docs/adr/035. `pnpm catalog spins [--dry-run] [--limit 300] [--frames 24] [--files all]`
 *
 * For the imported ABO products whose listing has a turntable sequence, keeps
 * `--frames` of its frames at equal angles, each re-encoded to an 800 px WebP
 * on white (the camera's metadata dropped with it), stored beside the
 * catalogue's photographs and recorded as `spin` media in turning order. A
 * product that already has its frames is skipped, so a rerun only adds.
 * --dry-run prints how many products, frames and megabytes, and fetches
 * nothing. Most popular products first.
 */

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { gunzipSync } from "node:zlib";

import postgres from "postgres";
import sharp from "sharp";
import { uuidv7 } from "uuidv7";

import { ABO_BUCKET } from "@/lib/catalog/abo";
import { parseSpinIndex, pickFrames, type SpinFrame } from "@/lib/catalog/turntable";
import { storage } from "@/lib/storage";

const CACHE = ".abo-cache";
const FRAME_EDGE = 800;
/** Measured on the index: ABO's spin frames average about 72 KB. */
const FRAME_TRANSFER_KB = 72;
const FRAME_STORED_KB = 35;

const out = (line = "") => process.stdout.write(`${line}\n`);

async function cachedFile(name: string, remote: string): Promise<Buffer> {
  const file = path.join(CACHE, name);
  if (!existsSync(file)) {
    await mkdir(CACHE, { recursive: true });
    out(`  downloading ${remote}`);
    const response = await fetch(`${ABO_BUCKET}/${remote}`);
    if (!response.ok) throw new Error(`${response.status} for ${remote}`);
    await writeFile(file, Buffer.from(await response.arrayBuffer()));
  }
  return readFile(file);
}

/** product source id → spin id, from the listing files already downloaded by the import. */
async function spinIdsFromListings(files: readonly string[]): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  for (const file of files) {
    const cachedPath = path.join(CACHE, `listings_${file}.json.gz`);
    if (!existsSync(cachedPath)) continue;
    for (const line of gunzipSync(await readFile(cachedPath)).toString("utf8").split("\n")) {
      if (line.trim() === "") continue;
      try {
        const listing = JSON.parse(line) as { item_id?: string; spin_id?: string };
        if (listing.item_id !== undefined && listing.spin_id !== undefined) ids.set(listing.item_id, listing.spin_id);
      } catch {
        // A damaged line is skipped, as the import does.
      }
    }
  }
  return ids;
}

export async function importSpins(options: { dryRun: boolean; limit: number; frames: number; files: string[]; concurrency: number }): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (url === undefined || url === "") throw new Error("DATABASE_URL is not set. Run this through `pnpm catalog`.");
  const sql = postgres(url, { max: 2, onnotice: () => {} });
  try {
    const spinIds = await spinIdsFromListings(options.files);
    const products = await sql<{ id: string; source_id: string; title_en: string; has_spin: boolean }[]>`
      SELECT p.id, p.source_id, p.title_en, EXISTS (SELECT 1 FROM product_media m WHERE m.product_id = p.id AND m.kind = 'spin') AS has_spin
      FROM products p WHERE p.source = 'abo' AND p.status = 'active'
      ORDER BY p.popularity DESC, p.source_id
    `;
    const wanted = products.filter((product) => !product.has_spin && spinIds.has(product.source_id));
    out(`Spins: ${products.length} ABO products, ${spinIds.size} listings with a spin in the downloaded files, ${wanted.length} products without frames yet`);
    if (wanted.length === 0) return;

    if (options.dryRun) {
      const count = Math.min(options.limit, wanted.length);
      const frames = count * options.frames;
      out(`  would fetch ${frames} frames for ${count} products (≈ ${Math.round((frames * FRAME_TRANSFER_KB) / 1024)} MB transfer, ≈ ${Math.round((frames * FRAME_STORED_KB) / 1024)} MB stored), plus the spin index (7.4 MB) once`);
      out("--dry-run: nothing fetched, nothing written.");
      return;
    }

    const index = parseSpinIndex(gunzipSync(await cachedFile("spins.csv.gz", "spins/metadata/spins.csv.gz")).toString("utf8"));
    const store = await storage();
    const queue = wanted.filter((product) => index.has(spinIds.get(product.source_id)!)).slice(0, options.limit);
    let done = 0;
    let failed = 0;
    let next = 0;
    await Promise.all(
      Array.from({ length: Math.min(options.concurrency, queue.length) }, async () => {
        while (next < queue.length) {
          const product = queue[next]!;
          next += 1;
          const spinId = spinIds.get(product.source_id)!;
          const frames: SpinFrame[] = pickFrames(index.get(spinId)!, options.frames);
          try {
            const rows: { id: string; product_id: string; kind: "spin"; src: string; width: number; height: number; bytes: number; alt_en: string; position: number }[] = [];
            for (const [position, frame] of frames.entries()) {
              const response = await fetch(`${ABO_BUCKET}/spins/original/${frame.path}`);
              if (!response.ok) throw new Error(`${response.status} for frame ${frame.azimuth}`);
              const { data, info } = await sharp(Buffer.from(await response.arrayBuffer()))
                .resize(FRAME_EDGE, FRAME_EDGE, { fit: "inside", withoutEnlargement: true })
                .flatten({ background: "#ffffff" })
                .webp({ quality: 80 })
                .toBuffer({ resolveWithObject: true });
              const key = `catalog/abo-spin/${spinId}/${String(position).padStart(2, "0")}.webp`;
              await store.putObject({ key, body: new Uint8Array(data), contentType: "image/webp" });
              const degrees = Math.round((position / frames.length) * 360);
              rows.push({ id: uuidv7(), product_id: product.id, kind: "spin", src: `/media/${key}`, width: info.width, height: info.height, bytes: data.byteLength, alt_en: `${product.title_en}, turned ${degrees}°`, position });
            }
            await sql.begin(async (tx) => {
              await tx`DELETE FROM product_media WHERE product_id = ${product.id} AND kind = 'spin'`;
              await tx`
                INSERT INTO product_media (id, product_id, kind, src, width, height, bytes, alt_en, position)
                SELECT r.id::uuid, r.product_id::uuid, 'spin', r.src, r.width, r.height, r.bytes, r.alt_en, r.position
                FROM json_to_recordset(${JSON.stringify(rows)}::text::json) AS r(id text, product_id text, src text, width int, height int, bytes int, alt_en text, position int)
              `;
            });
            done += 1;
            if (done % 25 === 0) out(`  ${done} spins kept`);
          } catch (error) {
            failed += 1;
            out(`  skipped ${product.source_id}: ${(error as Error).message}`);
          }
        }
      }),
    );
    out(`  ${done} products now turn round; ${failed} skipped`);
  } finally {
    await sql.end();
  }
}

/**
 * docs/adr/035. `pnpm catalog models [--limit 300]`: runs the worker's own
 * catalog-models job here, eight scans at a time, until every piece that has a
 * scan has it or the limit is reached. In production the worker does the same
 * every five minutes after a deploy.
 */
export async function processModels(options: { limit: number }): Promise<void> {
  const { processCatalogModels } = await import("@/worker/processors/catalog-models");
  let done = 0;
  for (;;) {
    const stats = await processCatalogModels({ requestedAt: new Date().toISOString(), reason: "manual", limit: Math.min(8, options.limit - done) }, `local-${Date.now()}`);
    done += stats.processed + stats.skipped;
    out(`  ${done} handled: +${stats.processed} stored (${Math.round(stats.bytesIn / 1_048_576)} MB in, ${Math.round(stats.bytesOut / 1_048_576)} MB out), ${stats.skipped} set aside, ${stats.remaining} still to do`);
    if (stats.remaining === 0 || done >= options.limit || stats.processed + stats.skipped === 0) break;
  }
}

/** `pnpm catalog made`: the made-models job's work, run here until `limit` models are built or none are left (docs/adr/058). */
export async function processMade(limit: number): Promise<void> {
  const { processMadeModels } = await import("@/worker/processors/made-models");
  let done = 0;
  for (;;) {
    const stats = await processMadeModels({ requestedAt: new Date().toISOString(), reason: "manual", limit: Math.min(12, limit - done) }, `local-${Date.now()}`);
    done += stats.built + stats.found;
    out(`  ${done} done: +${stats.built} built, ${stats.found} already stored, ${stats.deferred} waiting for their photograph, ${stats.remaining} still to do`);
    if (stats.remaining === 0 || done >= limit || stats.built + stats.found === 0) break;
  }
}
