/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Fetches product photography for the design specimen from the Amazon Berkeley Objects dataset.
 */

/**
 * Fetches real product photography for the design specimen from the Amazon
 * Berkeley Objects dataset (ABO).
 *
 *   node scripts/fetch-specimen-images.mjs [--limit 16] [--dry-run]
 *
 * Why ABO rather than a stock-photo site: the plinth treatment in
 * docs/PLAN.md 4.4 depends on `mix-blend-mode: multiply` dissolving a white
 * studio background into the plinth. Lifestyle photography — which is what
 * Unsplash and Pexels mostly offer — has its own backgrounds and would sit on
 * the plinth as a visible rectangle, which is precisely the "card" look the
 * design exists to avoid. ABO is catalogue photography on white, which is the
 * shape the design was drawn for. It is also the dataset Phase 3 imports, so
 * this script is a small, honest rehearsal of that import.
 *
 * Licence: ABO is CC BY-NC 4.0 — free to use with attribution, non-commercial
 * only, which is exactly what a capstone is. Attribution is emitted into the
 * generated catalogue and belongs on the credits page built in Phase 3.
 *
 * The full image archive is 3.2 GB and is never downloaded (plan, Phase 3
 * step 2): only the metadata and the handful of images actually used.
 */

import { createWriteStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createGunzip } from "node:zlib";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { existsSync } from "node:fs";
import path from "node:path";

import sharp from "sharp";

const BUCKET = "https://amazon-berkeley-objects.s3.amazonaws.com";
const CACHE = ".abo-cache";
const IMAGE_DIR = "public/products";
const CATALOG = "src/lib/specimen/catalog.ts";

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
/**
 * --keep-existing: keep every product already in the specimen and replace only
 * the excluded ones, each with a product from the same category. A full rerun
 * reselects everything (which listings pass the photograph checks shifts the
 * whole selection), and the design review and its screenshots depend on this
 * set staying put.
 */
const KEEP_EXISTING = args.includes("--keep-existing");
const LIMIT = Number.parseInt(
  args[args.indexOf("--limit") + 1] ?? "16",
  10,
);

/**
 * Categories worth showing in a window display, with the price band used to
 * synthesise a price. ABO carries no prices, so they are generated from
 * documented per-category rules (plan, Phase 3 step 2) and derived
 * deterministically from the item id, so a rerun does not reshuffle them.
 */
const CATEGORIES = {
  CHAIR: { slug: "seating", label: "Seating", min: 12000, max: 78000 },
  SOFA: { slug: "seating", label: "Seating", min: 45000, max: 190000 },
  OTTOMAN: { slug: "seating", label: "Seating", min: 8000, max: 34000 },
  STOOL_SEATING: { slug: "seating", label: "Seating", min: 4500, max: 21000 },
  TABLE: { slug: "tables", label: "Tables", min: 9000, max: 65000 },
  LAMP: { slug: "lighting", label: "Lighting", min: 3500, max: 26000 },
  LIGHT_FIXTURE: { slug: "lighting", label: "Lighting", min: 6000, max: 39000 },
  RUG: { slug: "rugs", label: "Rugs", min: 4500, max: 42000 },
};

/** How many of each to take, so the grid is not all chairs. */
const QUOTA = {
  CHAIR: 8,
  SOFA: 4,
  TABLE: 7,
  LAMP: 7,
  LIGHT_FIXTURE: 5,
  RUG: 4,
  OTTOMAN: 3,
  STOOL_SEATING: 3,
};

/* -------------------------------------------------------------------------- */

