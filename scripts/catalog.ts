/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Catalogue command line: seed fixtures, import Amazon Berkeley Objects products and rebuild the specimen fixture.
 */

/**
 * Catalogue command line (docs/PLAN.md Phase 3).
 *
 *   pnpm catalog seed [--fixture <file>] [--if-empty]
 *       Write a catalogue fixture into the database. Defaults to the specimen
 *       fixture the tests use (25 products, photographs shipped in public/).
 *
 *   pnpm catalog import-abo [--dry-run] [--files 0,1,2] [--per-category 48] [--images 3]
 *       Select products from Amazon Berkeley Objects listings, fetch their
 *       photography into storage, and write them to the database. --dry-run
 *       prints the selection and the download volume and fetches no images.
 *
 *   pnpm catalog specimen-fixture
 *       Rebuild src/lib/catalog/fixtures/specimen.json from the ABO metadata for
 *       the specimen products, reusing the photographs already in public/.
 *
 * Run through `pnpm catalog …`, which starts the local database around the
 * command and passes it the local environment (scripts/local.mjs). ABO is free
 * to download; nothing here calls a paid service.
 */

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { gunzipSync } from "node:zlib";

import { count } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import {
  ABO_ATTRIBUTION,
  ABO_BUCKET,
  EXCLUDED_ABO_ITEMS,
  ABO_LICENSE,
  parseAboListing,
  type AboProductDraft,
  type RejectionReason,
} from "@/lib/catalog/abo";
import { catalogFixtureSchema, type MediaInput, type ProductInput } from "@/lib/catalog/input";
import { catalogImageKey, hasWhiteGround, webMaster } from "@/lib/catalog/photography";
import { CATEGORIES, type CategorySlug } from "@/lib/catalog/taxonomy";
import { archiveExcluded, upsertCatalog, type CatalogDatabase } from "@/lib/catalog/write";
import * as schema from "@/lib/db/schema";
import { SPECIMEN_CATALOG } from "@/lib/specimen/catalog";
import { createTasteGraph } from "@/lib/reco/store";
import { storage } from "@/lib/storage";

const CACHE = ".abo-cache";
const SPECIMEN_FIXTURE = "src/lib/catalog/fixtures/specimen.json";
const IMPORT_OUTPUT = ".local/catalog/abo-import.json";
/** Originals smaller than this look soft on a large product page. */
const MIN_IMAGE_EDGE = 800;

const out = (line = "") => process.stdout.write(`${line}\n`);

/* -------------------------------------------------------------------------- */
/* Database                                                                   */
/* -------------------------------------------------------------------------- */

async function withDatabase<T>(run: (db: CatalogDatabase) => Promise<T>): Promise<T> {
  const url = process.env.DATABASE_URL;
  if (url === undefined || url === "") {
    throw new Error("DATABASE_URL is not set. Run this through `pnpm catalog`, which starts the local database.");
  }
  const connection = postgres(url, { max: 2, onnotice: () => {} });
  try {
    return await run(drizzle(connection, { schema }));
  } finally {
    await connection.end();
  }
}

/* -------------------------------------------------------------------------- */
/* ABO metadata                                                               */
/* -------------------------------------------------------------------------- */

