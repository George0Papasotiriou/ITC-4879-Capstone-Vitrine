/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * The wearables as committed fixtures: real ABO pieces in their sizes, and the real Amazon.com reviews of those same pieces.
 */

/**
 * docs/adr/061 (George, 2026-10-04: "at least 300 … with real photos, reviews and stuff").
 *
 *   pnpm catalog wear-fixture [--dry-run]
 *
 * Reads the ABO listings in .abo-cache and the reviews found by
 * scripts/amazon-reviews.ts, and writes three files, all committed:
 *
 *   - src/lib/catalog/fixtures/abo-wear.json — about 370 wearables, each in its
 *     sizes (src/lib/catalog/wear.ts), photographs by address in ABO's bucket,
 *     synced into the shop by every deploy like abo.json;
 *   - src/lib/catalog/fixtures/amazon-reviews.json — up to eight real reviews of
 *     each, with the totals and the fit words counted over all of them;
 *   - src/lib/catalog/fixtures/wear-specimen.json and its photographs in
 *     public/products/wear/ — twelve of them for the tests, which run on a
 *     fixed shelf with no network.
 *
 * Selection is deterministic. Per kind (a quota each): pieces with reviews
 * first (more reviews, then richer listings), ties by id. A piece is taken
 * only if its main photograph is on a white studio ground (checked on ABO's
 * 256 px copy, as the large catalogue is) and it has a second photograph.
 * The same design in several colours is one product.
 */

import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { gunzipSync } from "node:zlib";

import { ABO_ATTRIBUTION, ABO_BUCKET, ABO_LICENSE, englishValue, EXCLUDED_ABO_ITEMS, parseAboListing, productSlug, type AboProductDraft } from "@/lib/catalog/abo";
import { catalogFixtureSchema, type MediaInput, type ProductInput } from "@/lib/catalog/input";
import { hasWhiteGround } from "@/lib/catalog/photography";
import { ABO_PRODUCT_KINDS } from "@/lib/catalog/taxonomy";
import { ABO_WEAR_TYPES, brandFromTitle, canonicalBrand, cleanColourLabel, cleanWearTitle, isKindAsListed, wearKindFor, wearSizes, wearStock, WEAR_KINDS, type WearKind } from "@/lib/catalog/wear";
import { amazonReviewsFixtureSchema, AMAZON_REVIEWS_CITATION, type AmazonProductReviews } from "@/lib/reviews/amazon";

export const WEAR_FIXTURE = "src/lib/catalog/fixtures/abo-wear.json";
export const WEAR_SPECIMEN_FIXTURE = "src/lib/catalog/fixtures/wear-specimen.json";
export const AMAZON_REVIEWS_FIXTURE = "src/lib/catalog/fixtures/amazon-reviews.json";
const CACHE = ".abo-cache";
const REVIEWS_CACHE = path.join(CACHE, "amazon-reviews-wear.json");
const VERDICTS = path.join(CACHE, "white-ground.json");
const SPECIMEN_IMAGES = "public/products/wear";
/** Originals smaller than this look soft on a large product page. */
const MIN_IMAGE_EDGE = 800;
/** Photographs per wearable: a front, and the other angles a shopper turns a shoe over to see. */
const IMAGES = 4;
/** Reviews shown per piece, the most helpful first. */
const REVIEWS_SHOWN = 8;

/** How many of each kind: a shop's floor, weighted as a shoe-and-bag shop is, within what ABO has (dry run, 2026-10-05). */
export const WEAR_QUOTAS: Readonly<Record<WearKind, number>> = {
  SHOES: 100,
  BOOT: 45,
  SANDAL: 45,
  HANDBAG: 35,
  TOTE_BAG: 8,
  WALLET: 10,
  BACKPACK: 15,
  HAT: 35,
  SCARF: 25,
  // ABO's one English sunglasses listing with a second photograph is a dress, filed wrongly: none are sold.
  SUNGLASSES: 0,
  EARRING: 30,
  NECKLACE: 30,
  BRACELET: 15,
  WATCH: 15,
};

/** The tests' shelf: a few of each family, the first ones chosen. */
const SPECIMEN_QUOTAS: Partial<Record<WearKind, number>> = { SHOES: 3, BOOT: 2, SANDAL: 1, HANDBAG: 2, HAT: 1, SCARF: 1, NECKLACE: 1, EARRING: 1 };