async function download(url, destination) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} for ${url}`);
  await pipeline(Readable.fromWeb(response.body), createWriteStream(destination));
}

async function cached(name, url) {
  const file = path.join(CACHE, name);
  if (existsSync(file)) return file;
  await mkdir(CACHE, { recursive: true });
  process.stdout.write(`downloading ${name}\n`);
  await download(url, file);
  return file;
}

async function gunzipToString(file) {
  const chunks = [];
  await pipeline(
    (await import("node:fs")).createReadStream(file),
    createGunzip(),
    async function* (source) {
      for await (const chunk of source) chunks.push(chunk);
    },
  );
  return Buffer.concat(chunks).toString("utf8");
}

/** ABO is multi-marketplace; only English listings are usable here. */
function englishValue(entries) {
  if (!Array.isArray(entries)) return undefined;
  const english = entries.find((entry) =>
    typeof entry.language_tag === "string" && entry.language_tag.startsWith("en"),
  );
  return english?.value;
}

/**
 * ABO titles are long and carry marketplace boilerplate. Strip the retailer
 * prefix and anything after the first comma, which is usually a size or colour
 * repetition already shown elsewhere on the tile.
 */
function cleanTitle(raw, brand) {
  let title = raw
    .replace(/^Amazon\s*(Brand|Basics)?\s*[-–—]\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();

  // The brand has its own line on the tile, so repeating it in the title just
  // eats the two lines the name is allowed (4.4).
  if (brand !== undefined && brand !== "") {
    const escaped = brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    title = title.replace(new RegExp(`^${escaped}\\s*[-–—,]?\\s*`, "i"), "");
  }

  // Model numbers and SKU fragments: "MH103137", "B07X2K9". They carry no
  // meaning for a shopper and eat the two lines a name is allowed.
  title = title
    .replace(/\b(?=[A-Z0-9-]*\d)(?=[A-Z0-9-]*[A-Z])[A-Z0-9][A-Z0-9-]{4,}\b/g, "")
    .replace(/\s*[-–—]\s*(?=[-–—]|$)/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();

  // Everything after the first comma is size or colour, which the tile shows
  // elsewhere: "Emerly Modern Sofa, 83.5\"W, Steel Grey".
  const comma = title.indexOf(",");
  if (comma > 12) title = title.slice(0, comma);

  // Trim at a word boundary rather than mid-word.
  if (title.length > 52) {
    const cut = title.slice(0, 52);
    title = cut.slice(0, cut.lastIndexOf(" ")).trimEnd();
  }

  title = title
    .replace(/\s*\(.*$/, "")
    // Trailing punctuation left behind by truncation.
    .replace(/[\s\-–—,:;|/]+$/, "")
    .trim();

  // Some marketplaces list in capitals. Part 4.6 forbids all-caps outright —
  // and in Greek it strips the accents — so anything shouting is title-cased.
  const letters = title.replace(/[^A-Za-z]/g, "");
  const isShouting =
    letters.length > 4 && letters === letters.toUpperCase();
  if (isShouting) {
    title = title
      .toLowerCase()
      .replace(/\b[a-z]/g, (character) => character.toUpperCase());
  }

  return title.charAt(0).toUpperCase() + title.slice(1);
}

/**
 * Listings whose photography passed every automatic check but is not a
 * product photograph. Keep in step with EXCLUDED_ABO_ITEMS in
 * src/lib/catalog/abo.ts.
 *
 *   B089LB7TJC  the only image is the AmazonBasics logo on white
 */
const EXCLUDED_ITEMS = new Set(["B089LB7TJC"]);

/** Fabric swatches, spare parts and replacement covers are not products here. */
const NOT_A_PRODUCT = /\b(swatch|replacement|spare part|slipcover only|sample)\b/i;

/** Stable pseudo-random number in [0,1) from a string. */
function hashUnit(text) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) % 100000) / 100000;
}

function priceFor(itemId, category) {
  const unit = hashUnit(itemId);
  const raw = category.min + unit * (category.max - category.min);
  // Round to a plausible retail figure: whole euros, ending in 0 or 9.
  const euros = Math.round(raw / 100);
  const rounded = euros < 100 ? Math.round(euros / 5) * 5 : Math.round(euros / 10) * 10;
  return Math.max(category.min, rounded * 100 - 100);
}

/**
 * Confirms the photograph really is on a white ground. `mix-blend-mode:
 * multiply` turns a non-white background into a dark rectangle on the plinth,
 * so an image that fails this check would quietly break the design.
 */
async function hasWhiteBackground(buffer) {
  const size = 48;
  const { data } = await sharp(buffer)
    .resize(size, size, { fit: "fill" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  // Measure the *proportion* of near-white border pixels, not their mean.
  // A mean is fooled both ways: a catalogue shot where the product reaches the
  // frame edge (a wide table, an ottoman) scores low despite a white ground,
  // while a pale full-bleed photograph scores high with no white ground at all.
  // What the plinth blend actually needs is that most of the border is white.
  let white = 0;
  let count = 0;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const onBorder = x < 3 || y < 3 || x >= size - 3 || y >= size - 3;
      if (!onBorder) continue;
      const i = (y * size + x) * 3;
      const isNeutral =
        Math.max(data[i], data[i + 1], data[i + 2]) -
          Math.min(data[i], data[i + 1], data[i + 2]) <
        12;
      const isBright = (data[i] + data[i + 1] + data[i + 2]) / 3 >= 240;
      if (isNeutral && isBright) white += 1;
      count += 1;
    }
  }
  return count > 0 && white / count >= 0.85;
}

/* -------------------------------------------------------------------------- */

async function main() {
  const listingsFile = await cached(
    "listings_0.json.gz",
    `${BUCKET}/listings/metadata/listings_0.json.gz`,
  );
  const imagesFile = await cached(
    "images.csv.gz",
    `${BUCKET}/images/metadata/images.csv.gz`,
  );

  process.stdout.write("reading image index\n");
  const imageIndex = new Map();
  const imagesCsv = await gunzipToString(imagesFile);
  for (const line of imagesCsv.split("\n").slice(1)) {
    const [imageId, height, width, imagePath] = line.split(",");
    if (imageId === undefined || imagePath === undefined) continue;
    imageIndex.set(imageId, {
      path: imagePath.trim(),
      width: Number(width),
      height: Number(height),
    });
  }

  let existing = [];
  const need = {};
  if (KEEP_EXISTING) {
    const source = await readFile(CATALOG, "utf8");
    const start = source.indexOf("SPECIMEN_CATALOG: SpecimenProduct[] = ");
    existing = JSON.parse(source.slice(source.indexOf("= [", start) + 2, source.lastIndexOf("]") + 1));
    for (const entry of existing) {
      if (EXCLUDED_ITEMS.has(entry.id)) need[entry.category] = (need[entry.category] ?? 0) + 1;
    }
    if (Object.keys(need).length === 0) {
      process.stdout.write("--keep-existing: no excluded products in the specimen; nothing to replace.\n");
      return;
    }
    process.stdout.write(`--keep-existing: replacing ${JSON.stringify(need)}\n`);
  }
  const existingIds = new Set(existing.map((entry) => entry.id));

  process.stdout.write("selecting products\n");
  const listings = await gunzipToString(listingsFile);
  const taken = {};
  const chosen = [];

  for (const line of listings.split("\n")) {
    if (line.trim() === "") continue;
    let listing;
    try {
      listing = JSON.parse(line);
    } catch {
      continue;
    }

    const type = listing.product_type?.[0]?.value;
    const category = CATEGORIES[type];
    if (category === undefined) continue;
    if (EXCLUDED_ITEMS.has(listing.item_id)) continue;
    if (KEEP_EXISTING) {
      if (existingIds.has(listing.item_id) || (need[category.slug] ?? 0) === 0) continue;
      // A margin of candidates, because some will fail the white-ground check.
      if (chosen.filter((item) => item.category.slug === category.slug).length >= need[category.slug] * 8) continue;
    } else if ((taken[type] ?? 0) >= (QUOTA[type] ?? 0)) {
      continue;
    }

    const rawTitle = englishValue(listing.item_name);
    const rawBrand = englishValue(listing.brand);
    if (rawTitle === undefined || rawBrand === undefined) continue;
    if (NOT_A_PRODUCT.test(rawTitle)) continue;

    const brand = rawBrand.replace(/^Amazon\s*Brand\s*[-–—]?\s*/i, "").trim() || "Vitrine";
    const title = cleanTitle(rawTitle, brand);
    if (title.length < 8) continue;

    const main = imageIndex.get(listing.main_image_id);
    if (main === undefined || main.width < 900) continue;

    // A second angle drives the hover swap on the tile (4.4).
    const otherId = (listing.other_image_id ?? []).find((id) => {
      const entry = imageIndex.get(id);
      return entry !== undefined && entry.width >= 900;
    });

    chosen.push({
      itemId: listing.item_id,
      type,
      category,
      title,
      brand,
      colour: englishValue(listing.color) ?? null,
      main,
      other: otherId === undefined ? null : imageIndex.get(otherId),
    });
    taken[type] = (taken[type] ?? 0) + 1;

    if (!KEEP_EXISTING && chosen.length >= LIMIT) break;
  }

  process.stdout.write(`selected ${chosen.length} products:\n`);
  for (const item of chosen) {
    process.stdout.write(
      `  ${item.type.padEnd(16)} ${item.brand.padEnd(18)} ${item.title}\n`,
    );
  }

  if (DRY_RUN) {
    process.stdout.write("\n--dry-run: no images downloaded.\n");
    return;
  }

  await mkdir(IMAGE_DIR, { recursive: true });
  const catalogue = [];

  for (const item of chosen) {
    if (KEEP_EXISTING && catalogue.filter((entry) => entry.category === item.category.slug).length >= need[item.category.slug]) continue;
    const files = {};
    let usable = true;

    for (const [role, entry] of [
      ["main", item.main],
      ["other", item.other],
    ]) {
      if (entry === null || entry === undefined) continue;

      // Reruns are common while tuning titles and selection rules; there is no
      // reason to pull the same photograph from the dataset again.
      const existing = path.join(
        IMAGE_DIR,
        `${item.itemId.toLowerCase()}${role === "other" ? "-b" : ""}.webp`,
      );
      if (existsSync(existing)) {
        const meta = await sharp(existing).metadata();
        files[role] = {
          src: `/products/${path.basename(existing)}`,
          width: meta.width,
          height: meta.height,
        };
        continue;
      }

      const response = await fetch(`${BUCKET}/images/original/${entry.path}`);
      if (!response.ok) {
        if (role === "main") usable = false;
        continue;
      }
      const buffer = Buffer.from(await response.arrayBuffer());

      if (role === "main" && !(await hasWhiteBackground(buffer))) {
        process.stdout.write(`  skipped ${item.title} (background is not white)\n`);
        usable = false;
        break;
      }

      const name = `${item.itemId.toLowerCase()}${role === "other" ? "-b" : ""}.webp`;
      // 1100px is comfortably above the largest rendered tile at 2x, and WebP
      // keeps each file around 60-90 KB rather than the 400 KB original JPEG.
      const output = await sharp(buffer)
        .resize(1100, 1100, { fit: "inside", withoutEnlargement: true })
        .flatten({ background: "#ffffff" })
        .webp({ quality: 82 })
        .toBuffer();

      await writeFile(path.join(IMAGE_DIR, name), output);
      const meta = await sharp(output).metadata();
      files[role] = { src: `/products/${name}`, width: meta.width, height: meta.height };
    }

    if (!usable || files.main === undefined) continue;

    catalogue.push({
      id: item.itemId,
      slug: `${item.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}-${item.itemId.slice(-4).toLowerCase()}`,
      title: item.title,
      brand: item.brand,
      category: item.category.slug,
      categoryLabel: item.category.label,
      colour: item.colour,
      priceCents: priceFor(item.itemId, item.category),
      image: files.main,
      hoverImage: files.other ?? null,
    });
    process.stdout.write(`  saved ${item.title}\n`);
  }

  let output = catalogue;
  if (KEEP_EXISTING) {
    // Each excluded product is replaced in place, keeping the specimen's order.
    output = existing
      .map((entry) => {
        if (!EXCLUDED_ITEMS.has(entry.id)) return entry;
        const index = catalogue.findIndex((candidate) => candidate.category === entry.category);
        return index === -1 ? null : catalogue.splice(index, 1)[0];
      })
      .filter((entry) => entry !== null);
  }

  await mkdir(path.dirname(CATALOG), { recursive: true });
  await writeFile(
    CATALOG,
    `/**
 * Specimen catalogue — generated by scripts/fetch-specimen-images.mjs.
 * Do not edit by hand; rerun the script instead.
 *
 * Product photography and metadata: Amazon Berkeley Objects (ABO), licensed
 * CC BY-NC 4.0. Non-commercial use only, which is what this capstone is.
 * https://amazon-berkeley-objects.s3.amazonaws.com/index.html
 *
 * Prices are synthetic: ABO carries no prices, so each is derived
 * deterministically from the item id within a documented per-category band
 * (docs/PLAN.md Phase 3, step 2). They are plausible, not real.
 *
 * This stands in until Phase 3 imports the full catalogue into PostgreSQL.
 */

export type SpecimenProduct = {
  id: string;
  slug: string;
  title: string;
  brand: string;
  category: string;
  categoryLabel: string;
  colour: string | null;
  /** Integer cents, EUR. Money is never a float (CLAUDE.md). */
  priceCents: number;
  image: { src: string; width: number; height: number };
  /** A second angle, revealed on hover (docs/PLAN.md 4.4). */
  hoverImage: { src: string; width: number; height: number } | null;
};

export const ATTRIBUTION =
  "Product images from the Amazon Berkeley Objects dataset, CC BY-NC 4.0.";

export const SPECIMEN_CATALOG: SpecimenProduct[] = ${JSON.stringify(output, null, 2)};
`,
    "utf8",
  );

  process.stdout.write(`\n${output.length} products written to ${CATALOG}\n`);
}

await main();
