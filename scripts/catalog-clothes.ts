/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Real clothes for the Clothing range: chosen from Amazon Reviews 2023's product listings, with their own photographs and reviews.
 */

import { createReadStream, existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";
import { Readable } from "node:stream";
import { parseArgs } from "node:util";
import { createGunzip } from "node:zlib";

import { productSlug } from "@/lib/catalog/abo";
import { capsuleStock, type CapsuleKind } from "@/lib/catalog/capsule";
import {
  careOf,
  cleanClothesTitle,
  clothesHighlights,
  clothesKindFor,
  clothesPriceCents,
  departmentOf,
  fabricOf,
  garmentColour,
  EXCLUDED_LISTINGS,
  GARMENT_CROP,
  isGarmentPhotoShape,
  isGarmentStudioShot,
  MAX_TITLE,
  priceRanks,
  titleColours,
  type Department,
} from "@/lib/catalog/clothes";
import { catalogFixtureSchema, type MediaInput, type ProductInput } from "@/lib/catalog/input";
import { CAPSULE_PRODUCT_KINDS, CAPSULE_SIZES } from "@/lib/catalog/taxonomy";
import { canonicalBrand } from "@/lib/catalog/wear";
import { amazonReviewsFixtureSchema, AMAZON_REVIEWS_CITATION, decodedReviews, type AmazonProductReviews } from "@/lib/reviews/amazon";
import { colorLabel, type ColorId } from "@/lib/search/vocabulary";
import { pixelsFrom } from "@/lib/vision/palette";

/**
 * docs/adr/062 (George, 2026-10-05: "fix the 24 clothes also, and add about
 * 100 more"). ABO, the CC BY dataset the furniture and wearables come from,
 * holds almost no garments, so the clothes come from the product listings of
 * Amazon Reviews 2023 (Hou et al., McAuley Lab, UCSD): the same research
 * release whose reviews the shop already shows, keyed by the same ASINs, so
 * every garment arrives with real photographs and the real reviews of that
 * very garment.
 *
 *   pnpm exec tsx scripts/catalog-clothes.ts scan [--file <local copy>]
 *   pnpm exec tsx scripts/catalog-clothes.ts fixture [--dry-run]
 *
 * `scan` reads the 4 GB listings file once, as it downloads, and keeps the
 * best-reviewed garments of every Women's and Men's clothing category in
 * .abo-cache/amazon-clothes-scan.json (not committed). Everything after it
 * works from that file.
 */

const SOURCE = "https://mcauleylab.ucsd.edu/public_datasets/data/amazon_2023/raw/meta_categories/meta_Clothing_Shoes_and_Jewelry.jsonl.gz";
const CACHE = ".abo-cache";
export const CLOTHES_SCAN = path.join(CACHE, "amazon-clothes-scan.json");
/** The ASINs that go on to the review pass. */
export const CLOTHES_SHORTLIST = path.join(CACHE, "amazon-clothes-shortlist.json");
/** What the review pass found for them (scripts/amazon-reviews.ts --asins … --out …). */
export const CLOTHES_REVIEWS = path.join(CACHE, "amazon-reviews-clothes.json");
/** The kinds, in the order the Clothing range shows them. */
export const CLOTHES_KINDS: readonly CapsuleKind[] = ["TOP", "SHIRT", "KNIT", "TROUSERS", "SKIRT", "DRESS", "COAT", "JACKET"];
/** How many listings each category path keeps, the most rated first. */
const KEEP_PER_PATH = 160;

const out = (line = "") => process.stdout.write(`${line}\n`);

/** A listing as the scan keeps it: what a product page needs, nothing about anyone. */
export type ScannedListing = {
  asin: string;
  title: string;
  store: string;
  categories: string[];
  details: Record<string, string>;
  features: string[];
  description: string[];
  price: number | null;
  averageRating: number;
  ratingNumber: number;
  images: { variant: string; url: string }[];
};

type RawListing = {
  title?: string;
  store?: string | null;
  categories?: string[];
  details?: Record<string, unknown>;
  features?: string[];
  description?: string[];
  price?: number | string | null;
  average_rating?: number;
  rating_number?: number;
  images?: { variant?: string; hi_res?: string | null; large?: string | null }[];
  parent_asin?: string;
};

/** Women's or Men's clothing, the only lines worth parsing (the file writes JSON with ", " between items). */
const CLOTHING_LINE = /"categories": \["Clothing, Shoes & Jewelry", "(Women|Men)", "Clothing"/;
/** The details a shop page can use; the rest (ASIN, ranks, dates, manufacturer codes) are left. */
const USEFUL_DETAIL = /department|material|fabric|care|closure|neck|collar|sleeve|length|fit|style|pattern|rise|leg|lining|origin/i;

function keep(raw: RawListing): ScannedListing | null {
  const store = (raw.store ?? "").trim();
  const images = (raw.images ?? [])
    .map((image) => ({ variant: image.variant ?? "", url: image.hi_res ?? image.large ?? "" }))
    .filter((image) => image.url.startsWith("https://m.media-amazon.com/images/I/"));
  if (store === "" || raw.parent_asin === undefined || raw.title === undefined) return null;
  if ((raw.rating_number ?? 0) < 100 || (raw.average_rating ?? 0) < 3.8) return null;
  if (images.length < 3 || images[0]!.variant !== "MAIN") return null;
  const price = typeof raw.price === "number" ? raw.price : Number.parseFloat(String(raw.price ?? ""));
  return {
    asin: raw.parent_asin,
    title: raw.title.trim(),
    store,
    categories: raw.categories ?? [],
    details: Object.fromEntries(
      Object.entries(raw.details ?? {})
        .filter(([key, value]) => USEFUL_DETAIL.test(key) && typeof value === "string" && value.length <= 120)
        .map(([key, value]) => [key, value as string]),
    ),
    features: (raw.features ?? []).slice(0, 10).map((feature) => feature.slice(0, 400)),
    description: (raw.description ?? []).slice(0, 2).map((text) => text.slice(0, 600)),
    price: Number.isFinite(price) && price > 0 ? price : null,
    averageRating: raw.average_rating ?? 0,
    ratingNumber: raw.rating_number ?? 0,
    images: images.slice(0, 7),
  };
}

async function scan(file: string | undefined) {
  let input: NodeJS.ReadableStream;
  if (file !== undefined && existsSync(file)) input = createReadStream(file);
  else {
    const response = await fetch(SOURCE);
    if (!response.ok || response.body === null) throw new Error(`download: ${response.status}`);
    out(`Amazon Reviews 2023 listings, Clothing, Shoes and Jewelry: ${(Number(response.headers.get("content-length") ?? 0) / 1e9).toFixed(2)} GB, read once as it downloads.`);
    input = Readable.fromWeb(response.body as import("node:stream/web").ReadableStream);
  }
  const lines = createInterface({ input: input.pipe(createGunzip()), crlfDelay: Infinity });
  const byPath = new Map<string, ScannedListing[]>();
  const counts = new Map<string, number>();
  let read = 0;
  let clothing = 0;
  const started = Date.now();
  for await (const line of lines) {
    read += 1;
    if (read % 500_000 === 0) out(`  ${(read / 1e6).toFixed(1)} M listings read, ${clothing} garments kept so far, ${Math.round((Date.now() - started) / 1000)} s`);
    if (!CLOTHING_LINE.test(line)) continue;
    const listing = keep(JSON.parse(line) as RawListing);
    if (listing === null) continue;
    const key = listing.categories.slice(1, 5).join(" > ");
    counts.set(key, (counts.get(key) ?? 0) + 1);
    const list = byPath.get(key) ?? [];
    list.push(listing);
    clothing += 1;
    // A bounded list per path: once it doubles, only the most rated half stays.
    if (list.length > KEEP_PER_PATH * 2) list.sort((a, b) => b.ratingNumber - a.ratingNumber).splice(KEEP_PER_PATH);
    byPath.set(key, list);
  }
  const candidates = [...byPath.values()].flatMap((list) => list.sort((a, b) => b.ratingNumber - a.ratingNumber).slice(0, KEEP_PER_PATH));
  await mkdir(CACHE, { recursive: true });
  await writeFile(CLOTHES_SCAN, JSON.stringify({ source: SOURCE, read, counts: Object.fromEntries([...counts].sort((a, b) => b[1] - a[1])), candidates }));
  out(`${read} listings read in ${Math.round((Date.now() - started) / 1000)} s; ${clothing} garments passed, ${candidates.length} kept over ${counts.size} categories in ${CLOTHES_SCAN}.`);
}

/** A scanned listing the shop could sell, with its kind, its printed name and who it is for. */
export type Candidate = ScannedListing & { kind: CapsuleKind; name: string; department: Department };

/** What the scan kept, read back. */
async function scanned(): Promise<ScannedListing[]> {
  if (!existsSync(CLOTHES_SCAN)) throw new Error(`${CLOTHES_SCAN} is missing: run \`catalog-clothes.ts scan\` first.`);
  return (JSON.parse(await readFile(CLOTHES_SCAN, "utf8")) as { candidates: ScannedListing[] }).candidates;
}

/**
 * The listings the shop could sell, by kind, the most rated first: each with
 * a kind, a printable name and a department, one per brand and name (the
 * same garment is often listed twice).
 */
export function shortlist(listings: readonly ScannedListing[]): Map<CapsuleKind, Candidate[]> {
  const byKind = new Map<CapsuleKind, Candidate[]>();
  const seen = new Set<string>();
  for (const listing of [...listings].sort((a, b) => b.ratingNumber - a.ratingNumber)) {
    if (EXCLUDED_LISTINGS.has(listing.asin)) continue;
    const kind = clothesKindFor(listing.categories, listing.title);
    if (kind === null) continue;
    const name = cleanClothesTitle(listing.title, listing.store, kind);
    const department = departmentOf(listing.categories, listing.details);
    if (name === null || department === null) continue;
    // One piece per name in a kind: two "Hawaiian Shirt"s from two brands read as one listed twice.
    const key = `${kind}|${name.toLowerCase()}`;
    if (seen.has(key) || seen.has(listing.asin)) continue;
    seen.add(key);
    seen.add(listing.asin);
    const list = byKind.get(kind) ?? [];
    list.push({ ...listing, kind, name, department });
    byKind.set(kind, list);
  }
  return byKind;
}

/** How many of each kind go on to the review pass: enough that the photo check and the brand cap can still fill every quota. */
const SHORTLIST_PER_KIND = 140;

async function candidates() {
  const byKind = shortlist(await scanned());
  const asins: string[] = [];
  for (const kind of CLOTHES_KINDS) {
    const list = byKind.get(kind) ?? [];
    // Women's and men's pieces in turn where the kind has both, so neither runs out at the review pass.
    const women = list.filter((entry) => entry.department === "women");
    const men = list.filter((entry) => entry.department === "men");
    const mixed: Candidate[] = [];
    for (let index = 0; mixed.length < SHORTLIST_PER_KIND && (index < women.length || index < men.length); index += 1) {
      if (index < women.length) mixed.push(women[index]!);
      if (index < men.length && mixed.length < SHORTLIST_PER_KIND) mixed.push(men[index]!);
    }
    out(`  ${kind.padEnd(9)} ${String(list.length).padStart(5)} sellable, ${mixed.length} shortlisted (${women.length} women's, ${men.length} men's)`);
    asins.push(...mixed.map((entry) => entry.asin));
  }
  await writeFile(CLOTHES_SHORTLIST, JSON.stringify({ asins }));
  out(`${asins.length} listings shortlisted in ${CLOTHES_SHORTLIST}; next: scripts/amazon-reviews.ts --run --asins ${CLOTHES_SHORTLIST} --out ${CLOTHES_REVIEWS}`);
}

/** How many of each kind the Clothing range carries: 124 garments, about as many as a small shop's floor (George, 2026-10-05: the 24 replaced and about 100 more). */
export const CLOTHES_QUOTAS: Readonly<Record<CapsuleKind, number>> = { TOP: 18, SHIRT: 16, KNIT: 18, TROUSERS: 18, SKIRT: 12, DRESS: 18, COAT: 12, JACKET: 12 };
/** No brand fills a rail: at most this many pieces from one. */
const PER_BRAND = 4;
/** Photographs per garment: the front, and the views a shopper turns it round to see. */
const IMAGES = 5;
const REVIEWS_SHOWN = 8;
/** Pieces need this many reviews to be chosen: enough that the block and the fit note mean something. */
const MIN_REVIEWS = 20;
const SPECIMEN_IMAGES = "public/products/clothes";
/** The tests' shelf: at least one of every kind, a men's shirt among them (the e2e's piece). */
const SPECIMEN_QUOTAS: Readonly<Record<CapsuleKind, number>> = { TOP: 1, SHIRT: 2, KNIT: 2, TROUSERS: 2, SKIRT: 1, DRESS: 2, COAT: 1, JACKET: 1 };

export const CLOTHES_FIXTURE = "src/lib/catalog/fixtures/amazon-clothes.json";
export const CLOTHES_SPECIMEN_FIXTURE = "src/lib/catalog/fixtures/clothes-specimen.json";
export const CLOTHES_REVIEWS_FIXTURE = "src/lib/catalog/fixtures/amazon-clothes-reviews.json";
export const CLOTHES_LICENSE = "Amazon Reviews 2023 research release";
export const CLOTHES_ATTRIBUTION =
  "Product listing and photographs from Amazon.com, via the Amazon Reviews 2023 dataset (Y. Hou, J. Li, Z. He, A. Yan, X. Chen, J. McAuley, McAuley Lab, UC San Diego, 2024), a research release; shown for an academic project. Prices are the shop's own.";

/** An Amazon image at a smaller size: the CDN serves any long edge asked for in the name ("._AC_UL320_"). */
const sized = (url: string, edge: number) => url.replace(/\._[^/]*_\.(jpg|png)$/i, `._AC_UL${edge}_.$1`);

/** A thumbnail's verdict and its colour, read once. */
async function look(url: string, kind: CapsuleKind): Promise<{ studio: boolean; colour: ColorId | null } | null> {
  const { default: sharp } = await import("sharp");
  const response = await fetch(sized(url, 320)).catch(() => null);
  if (response === null || !response.ok) return null;
  const image = sharp(Buffer.from(await response.arrayBuffer())).flatten({ background: "#ffffff" });
  const size = 48;
  const { data } = await image.clone().resize(size, size, { fit: "fill" }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  // The colour is read where the kind is worn (GARMENT_CROP), on a 100 × 100 copy of the frame.
  const [left, top, width, height] = GARMENT_CROP[kind].map((fraction) => Math.round(fraction * 100));
  const crop = await image.clone().resize(100, 100, { fit: "fill" }).extract({ left: left!, top: top!, width: width!, height: height! }).removeAlpha().raw().toBuffer();
  return { studio: isGarmentStudioShot(data, size), colour: garmentColour(pixelsFrom(crop, 3, 1)) };
}

/** A photograph's width and height, from its thumbnail. */
async function shapeOf(url: string): Promise<{ width: number; height: number } | null> {
  const { default: sharp } = await import("sharp");
  const response = await fetch(sized(url, 320)).catch(() => null);
  if (response === null || !response.ok) return null;
  const meta = await sharp(Buffer.from(await response.arrayBuffer())).metadata();
  return meta.width === undefined || meta.height === undefined ? null : { width: meta.width, height: meta.height };
}

/** The reviews kept for a piece: the totals as they are, the most helpful few, as their writers typed them (escapes decoded). */
const shown = (entry: AmazonProductReviews): AmazonProductReviews => decodedReviews({ ...entry, reviews: entry.reviews.slice(0, REVIEWS_SHOWN) });

async function fixture(options: { dryRun: boolean }) {
  if (!existsSync(CLOTHES_REVIEWS)) throw new Error(`${CLOTHES_REVIEWS} is missing: run the review pass first (see \`catalog-clothes.ts candidates\`).`);
  const found = (JSON.parse(await readFile(CLOTHES_REVIEWS, "utf8")) as { products: Record<string, AmazonProductReviews> }).products;
  const byKind = shortlist(await scanned());
  const shortlisted = new Set((JSON.parse(await readFile(CLOTHES_SHORTLIST, "utf8")) as { asins: string[] }).asins);

  const products: ProductInput[] = [];
  const reviews: Record<string, AmazonProductReviews> = {};
  type Chosen = { entry: Candidate; brand: string; colour: ColorId | null };
  const brands = new Map<string, number>();
  let refused = 0;
  for (const kind of CLOTHES_KINDS) {
    // Shortlisted, reviewed pieces only, the most reviewed first; women's and men's in turn where the kind has both.
    const pool = (byKind.get(kind) ?? [])
      .filter((entry) => shortlisted.has(entry.asin) && (found[entry.asin]?.count ?? 0) >= MIN_REVIEWS && (found[entry.asin]?.reviews.length ?? 0) >= 3)
      .sort((a, b) => found[b.asin]!.count - found[a.asin]!.count);
    const queues = { women: pool.filter((entry) => entry.department === "women"), men: pool.filter((entry) => entry.department === "men") };
    const quota = CLOTHES_QUOTAS[kind];
    const menShare = queues.men.length === 0 ? 0 : 0.5;
    const accepted: Candidate[] = [];
    const chosen: Chosen[] = [];
    while (accepted.length < quota && (queues.women.length > 0 || queues.men.length > 0)) {
      const menSoFar = accepted.filter((entry) => entry.department === "men").length;
      const wantMen = queues.men.length > 0 && (queues.women.length === 0 || menSoFar < Math.round((accepted.length + 1) * menShare));
      const entry = (wantMen ? queues.men : queues.women).shift()!;
      const brand = canonicalBrand(entry.store) ?? entry.store;
      if ((brands.get(brand) ?? 0) >= PER_BRAND) continue;
      if (options.dryRun) {
        accepted.push(entry);
        continue;
      }
      const seen = await look(entry.images[0]!.url, kind);
      if (seen === null || !seen.studio) {
        refused += 1;
        continue;
      }
      // The gallery: the main photograph, then the extras shaped like garment photographs (not the brand's size charts).
      const extras: ScannedListing["images"] = [];
      for (const image of entry.images.slice(1)) {
        if (extras.length === IMAGES - 1) break;
        const shape = await shapeOf(image.url);
        if (shape !== null && isGarmentPhotoShape(shape.width, shape.height)) extras.push(image);
      }
      if (extras.length < 2) {
        refused += 1;
        continue;
      }
      brands.set(brand, (brands.get(brand) ?? 0) + 1);
      accepted.push(entry);
      chosen.push({ entry: { ...entry, images: [entry.images[0]!, ...extras] }, brand, colour: titleColours(entry.title, entry.store)[0] ?? seen.colour });
    }
    // Prices once the kind is chosen: each piece's place in its kind's band follows its listing price among them.
    const ranks = priceRanks(chosen.map(({ entry }) => ({ id: entry.asin, usd: entry.price })));
    for (const { entry, brand, colour } of chosen) {
      const fabric = fabricOf(entry.features);
      const care = careOf(entry.features);
      const variants = CAPSULE_SIZES.map((size) => ({ size, stock: capsuleStock(entry.asin, size), priceCents: null }));
      const label = `${entry.name} by ${brand}`;
      products.push({
        source: "amazon",
        sourceId: entry.asin,
        slug: productSlug(entry.name, entry.asin),
        kind,
        category: "wear",
        titleEn: entry.name,
        titleEl: null,
        brand,
        descriptionEn: null,
        descriptionEl: null,
        highlightsEn: clothesHighlights(entry.features),
        highlightsEl: null,
        translation: "none",
        colorLabel: colour === null ? null : colorLabel(colour, "en"),
        colors: colour === null ? [] : [colour],
        materials: fabric?.materials ?? [],
        attributes: {
          department: entry.department,
          ...(fabric === null ? {} : { fabric: fabric.line }),
          ...(care === null ? {} : { care }),
        },
        dimsCm: null,
        weightGrams: null,
        priceCents: clothesPriceCents(ranks.get(entry.asin)!, CAPSULE_PRODUCT_KINDS[kind]!.bands),
        compareAtCents: null,
        stock: variants.reduce((sum, variant) => sum + variant.stock, 0),
        variants,
        license: CLOTHES_LICENSE,
        attribution: CLOTHES_ATTRIBUTION,
        media: entry.images.slice(0, IMAGES).map((image, at) => ({
          kind: "image" as const,
          src: image.url,
          width: null,
          height: null,
          bytes: null,
          altEn: at === 0 ? label : `${label}, view ${at + 1}`,
          whiteGround: at === 0,
        })),
      });
      reviews[entry.asin] = shown(found[entry.asin]!);
    }
    const men = accepted.filter((entry) => entry.department === "men").length;
    out(`  ${kind.padEnd(9)} ${String(pool.length).padStart(4)} reviewed candidates, ${accepted.length} chosen (${accepted.length - men} women's, ${men} men's)`);
    if (options.dryRun) for (const entry of accepted) out(`      ${entry.department[0]} ${String(found[entry.asin]!.count).padStart(6)}  ${entry.name.padEnd(MAX_TITLE)}  ${entry.store}`);
  }
  if (options.dryRun) {
    out("--dry-run: no photograph checked, nothing written.");
    return;
  }

  products.sort((a, b) => CLOTHES_KINDS.indexOf(a.kind as CapsuleKind) - CLOTHES_KINDS.indexOf(b.kind as CapsuleKind) || a.sourceId.localeCompare(b.sourceId));
  const description = `Clothing: ${products.length} garments from Amazon.com's listings in Amazon Reviews 2023 (a research release), in sizes XS–XL. Photographs are served from Amazon's image CDN through the shop's image optimizer. Rebuilt by \`pnpm exec tsx scripts/catalog-clothes.ts fixture\` (docs/adr/062).`;
  catalogFixtureSchema.parse({ version: 1, description, products });
  await writeFile(CLOTHES_FIXTURE, `{"version":1,"description":${JSON.stringify(description)},"products":[\n${products.map((product) => JSON.stringify(product)).join(",\n")}\n]}\n`);

  const reviewsFixture = amazonReviewsFixtureSchema.parse({ version: 1, citation: AMAZON_REVIEWS_CITATION, products: reviews });
  const ids = Object.keys(reviewsFixture.products).sort();
  await writeFile(CLOTHES_REVIEWS_FIXTURE, `{"version":1,"citation":${JSON.stringify(AMAZON_REVIEWS_CITATION)},"products":{\n${ids.map((id) => `${JSON.stringify(id)}:${JSON.stringify(reviewsFixture.products[id])}`).join(",\n")}\n}}\n`);
  const shownCount = ids.reduce((sum, id) => sum + reviewsFixture.products[id]!.reviews.length, 0);
  const total = ids.reduce((sum, id) => sum + reviewsFixture.products[id]!.count, 0);
  out(`  ${products.length} garments written to ${CLOTHES_FIXTURE} (${refused} refused: main photograph not on white, or fewer than three garment photographs); reviews of all of them (${total} in total, ${shownCount} shown) in ${CLOTHES_REVIEWS_FIXTURE}`);
  await clothesSpecimen(products);
}

/** The tests' shelf: a few of every kind, their photographs re-encoded into public/ so the tests need no network. */
async function clothesSpecimen(products: ProductInput[]): Promise<void> {
  const { default: sharp } = await import("sharp");
  await rm(SPECIMEN_IMAGES, { recursive: true, force: true });
  await mkdir(SPECIMEN_IMAGES, { recursive: true });
  const chosen: ProductInput[] = [];
  for (const kind of CLOTHES_KINDS) {
    const ofKind = products.filter((product) => product.kind === kind);
    // A men's shirt first among the shirts: the e2e buys one in M.
    if (kind === "SHIRT") ofKind.sort((a, b) => Number(b.attributes.department === "men") - Number(a.attributes.department === "men"));
    chosen.push(...ofKind.slice(0, SPECIMEN_QUOTAS[kind]));
  }
  const specimen: ProductInput[] = [];
  for (const product of chosen) {
    const media: MediaInput[] = [];
    for (const [at, entry] of product.media.slice(0, 2).entries()) {
      const response = await fetch(sized(entry.src, 1200));
      if (!response.ok) throw new Error(`${response.status} for ${entry.src}`);
      const file = `${product.sourceId.toLowerCase()}${at === 0 ? "" : `-${at + 1}`}.webp`;
      const { data, info } = await sharp(Buffer.from(await response.arrayBuffer())).flatten({ background: "#ffffff" }).resize(1200, 1200, { fit: "inside", withoutEnlargement: true }).webp({ quality: 82 }).toBuffer({ resolveWithObject: true });
      await writeFile(path.join(SPECIMEN_IMAGES, file), data);
      media.push({ ...entry, src: `/products/clothes/${file}`, width: info.width, height: info.height, bytes: data.byteLength });
    }
    specimen.push({ ...product, media });
  }
  const fixture = catalogFixtureSchema.parse({
    version: 1,
    description: "Clothes specimen: twelve garments from Amazon Reviews 2023's listings, photographs in public/products/clothes, for the tests (docs/adr/062).",
    products: specimen,
  });
  await writeFile(CLOTHES_SPECIMEN_FIXTURE, `${JSON.stringify(fixture, null, 2)}\n`);
  out(`  ${specimen.length} garments written to ${CLOTHES_SPECIMEN_FIXTURE}, photographs in ${SPECIMEN_IMAGES}`);
}

async function main() {
  const { positionals, values } = parseArgs({ allowPositionals: true, options: { file: { type: "string" }, "dry-run": { type: "boolean", default: false } } });
  switch (positionals[0]) {
    case "scan":
      return scan(values.file);
    case "candidates":
      return candidates();
    case "fixture":
      return fixture({ dryRun: values["dry-run"] });
    default:
      out("Usage: catalog-clothes.ts scan [--file <copy>] | candidates | fixture [--dry-run]");
  }
}

// Run as a command only: scripts/catalog.ts imports the fixture paths from here.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    process.stderr.write(`[catalog-clothes] ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
    process.exitCode = 1;
  });
}
