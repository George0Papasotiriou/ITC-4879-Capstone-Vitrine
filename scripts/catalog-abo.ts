/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * The large ABO catalogue as a committed fixture: products, their photographs and turntable frames by address, and their 3D scans to make.
 */

/**
 * docs/adr/035 and its addendum.
 *
 *   pnpm catalog abo-fixture [--dry-run] [--per-category 750] [--images 2] [--spins 300] [--frames 24] [--models 300]
 *
 * Builds src/lib/catalog/fixtures/abo.json from the ABO listings downloaded to
 * .abo-cache. That file is text (a few megabytes) and is committed, so a push
 * carries the whole catalogue: the deploy's sync writes it into the database
 * like the other fixtures. Nothing heavy goes into git:
 *
 *   - photographs and turntable frames stay in ABO's public bucket; the
 *     fixture records their addresses and sizes, and the shop serves them
 *     through its own image optimizer;
 *   - a piece's 3D scan is recorded by its path (`modelSource`); the worker's
 *     catalog-models job compresses it into the shop's storage.
 *
 * Selection is deterministic: in each home category the richest listings first
 * (a 3D scan, a spin, measurements, selling points), ties by id, skipping the
 * products the specimen and collection fixtures already have. A piece of
 * furniture is accepted only if its main photograph is on a white studio
 * ground — checked on ABO's 256 px copy, which is all the check looks at — so
 * the room planner can cut it out. Rugs and wall art are accepted as they are.
 *
 * Spins and 3D scans are shared out across the categories (a quota each, the
 * richest listings first), so 300 of each do not all go to chairs. Scans are
 * kept for pieces that stand in a room — not rugs or wall art, which are flat.
 */

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { gunzipSync } from "node:zlib";

import { ABO_ATTRIBUTION, ABO_BUCKET, ABO_LICENSE, EXCLUDED_ABO_ITEMS, parseAboListing, type AboProductDraft } from "@/lib/catalog/abo";
import { catalogFixtureSchema, type MediaInput, type ProductInput } from "@/lib/catalog/input";
import { hasWhiteGround } from "@/lib/catalog/photography";
import { CATEGORIES, type CategorySlug } from "@/lib/catalog/taxonomy";
import { parseModelIndex, parseSpinIndex, pickFrames } from "@/lib/catalog/turntable";

export const ABO_FIXTURE = "src/lib/catalog/fixtures/abo.json";
const COLLECTION_FIXTURE = "src/lib/catalog/fixtures/collection.json";
const SPECIMEN_FIXTURE = "src/lib/catalog/fixtures/specimen.json";
const CACHE = ".abo-cache";
const FLAT_CATEGORIES = new Set<CategorySlug>(["rugs", "wall-decor"]);
/** Originals smaller than this look soft on a large product page. */
const MIN_IMAGE_EDGE = 800;
/** A spin needs enough frames to turn smoothly. */
const MIN_SPIN_FRAMES = 24;
/** Flat pieces gain nothing from a 3D scan. */
const NO_MODEL_CATEGORIES = new Set<CategorySlug>(["rugs", "wall-decor"]);

const out = (line = "") => process.stdout.write(`${line}\n`);

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

/** Verdicts already reached, by image path, so a rebuild with other limits does not fetch the same photographs again. */
const VERDICTS = path.join(CACHE, "white-ground.json");
let verdicts: Record<string, boolean> = {};

/** Whether a photograph sits on white, judged on ABO's 256 px copy; null when it cannot be fetched. */
async function studioShot(info: ImageInfo): Promise<boolean | null> {
  const known = verdicts[info.path];
  if (known !== undefined) return known;
  const response = await fetch(`${ABO_BUCKET}/images/small/${info.path}`).catch(() => null);
  if (response === null || !response.ok) return null;
  const verdict = await hasWhiteGround(Buffer.from(await response.arrayBuffer()));
  verdicts[info.path] = verdict;
  return verdict;
}