const out = (line = "") => process.stdout.write(`${line}\n`);

type ImageInfo = { path: string; width: number; height: number };
type Candidate = { draft: AboProductDraft; rawTitle: string; reviews: AmazonProductReviews | null };

async function imageIndex(): Promise<Map<string, ImageInfo>> {
  const csv = gunzipSync(await readFile(path.join(CACHE, "images.csv.gz"))).toString("utf8");
  const index = new Map<string, ImageInfo>();
  for (const line of csv.split("\n").slice(1)) {
    const [id, height, width, imagePath] = line.split(",");
    if (id === undefined || imagePath === undefined) continue;
    index.set(id, { path: imagePath.trim(), width: Number(width), height: Number(height) });
  }
  return index;
}

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

/** Pieces with reviews first (more of them first), then the richer listing, then by id. */
function order(a: Candidate, b: Candidate): number {
  const reviews = (candidate: Candidate) => Math.min(candidate.reviews?.count ?? 0, 400);
  const richness = (draft: AboProductDraft) => Math.min(draft.highlightsEn.length, 4) + Math.min(draft.otherImageIds.length, 4) + (draft.brand === null ? -3 : 0) + (draft.descriptionEn === null ? 0 : 1);
  return reviews(b) - reviews(a) || richness(b.draft) - richness(a.draft) || a.draft.sourceId.localeCompare(b.draft.sourceId);
}

/** The reviews kept for a piece: the totals as they are, the most helpful few. */
const shown = (entry: AmazonProductReviews): AmazonProductReviews => ({ ...entry, reviews: entry.reviews.slice(0, REVIEWS_SHOWN) });