async function cached(name: string, remote: string): Promise<Buffer> {
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

type ImageInfo = { path: string; width: number; height: number };

async function imageIndex(): Promise<Map<string, ImageInfo>> {
  const csv = gunzipSync(await cached("images.csv.gz", "images/metadata/images.csv.gz")).toString("utf8");
  const index = new Map<string, ImageInfo>();
  for (const line of csv.split("\n").slice(1)) {
    const [id, height, width, imagePath] = line.split(",");
    if (id === undefined || imagePath === undefined) continue;
    index.set(id, { path: imagePath.trim(), width: Number(width), height: Number(height) });
  }
  return index;
}

async function* listings(files: readonly string[]): AsyncGenerator<unknown> {
  for (const file of files) {
    const name = `listings_${file}.json.gz`;
    const text = gunzipSync(await cached(name, `listings/metadata/${name}`)).toString("utf8");
    for (const line of text.split("\n")) {
      if (line.trim() === "") continue;
      try {
        yield JSON.parse(line);
      } catch {
        yield null;
      }
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Selection                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Richer listings first: a 3D model, a 360° spin, real dimensions and selling
 * points are what the product page, AR and the Budget Stylist can use.
 */
function richness(draft: AboProductDraft): number {
  return (
    (draft.modelId === null ? 0 : 3) +
    (draft.spinId === null ? 0 : 2) +
    (draft.dimsCm === null ? 0 : 2) +
    Math.min(draft.highlightsEn.length, 3) +
    Math.min(draft.otherImageIds.length, 2) +
    (draft.brand === null ? -2 : 0)
  );
}

function describeReasons(reasons: Map<RejectionReason, number>): string {
  return [...reasons].sort((a, b) => b[1] - a[1]).map(([reason, n]) => `${reason} ${n}`).join(", ");
}

/* -------------------------------------------------------------------------- */
/* Commands                                                                   */
/* -------------------------------------------------------------------------- */

async function seed(options: { fixture: string; ifEmpty: boolean }): Promise<void> {
  const fixture = catalogFixtureSchema.parse(JSON.parse(await readFile(options.fixture, "utf8")));
  await withDatabase(async (db) => {
    // Runs on every start (the local stack seeds with --if-empty), so a newly
    // excluded listing leaves an existing database without a manual step.
    const archived = await archiveExcluded(db, "abo", [...EXCLUDED_ABO_ITEMS.keys()]);
    if (archived > 0) out(`[catalog] archived ${archived} excluded product(s)`);

    if (options.ifEmpty) {
      const [row] = await db.select({ n: count() }).from(schema.products);
      if ((row?.n ?? 0) > 0) {
        out(`[catalog] ${row?.n} products already present; seed skipped`);
        return;
      }
    }
    const started = Date.now();
    const summary = await upsertCatalog(db, fixture.products);
    out(`[catalog] seeded ${summary.products} products, ${summary.media} media from ${options.fixture} in ${Date.now() - started} ms`);
  });
}

async function pool<T>(items: readonly T[], concurrency: number, work: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (next < items.length) {
        const item = items[next];
        next += 1;
        await work(item as T);
      }
    }),
  );
}

async function importAbo(options: {
  dryRun: boolean;
  files: string[];
  perCategory: number;
  images: number;
  concurrency: number;
}): Promise<void> {
  out(`ABO import: listings files ${options.files.join(", ")}, up to ${options.perCategory} per category, ${options.images} images per product`);

  const index = await imageIndex();
  const reasons = new Map<RejectionReason, number>();
  const candidates = new Map<CategorySlug, AboProductDraft[]>();
  const seenTitles = new Set<string>();
  let total = 0;

  for await (const raw of listings(options.files)) {
    total += 1;
    const result = parseAboListing(raw);
    if (!result.ok) {
      reasons.set(result.reason, (reasons.get(result.reason) ?? 0) + 1);
      continue;
    }
    const draft = result.product;
    const main = index.get(draft.mainImageId);
    if (main === undefined || Math.max(main.width, main.height) < MIN_IMAGE_EDGE) continue;
    // The same product in six colours is one product on a shop floor.
    const titleKey = `${draft.brand ?? ""}|${draft.titleEn.toLowerCase()}`;
    if (seenTitles.has(titleKey)) continue;
    seenTitles.add(titleKey);
    const list = candidates.get(draft.category) ?? [];
    list.push(draft);
    candidates.set(draft.category, list);
  }

  out(`  ${total} listings read; rejected: ${describeReasons(reasons)}`);

  // Take a margin over the quota: some photographs will fail the white-ground check.
  const queue: AboProductDraft[] = [];
  for (const category of CATEGORIES) {
    const list = (candidates.get(category.slug) ?? []).sort(
      (a, b) => richness(b) - richness(a) || a.sourceId.localeCompare(b.sourceId),
    );
    const take = list.slice(0, Math.ceil(options.perCategory * 1.5));
    queue.push(...take);
    out(`  ${category.slug.padEnd(11)} ${String(list.length).padStart(5)} eligible, ${take.length} queued`);
  }

  const expectedImages = queue.reduce((sum, draft) => sum + Math.min(options.images, 1 + draft.otherImageIds.length), 0);
  out(`  would fetch up to ${expectedImages} original images (≈ ${Math.round((expectedImages * 0.35))} MB transfer, ≈ ${Math.round(expectedImages * 0.07)} MB stored)`);
  if (options.dryRun) {
    out("--dry-run: no images fetched, nothing written.");
    return;
  }

  const store = await storage();
  const accepted = new Map<CategorySlug, number>();
  const products: ProductInput[] = [];
  let whiteGroundFailures = 0;
  let fetchFailures = 0;

  async function fetchImage(imageId: string): Promise<Buffer | null> {
    const info = index.get(imageId);
    if (info === undefined) return null;
    const response = await fetch(`${ABO_BUCKET}/images/original/${info.path}`);
    if (!response.ok) return null;
    return Buffer.from(await response.arrayBuffer());
  }

  await pool(queue, options.concurrency, async (draft) => {
    if ((accepted.get(draft.category) ?? 0) >= options.perCategory) return;

    try {
      const original = await fetchImage(draft.mainImageId);
      if (original === null) {
        fetchFailures += 1;
        return;
      }
      if (!(await hasWhiteGround(original))) {
        whiteGroundFailures += 1;
        return;
      }
      if ((accepted.get(draft.category) ?? 0) >= options.perCategory) return;
      accepted.set(draft.category, (accepted.get(draft.category) ?? 0) + 1);

      const media: MediaInput[] = [];
      const imageIds = [draft.mainImageId, ...draft.otherImageIds.filter((id) => {
        const info = index.get(id);
        return info !== undefined && Math.max(info.width, info.height) >= MIN_IMAGE_EDGE;
      })].slice(0, options.images);

      for (const [position, imageId] of imageIds.entries()) {
        const bytes = position === 0 ? original : await fetchImage(imageId);
        if (bytes === null) continue;
        const master = await webMaster(bytes);
        const key = catalogImageKey("abo", draft.sourceId, imageId);
        await store.putObject({ key, body: master.body, contentType: master.contentType });
        const label = draft.brand === null ? draft.titleEn : `${draft.titleEn} by ${draft.brand}`;
        media.push({
          kind: "image",
          src: `/media/${key}`,
          width: master.width,
          height: master.height,
          bytes: master.body.byteLength,
          altEn: position === 0 ? label : `${label}, view ${position + 1}`,
          whiteGround: position === 0 ? true : await hasWhiteGround(bytes),
        });
      }

      products.push(toProductInput(draft, media));
      if (products.length % 25 === 0) out(`  ${products.length} products imported`);
    } catch (error) {
      fetchFailures += 1;
      out(`  skipped ${draft.sourceId}: ${(error as Error).message}`);
    }
  });

  products.sort((a, b) => a.category.localeCompare(b.category) || a.sourceId.localeCompare(b.sourceId));
  out(`  ${products.length} products ready; ${whiteGroundFailures} failed the white-ground check, ${fetchFailures} could not be fetched`);

  await mkdir(path.dirname(IMPORT_OUTPUT), { recursive: true });
  await writeFile(
    IMPORT_OUTPUT,
    JSON.stringify({ version: 1, description: `ABO import, files ${options.files.join(",")}`, products }, null, 2),
  );
  out(`  wrote ${IMPORT_OUTPUT}`);

  await withDatabase(async (db) => {
    const summary = await upsertCatalog(db, products);
    const archived = await archiveExcluded(db, "abo", [...EXCLUDED_ABO_ITEMS.keys()]);
    out(`  database: ${summary.products} products, ${summary.media} media, ${summary.brands} brands written; ${archived} excluded archived`);
  });

  // New products need neighbour lists before they can be recommended.
  const connection = postgres(process.env.DATABASE_URL as string, { max: 2, onnotice: () => {} });
  try {
    const stats = await createTasteGraph(connection).rebuild();
    out(`  taste graph rebuilt: ${stats.neighbourRows} neighbour rows in ${stats.elapsedMs} ms`);
  } finally {
    await connection.end();
  }
}

function toProductInput(draft: AboProductDraft, media: MediaInput[]): ProductInput {
  return {
    source: "abo",
    sourceId: draft.sourceId,
    slug: draft.slug,
    kind: draft.kind,
    category: draft.category,
    titleEn: draft.titleEn,
    titleEl: null,
    brand: draft.brand,
    descriptionEn: draft.descriptionEn,
    descriptionEl: null,
    highlightsEn: draft.highlightsEn,
    highlightsEl: null,
    translation: "none",
    colorLabel: draft.colorLabel,
    colors: draft.colors,
    materials: draft.materials,
    attributes: draft.attributes,
    dimsCm: draft.dimsCm,
    weightGrams: draft.weightGrams,
    priceCents: draft.priceCents,
    compareAtCents: draft.compareAtCents,
    stock: draft.stock,
    license: ABO_LICENSE,
    attribution: ABO_ATTRIBUTION,
    media,
  };
}

/**
 * The specimen fixture: the 25 products whose photographs ship in public/,
 * enriched with their full ABO metadata. Deterministic and offline once the
 * metadata is cached, so the tests always run on the same catalogue.
 */
async function specimenFixture(): Promise<void> {
  const wanted = new Map(SPECIMEN_CATALOG.map((product) => [product.id, product]));
  const products: ProductInput[] = [];

  for await (const raw of listings(["0"])) {
    const id = (raw as { item_id?: string } | null)?.item_id;
    if (id === undefined) continue;
    const specimen = wanted.get(id);
    if (specimen === undefined) continue;

    const result = parseAboListing(raw);
    if (!result.ok) {
      out(`  ${id}: rejected (${result.reason})`);
      continue;
    }
    const label = `${result.product.titleEn} by ${result.product.brand ?? specimen.brand}`;
    const media: MediaInput[] = [
      { kind: "image", src: specimen.image.src, width: specimen.image.width, height: specimen.image.height, bytes: null, altEn: label, whiteGround: true },
    ];
    if (specimen.hoverImage !== null) {
      media.push({
        kind: "image",
        src: specimen.hoverImage.src,
        width: specimen.hoverImage.width,
        height: specimen.hoverImage.height,
        bytes: null,
        altEn: `${label}, view 2`,
        whiteGround: true,
      });
    }
    // The specimen keeps the price the design review was done with.
    products.push({ ...toProductInput(result.product, media), priceCents: specimen.priceCents, compareAtCents: null });
  }

  // Keep the specimen order, which the design review and the screenshots use.
  const order = SPECIMEN_CATALOG.map((product) => product.id);
  products.sort((a, b) => order.indexOf(a.sourceId) - order.indexOf(b.sourceId));

  const fixture = catalogFixtureSchema.parse({
    version: 1,
    description: "Specimen catalogue: 25 ABO products with photographs in public/products. Used by tests and a fresh local database.",
    products,
  });
  await mkdir(path.dirname(SPECIMEN_FIXTURE), { recursive: true });
  await writeFile(SPECIMEN_FIXTURE, `${JSON.stringify(fixture, null, 2)}\n`);
  out(`wrote ${SPECIMEN_FIXTURE} with ${products.length} of ${SPECIMEN_CATALOG.length} specimen products`);
}

/* -------------------------------------------------------------------------- */

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  const { values } = parseArgs({
    args: rest,
    options: {
      fixture: { type: "string", default: SPECIMEN_FIXTURE },
      "if-empty": { type: "boolean", default: false },
      "dry-run": { type: "boolean", default: false },
      files: { type: "string", default: "0" },
      "per-category": { type: "string", default: "48" },
      images: { type: "string", default: "3" },
      concurrency: { type: "string", default: "6" },
    },
  });

  switch (command) {
    case "seed":
      return seed({ fixture: values.fixture, ifEmpty: values["if-empty"] });
    case "import-abo": {
      const files =
        values.files === "all" ? [..."0123456789abcdef"] : values.files.split(",").map((file) => file.trim().toLowerCase());
      if (files.some((file) => !/^[0-9a-f]$/.test(file))) throw new Error("--files takes 0-9 and a-f, comma separated, or all");
      return importAbo({
        dryRun: values["dry-run"],
        files,
        perCategory: Math.max(1, Number.parseInt(values["per-category"], 10)),
        images: Math.min(8, Math.max(1, Number.parseInt(values.images, 10))),
        concurrency: Math.min(16, Math.max(1, Number.parseInt(values.concurrency, 10))),
      });
    }
    case "specimen-fixture":
      return specimenFixture();
    default:
      out("Usage: pnpm catalog <seed|import-abo|specimen-fixture> [options]");
      process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`[catalog] ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
  process.exitCode = 1;
});
