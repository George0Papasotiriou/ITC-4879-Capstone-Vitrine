/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * The Wear capsule from the command line: draws its flat lays and writes the catalogue fixture.
 */

/**
 * The capsule (docs/adr/022).
 *
 *   pnpm capsule build [--dry-run]     draw the images and write the fixture
 *   pnpm capsule images [--dry-run]    only the images
 *   pnpm capsule fixture               only the fixture
 *
 * Everything is drawn here: no photograph is fetched, no model is called and
 * nothing costs anything. Real photography, if it is ever bought or generated,
 * replaces the files under public/products/capsule/ and nothing else changes.
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

import sharp from "sharp";

import { CANVAS, garmentSvg, type View } from "@/lib/catalog/capsule-drawing";
import { CAPSULE, capsuleSizes, sizeChartFor, type CapsulePiece } from "@/lib/catalog/capsule";
import type { ProductInput } from "@/lib/catalog/input";
import { CAPSULE_PRODUCT_KINDS } from "@/lib/catalog/taxonomy";

const IMAGE_DIR = path.join("public", "products", "capsule");
const FIXTURE = path.join("src", "lib", "catalog", "fixtures", "capsule.json");
const IMAGE_EDGE = 1100;

const { positionals, values } = parseArgs({ allowPositionals: true, options: { "dry-run": { type: "boolean", default: false } } });
const [command = "build"] = positionals;
const dryRun = values["dry-run"];

const out = (line: string) => process.stdout.write(`[capsule] ${line}\n`);

/** The product's image path as the catalogue records it. */
const imagePath = (piece: CapsulePiece, view: View) => `/products/capsule/${piece.id}${view === "folded" ? "-b" : ""}.webp`;

async function images(): Promise<void> {
  if (dryRun) {
    out(`would draw ${CAPSULE.length * 2} images (two views each) into ${IMAGE_DIR}; nothing is fetched and nothing costs anything`);
    return;
  }
  await mkdir(IMAGE_DIR, { recursive: true });
  let bytes = 0;
  for (const piece of CAPSULE) {
    for (const view of ["flat", "folded"] as const) {
      const svg = garmentSvg(piece, view);
      const webp = await sharp(Buffer.from(svg), { density: 96 })
        .resize(IMAGE_EDGE, IMAGE_EDGE, { fit: "contain", background: "#ffffff" })
        .flatten({ background: "#ffffff" })
        .webp({ quality: 86 })
        .toBuffer();
      await writeFile(path.join(IMAGE_DIR, path.basename(imagePath(piece, view))), webp);
      bytes += webp.byteLength;
    }
  }
  out(`drew ${CAPSULE.length * 2} images (${Math.round(bytes / 1024)} KB) into ${IMAGE_DIR}`);
}

/** The highlights a shopper reads: fabric, fit, care, and that the images are drawings. */
function highlights(piece: CapsulePiece, locale: "en" | "el"): string[] {
  const chart = sizeChartFor(piece.kind);
  const sizes = capsuleSizes(piece.id).filter((size) => size.stock > 0).map((size) => size.size);
  if (locale === "el") {
    return [
      piece.fabricEl,
      piece.fitEl,
      piece.careEl,
      `Μεγέθη: ${sizes.join(", ")}`,
      ...(chart === null ? [] : [`Μετρήσεις σώματος στον πίνακα μεγεθών, σε εκατοστά`]),
      "Οι εικόνες είναι σχέδια: η κάψουλα είναι δική μας και δεν φωτογραφήθηκε.",
    ];
  }
  return [
    piece.fabricEn,
    piece.fitEn,
    piece.careEn,
    `Sizes: ${sizes.join(", ")}`,
    ...(chart === null ? [] : ["Body measurements in the size chart, in centimetres"]),
    "The images are drawings: the capsule is ours, and was not photographed.",
  ];
}

function productFor(piece: CapsulePiece): ProductInput {
  const kind = CAPSULE_PRODUCT_KINDS[piece.kind]!;
  const sizes = capsuleSizes(piece.id);
  return {
    source: "capsule",
    sourceId: piece.id,
    slug: piece.id,
    kind: piece.kind,
    category: kind.category,
    titleEn: piece.titleEn,
    titleEl: piece.titleEl,
    brand: "Vitrine",
    descriptionEn: `${piece.fabricEn}. ${piece.fitEn}. ${piece.careEn}`,
    descriptionEl: `${piece.fabricEl}. ${piece.fitEl}. ${piece.careEl}`,
    highlightsEn: highlights(piece, "en"),
    highlightsEl: highlights(piece, "el"),
    // Written by hand in both languages, not machine translated (docs/adr/022).
    translation: "reviewed",
    colorLabel: piece.colorLabelEn,
    colors: [piece.color],
    materials: piece.materials,
    attributes: {
      fit: piece.fitEn,
      fabric: piece.fabricEn,
      care: piece.careEn,
      images: "Drawn, not photographed",
    },
    // Clothes are not placed in a room, and a flat lay has no depth to give.
    dimsCm: null,
    weightGrams: null,
    priceCents: piece.priceCents,
    compareAtCents: piece.compareAtCents,
    stock: sizes.reduce((sum, size) => sum + size.stock, 0),
    license: "Vitrine original",
    attribution: "Drawn for Vitrine; the capsule is the shop's own design, not a dataset product.",
    media: [
      { kind: "image", src: imagePath(piece, "flat"), width: CANVAS, height: CANVAS, bytes: null, altEn: `${piece.titleEn} in ${piece.colorLabelEn}, laid flat`, whiteGround: true },
      { kind: "image", src: imagePath(piece, "folded"), width: CANVAS, height: CANVAS, bytes: null, altEn: `${piece.titleEn} in ${piece.colorLabelEn}, folded`, whiteGround: true },
    ],
    variants: sizes.map((size) => ({ size: size.size, stock: size.stock, priceCents: null })),
  };
}

async function fixture(): Promise<void> {
  const products = CAPSULE.map(productFor);
  const file = {
    version: 1 as const,
    description: "The Wear capsule: 24 pieces the shop designed and drew itself, in five sizes each (docs/adr/022).",
    products,
  };
  if (dryRun) {
    const sizes = products.reduce((sum, product) => sum + (product.variants?.length ?? 1), 0);
    out(`would write ${products.length} products and ${sizes} sizes to ${FIXTURE}`);
    return;
  }
  await writeFile(FIXTURE, `${JSON.stringify(file, null, 2)}\n`, "utf8");
  out(`${products.length} products written to ${FIXTURE}`);
}

async function main(): Promise<void> {
  if (command === "build") {
    await images();
    await fixture();
    return;
  }
  if (command === "images") {
    await images();
    return;
  }
  if (command === "fixture") {
    await fixture();
    return;
  }
  throw new Error(`Unknown command "${command}". Try: build, images, fixture`);
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