export async function wearFixture(options: { dryRun: boolean }): Promise<void> {
  if (!existsSync(REVIEWS_CACHE)) throw new Error(`${REVIEWS_CACHE} is missing: run \`pnpm exec tsx scripts/amazon-reviews.ts --run\` first.`);
  const found = (JSON.parse(await readFile(REVIEWS_CACHE, "utf8")) as { products: Record<string, AmazonProductReviews> }).products;
  if (existsSync(VERDICTS)) verdicts = JSON.parse(await readFile(VERDICTS, "utf8")) as Record<string, boolean>;
  const index = await imageIndex();

  const candidates = new Map<WearKind, Candidate[]>();
  const seen = new Set<string>();
  // ABO lists some items once per marketplace, under different titles: each item is taken once.
  const items = new Set<string>();
  let listings = 0;
  for (const file of (await readdir(CACHE)).filter((name) => /^listings_[0-9a-f]\.json\.gz$/.test(name)).sort()) {
    const text = gunzipSync(await readFile(path.join(CACHE, file))).toString("utf8");
    for (const line of text.split("\n")) {
      if (line.trim() === "") continue;
      listings += 1;
      const raw = JSON.parse(line) as { item_id: string; product_type?: { value: string }[]; item_name?: { language_tag?: string; value: string }[] };
      const type = raw.product_type?.[0]?.value;
      if (type === undefined || !(type in ABO_WEAR_TYPES) || EXCLUDED_ABO_ITEMS.has(raw.item_id)) continue;
      const rawTitle = englishValue(raw.item_name);
      if (rawTitle === undefined) continue;
      const kind = wearKindFor(type, rawTitle);
      if (kind === null || WEAR_QUOTAS[kind] === 0 || !isKindAsListed(kind, rawTitle) || items.has(raw.item_id)) continue;
      // The listing read as the shop's own kind, so a scarf is a SCARF and not an ACCESSORY.
      const result = parseAboListing({ ...raw, product_type: [{ value: kind }] });
      if (!result.ok) continue;
      // The title and colour as a shop prints them (wear.ts); a listing with nothing printable left is not taken.
      const brand = canonicalBrand(result.product.brand ?? brandFromTitle(result.product.titleEn));
      const titleEn = cleanWearTitle(result.product.titleEn, brand, kind);
      if (titleEn === null) continue;
      const draft: AboProductDraft = { ...result.product, brand, titleEn, slug: productSlug(titleEn, result.product.sourceId), colorLabel: cleanColourLabel(result.product.colorLabel) };
      const main = index.get(draft.mainImageId);
      if (main === undefined || Math.max(main.width, main.height) < MIN_IMAGE_EDGE) continue;
      const others = draft.otherImageIds.filter((id) => (index.get(id)?.width ?? 0) >= MIN_IMAGE_EDGE || (index.get(id)?.height ?? 0) >= MIN_IMAGE_EDGE);
      if (others.length === 0) continue;
      const candidate: Candidate = { draft, rawTitle, reviews: found[draft.sourceId] ?? null };
      // The same design in another colour is the same product on a shop floor: the one with more reviews stays.
      const key = `${kind}|${(draft.brand ?? "").toLowerCase()}|${draft.titleEn.toLowerCase()}`;
      if (seen.has(key)) {
        const list = candidates.get(kind)!;
        const at = list.findIndex((entry) => `${kind}|${(entry.draft.brand ?? "").toLowerCase()}|${entry.draft.titleEn.toLowerCase()}` === key);
        if (at >= 0 && (candidate.reviews?.count ?? 0) > (list[at]!.reviews?.count ?? 0)) list[at] = candidate;
        continue;
      }
      seen.add(key);
      items.add(raw.item_id);
      const list = candidates.get(kind) ?? [];
      list.push(candidate);
      candidates.set(kind, list);
    }
  }
  for (const list of candidates.values()) list.sort(order);

  out(`Wear fixture: ${listings} listings read.`);
  for (const kind of WEAR_KINDS) {
    const list = candidates.get(kind) ?? [];
    out(`  ${kind.padEnd(11)} ${String(list.length).padStart(5)} eligible, ${String(list.filter((entry) => entry.reviews !== null).length).padStart(4)} with reviews, quota ${WEAR_QUOTAS[kind]}`);
  }
  if (options.dryRun) {
    out("--dry-run: nothing fetched, nothing written.");
    return;
  }

  const products: ProductInput[] = [];
  const reviews: Record<string, AmazonProductReviews> = {};
  let rejected = 0;
  for (const kind of WEAR_KINDS) {
    const queue = candidates.get(kind) ?? [];
    let accepted = 0;
    for (let start = 0; start < queue.length && accepted < WEAR_QUOTAS[kind]; start += 12) {
      const batch = queue.slice(start, start + 12);
      const grounds = await Promise.all(batch.map((entry) => studioShot(index.get(entry.draft.mainImageId)!)));
      for (const [position, { draft, rawTitle, reviews: found }] of batch.entries()) {
        if (accepted >= WEAR_QUOTAS[kind]) break;
        if (grounds[position] !== true) {
          rejected += 1;
          continue;
        }
        const label = draft.brand === null ? draft.titleEn : `${draft.titleEn} by ${draft.brand}`;
        const others = draft.otherImageIds
          .map((id) => index.get(id))
          .filter((info): info is ImageInfo => info !== undefined && Math.max(info.width, info.height) >= MIN_IMAGE_EDGE)
          .slice(0, IMAGES - 1);
        const otherGrounds = await Promise.all(others.map((info) => studioShot(info)));
        const main = index.get(draft.mainImageId)!;
        const media: MediaInput[] = [
          { kind: "image", src: `${ABO_BUCKET}/images/original/${main.path}`, width: main.width, height: main.height, bytes: null, altEn: label, whiteGround: true },
          ...others.map((info, at) => ({ kind: "image" as const, src: `${ABO_BUCKET}/images/original/${info.path}`, width: info.width, height: info.height, bytes: null, altEn: `${label}, view ${at + 2}`, whiteGround: otherGrounds[at] === true })),
        ];
        const sizes = wearSizes(kind, draft.titleEn, rawTitle);
        const variants = sizes.map((size) => ({ size, stock: wearStock(draft.sourceId, size, sizes), priceCents: null }));
        products.push({
          source: "abo",
          sourceId: draft.sourceId,
          slug: draft.slug,
          kind,
          category: ABO_PRODUCT_KINDS[kind]!.category,
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
          // A shoe's listed box size is not the shoe: wearables carry no room dimensions.
          dimsCm: null,
          weightGrams: draft.weightGrams,
          priceCents: draft.priceCents,
          compareAtCents: draft.compareAtCents,
          stock: variants.reduce((sum, variant) => sum + variant.stock, 0),
          variants,
          license: ABO_LICENSE,
          attribution: ABO_ATTRIBUTION,
          media,
        });
        if (found !== null) reviews[draft.sourceId] = shown(found);
        accepted += 1;
      }
    }
    out(`  ${kind.padEnd(11)} ${accepted} accepted`);
    await writeFile(VERDICTS, JSON.stringify(verdicts));
  }

  products.sort((a, b) => a.category.localeCompare(b.category) || a.kind.localeCompare(b.kind) || a.sourceId.localeCompare(b.sourceId));
  const fixture = {
    version: 1 as const,
    description: `Wearables: ${products.length} Amazon Berkeley Objects listings (CC BY 4.0, by Amazon.com), in their sizes. Photographs are served from the ABO bucket through the shop's image optimizer. Rebuilt by \`pnpm catalog wear-fixture\` (docs/adr/061).`,
    products,
  };
  catalogFixtureSchema.parse(fixture);
  await writeFile(WEAR_FIXTURE, `{"version":1,"description":${JSON.stringify(fixture.description)},"products":[\n${products.map((product) => JSON.stringify(product)).join(",\n")}\n]}\n`);

  const reviewsFixture = amazonReviewsFixtureSchema.parse({ version: 1, citation: AMAZON_REVIEWS_CITATION, products: reviews });
  const ids = Object.keys(reviewsFixture.products).sort();
  await writeFile(AMAZON_REVIEWS_FIXTURE, `{"version":1,"citation":${JSON.stringify(AMAZON_REVIEWS_CITATION)},"products":{\n${ids.map((id) => `${JSON.stringify(id)}:${JSON.stringify(reviewsFixture.products[id])}`).join(",\n")}\n}}\n`);

  const withReviews = ids.length;
  const reviewCount = ids.reduce((sum, id) => sum + reviewsFixture.products[id]!.reviews.length, 0);
  out(`  ${products.length} wearables written to ${WEAR_FIXTURE}; ${withReviews} with real reviews (${reviewCount} shown) in ${AMAZON_REVIEWS_FIXTURE}; ${rejected} not on white`);

  await wearSpecimen(products);
}