export async function aboFixture(options: { dryRun: boolean; files: string[]; perCategory: number; images: number; spins: number; frames: number; models: number }): Promise<void> {
  out(`ABO fixture: listings ${options.files.join("")}, up to ${options.perCategory} per category, ${options.images} photographs each, ${options.spins} spins of ${options.frames} frames, ${options.models} 3D scans`);

  if (existsSync(VERDICTS)) verdicts = JSON.parse(await readFile(VERDICTS, "utf8")) as Record<string, boolean>;
  const taken = new Set<string>();
  for (const file of [SPECIMEN_FIXTURE, COLLECTION_FIXTURE]) {
    for (const product of catalogFixtureSchema.parse(JSON.parse(await readFile(file, "utf8"))).products) taken.add(product.sourceId);
  }
  const index = await imageIndex();
  const spins = parseSpinIndex(gunzipSync(await cached("spins.csv.gz", "spins/metadata/spins.csv.gz")).toString("utf8"));
  const models = parseModelIndex(gunzipSync(await cached("3dmodels.csv.gz", "3dmodels/metadata/3dmodels.csv.gz")).toString("utf8"));

  const candidates = new Map<CategorySlug, AboProductDraft[]>();
  const seenTitles = new Set<string>();
  let listings = 0;
  for (const file of options.files) {
    const name = `listings_${file}.json.gz`;
    const text = gunzipSync(await cached(name, `listings/metadata/${name}`)).toString("utf8");
    for (const line of text.split("\n")) {
      if (line.trim() === "") continue;
      listings += 1;
      let raw: unknown;
      try {
        raw = JSON.parse(line);
      } catch {
        continue;
      }
      const result = parseAboListing(raw);
      if (!result.ok) continue;
      const draft = result.product;
      if (taken.has(draft.sourceId) || EXCLUDED_ABO_ITEMS.has(draft.sourceId)) continue;
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
  }
  for (const list of candidates.values()) list.sort((a, b) => richness(b) - richness(a) || a.sourceId.localeCompare(b.sourceId));

  out(`  ${listings} listings read`);
  let planned = 0;
  for (const category of CATEGORIES) {
    const available = candidates.get(category.slug) ?? [];
    if (available.length === 0) continue;
    const take = Math.min(available.length, options.perCategory);
    planned += take;
    const withModel = available.slice(0, take).filter((draft) => draft.modelId !== null && models.has(draft.modelId)).length;
    const withSpin = available.slice(0, take).filter((draft) => draft.spinId !== null && (spins.get(draft.spinId)?.length ?? 0) >= MIN_SPIN_FRAMES).length;
    out(`  ${category.slug.padEnd(11)} ${String(available.length).padStart(5)} eligible, up to ${take} taken (${withModel} with a 3D scan, ${withSpin} with a spin)`);
  }
  out(`  about ${planned} products; white-ground checks on 256 px copies ≈ ${Math.round((planned * 1.4 * options.images * 12) / 1024)} MB; nothing else is downloaded`);
  if (options.dryRun) {
    out("--dry-run: nothing fetched, nothing written.");
    return;
  }

  const categoriesWithCandidates = CATEGORIES.filter((category) => (candidates.get(category.slug)?.length ?? 0) > 0);
  const spinQuota = Math.ceil(options.spins / Math.max(1, categoriesWithCandidates.length));
  const modelQuota = Math.ceil(options.models / Math.max(1, categoriesWithCandidates.filter((category) => !NO_MODEL_CATEGORIES.has(category.slug)).length));
  const products: ProductInput[] = [];
  let spinsKept = 0;
  let modelsKept = 0;
  let rejected = 0;
  let failed = 0;
  for (const category of CATEGORIES) {
    const queue = candidates.get(category.slug) ?? [];
    if (queue.length === 0) continue;
    let accepted = 0;
    let categorySpins = 0;
    let categoryModels = 0;
    // Checked a few at a time, but accepted strictly in the sorted order, so the result does not
    // depend on which download finished first.
    for (let start = 0; start < queue.length && accepted < options.perCategory; start += 12) {
      const batch = queue.slice(start, start + 12);
      const grounds = await Promise.all(batch.map((draft) => studioShot(index.get(draft.mainImageId)!)));
      for (const [position, draft] of batch.entries()) {
        if (accepted >= options.perCategory) break;
        const studio = grounds[position];
        if (studio === null) {
          failed += 1;
          continue;
        }
        if (studio === false && !FLAT_CATEGORIES.has(category.slug)) {
          rejected += 1;
          continue;
        }
        const label = draft.brand === null ? draft.titleEn : `${draft.titleEn} by ${draft.brand}`;
        const others = draft.otherImageIds
          .map((id) => index.get(id))
          .filter((info): info is ImageInfo => info !== undefined && Math.max(info.width, info.height) >= MIN_IMAGE_EDGE)
          .slice(0, options.images - 1);
        const otherGrounds = await Promise.all(others.map((info) => studioShot(info)));
        const main = index.get(draft.mainImageId)!;
        const media: MediaInput[] = [
          { kind: "image", src: `${ABO_BUCKET}/images/original/${main.path}`, width: main.width, height: main.height, bytes: null, altEn: label, whiteGround: studio === true },
          ...others.map((info, at) => ({
            kind: "image" as const,
            src: `${ABO_BUCKET}/images/original/${info.path}`,
            width: info.width,
            height: info.height,
            bytes: null,
            altEn: `${label}, view ${at + 2}`,
            whiteGround: otherGrounds[at] === true,
          })),
        ];
        const frames = draft.spinId === null ? [] : (spins.get(draft.spinId) ?? []);
        if (spinsKept < options.spins && categorySpins < spinQuota && frames.length >= MIN_SPIN_FRAMES) {
          spinsKept += 1;
          categorySpins += 1;
          for (const [at, frame] of pickFrames(frames, options.frames).entries()) {
            media.push({
              kind: "spin",
              src: `${ABO_BUCKET}/spins/original/${frame.path}`,
              width: frame.width,
              height: frame.height,
              bytes: null,
              altEn: `${label}, turned ${Math.round((at / options.frames) * 360)}°`,
              whiteGround: true,
            });
          }
        }
        const scan = draft.modelId === null ? undefined : models.get(draft.modelId);
        const model = scan !== undefined && modelsKept < options.models && categoryModels < modelQuota && !NO_MODEL_CATEGORIES.has(category.slug) ? scan : undefined;
        if (model !== undefined) {
          modelsKept += 1;
          categoryModels += 1;
        }
        products.push({
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
          ...(model === undefined ? {} : { modelSource: model.path }),
        });
        accepted += 1;
      }
    }
    out(`  ${category.slug.padEnd(11)} ${accepted} accepted`);
    await writeFile(VERDICTS, JSON.stringify(verdicts));
  }

  products.sort((a, b) => a.category.localeCompare(b.category) || a.sourceId.localeCompare(b.sourceId));
  const fixture = {
    version: 1 as const,
    description: `The large catalogue: ${products.length} Amazon Berkeley Objects listings (CC BY 4.0, by Amazon.com). Photographs and turntable frames are served from the ABO bucket through the shop's image optimizer; 3D scans are compressed into storage by the worker. Rebuilt by \`pnpm catalog abo-fixture\`.`,
    products,
  };
  catalogFixtureSchema.parse(fixture);
  // One product per line: a rebuild shows up in a diff as the lines that changed.
  const body = `{"version":1,"description":${JSON.stringify(fixture.description)},"products":[\n${products.map((product) => JSON.stringify(product)).join(",\n")}\n]}\n`;
  await writeFile(ABO_FIXTURE, body);
  const withModel = products.filter((product) => product.modelSource !== undefined).length;
  out(`  ${products.length} products written to ${ABO_FIXTURE} (${Math.round(body.length / 1024)} KB): ${withModel} with a 3D scan, ${spinsKept} with a spin; ${rejected} not on white, ${failed} could not be fetched`);
}