/** The tests' shelf: the first few of each family, their photographs in public/ so the tests need no network. */
async function wearSpecimen(products: ProductInput[]): Promise<void> {
  const { default: sharp } = await import("sharp");
  // A fresh folder, so a piece no longer on the shelf leaves no photograph behind.
  await rm(SPECIMEN_IMAGES, { recursive: true, force: true });
  await mkdir(SPECIMEN_IMAGES, { recursive: true });
  const chosen: ProductInput[] = [];
  for (const [kind, count] of Object.entries(SPECIMEN_QUOTAS)) chosen.push(...products.filter((product) => product.kind === kind).slice(0, count));
  const specimen: ProductInput[] = [];
  for (const product of chosen) {
    const media: MediaInput[] = [];
    for (const [at, entry] of product.media.slice(0, 2).entries()) {
      const response = await fetch(entry.src);
      if (!response.ok) throw new Error(`${response.status} for ${entry.src}`);
      const file = `${product.sourceId.toLowerCase()}${at === 0 ? "" : `-${at + 1}`}.webp`;
      const { data, info } = await sharp(Buffer.from(await response.arrayBuffer())).resize(1200, 1200, { fit: "inside", withoutEnlargement: true }).webp({ quality: 82 }).toBuffer({ resolveWithObject: true });
      await writeFile(path.join(SPECIMEN_IMAGES, file), data);
      media.push({ ...entry, src: `/products/wear/${file}`, width: info.width, height: info.height, bytes: data.byteLength });
    }
    specimen.push({ ...product, media });
  }
  const fixture = catalogFixtureSchema.parse({
    version: 1,
    description: "Wear specimen: twelve ABO wearables with photographs in public/products/wear, for the tests (docs/adr/061).",
    products: specimen,
  });
  await writeFile(WEAR_SPECIMEN_FIXTURE, `${JSON.stringify(fixture, null, 2)}\n`);
  out(`  ${specimen.length} wearables written to ${WEAR_SPECIMEN_FIXTURE}, photographs in ${SPECIMEN_IMAGES}`);
}
