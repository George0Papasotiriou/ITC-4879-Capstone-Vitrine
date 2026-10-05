/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Real Amazon.com reviews of the ABO wearables: one pass over Amazon Reviews 2023, keeping only reviews of those very products.
 */

/**
 * docs/adr/061 (George, 2026-10-04: real reviews, labelled with their source).
 *
 *   pnpm exec tsx scripts/amazon-reviews.ts --dry-run
 *   pnpm exec tsx scripts/amazon-reviews.ts --run
 *
 * Amazon Reviews 2023 (Hou et al., McAuley Lab, UCSD) is a public research
 * release of Amazon.com reviews. Its Clothing, Shoes and Jewelry file is 7.1 GB
 * gzipped, 66 million reviews; it is read once, as it downloads, and nothing is
 * kept but the reviews of ABO wearables — the same ASINs, so the same products.
 *
 * Kept per product: how many reviews and their mean, how many say the piece
 * runs small, true to size or large (for the Fit Engine), and its twelve most
 * helpful reviews: rating, title, text (at most 1,200 characters), date,
 * helpful votes and whether the purchase was verified. **No user id, no name,
 * no photographs** — the reviewer is not part of what the shop shows.
 *
 * The result goes to .abo-cache/amazon-reviews-wear.json (not committed); the
 * wear fixture (scripts/catalog-wear.ts) chooses its pieces with it and writes
 * the reviews of the chosen ones into the committed fixture.
 */

import { createReadStream, existsSync } from "node:fs";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";
import { Readable } from "node:stream";
import { createGunzip, gunzipSync } from "node:zlib";
import { parseArgs } from "node:util";

import { englishValue } from "@/lib/catalog/abo";
import { ABO_WEAR_TYPES, wearKindFor } from "@/lib/catalog/wear";

const SOURCE = "https://mcauleylab.ucsd.edu/public_datasets/data/amazon_2023/raw/review_categories/Clothing_Shoes_and_Jewelry.jsonl.gz";
const CACHE = ".abo-cache";
const REVIEWS_CACHE = path.join(CACHE, "amazon-reviews-wear.json");
const KEEP_PER_PRODUCT = 12;
const MAX_TEXT = 1200;

const out = (line = "") => process.stdout.write(`${line}\n`);

type KeptReview = { rating: number; title: string; text: string; at: string; helpful: number; verified: boolean };
type ProductReviews = { count: number; ratingSum: number; small: number; trueToSize: number; large: number; reviews: KeptReview[] };

/** Fit words in a review, as shoppers write them. */
const RUNS_SMALL = /\b(runs?|ran|fits?|fit) (a (little|bit) |very |really |way )?(small|tight|narrow|short)\b|\bsize up\b|\btoo (small|tight|narrow)\b/i;
const TRUE_TO_SIZE = /\btrue to size\b|\bfits? (perfectly|as expected|great|well)\b|\bperfect fit\b/i;
const RUNS_LARGE = /\b(runs?|ran|fits?|fit) (a (little|bit) |very |really |way )?(large|big|wide|long|loose)\b|\bsize down\b|\btoo (big|large|wide|loose)\b/i;

/** The ASINs of every ABO wearable the shop could sell. */
async function wearAsins(): Promise<Set<string>> {
  const asins = new Set<string>();
  const files = (await readdir(CACHE)).filter((name) => /^listings_[0-9a-f]\.json\.gz$/.test(name));
  for (const file of files) {
    const text = gunzipSync(await readFile(path.join(CACHE, file))).toString("utf8");
    for (const line of text.split("\n")) {
      if (line.trim() === "") continue;
      const listing = JSON.parse(line) as { item_id: string; product_type?: { value: string }[]; item_name?: { language_tag?: string; value: string }[] };
      const type = listing.product_type?.[0]?.value;
      if (type === undefined || !(type in ABO_WEAR_TYPES)) continue;
      const title = englishValue(listing.item_name) ?? listing.item_name?.[0]?.value ?? "";
      if (wearKindFor(type, title) !== null) asins.add(listing.item_id);
    }
  }
  return asins;
}

/** The more helpful first; among equals, the one that says more (up to a point), then the newer. */
const rank = (review: KeptReview) => review.helpful * 1000 + Math.min(review.text.length, 600) / 10;

async function main() {
  const { values } = parseArgs({
    options: { "dry-run": { type: "boolean", default: false }, run: { type: "boolean", default: false }, file: { type: "string" }, asins: { type: "string" }, out: { type: "string" } },
  });
  // --asins reads a list written by another step (the clothes shortlist, docs/adr/062); without it, the ABO wearables.
  const asins = values.asins === undefined ? await wearAsins() : new Set((JSON.parse(await readFile(values.asins, "utf8")) as { asins: string[] }).asins);
  const target = values.out ?? REVIEWS_CACHE;
  out(`${asins.size} products (by ASIN) to look for${values.asins === undefined ? " among the ABO wearables" : ` from ${values.asins}`}.`);
  const head = await fetch(SOURCE, { method: "HEAD" }).catch(() => null);
  const size = Number(head?.headers.get("content-length") ?? 0);
  out(`Amazon Reviews 2023, Clothing_Shoes_and_Jewelry: ${(size / 1e9).toFixed(1)} GB to read once (streamed; only matching reviews are kept).`);
  if (values["dry-run"] || !values.run) {
    out(values["dry-run"] ? "Dry run: nothing was downloaded." : "Add --run to read it.");
    return;
  }

  // A local copy (--file) is read from disk; otherwise the file is streamed from the McAuley Lab.
  let input: NodeJS.ReadableStream;
  if (values.file !== undefined && existsSync(values.file)) input = createReadStream(values.file);
  else {
    const response = await fetch(SOURCE);
    if (!response.ok || response.body === null) throw new Error(`download: ${response.status}`);
    input = Readable.fromWeb(response.body as import("node:stream/web").ReadableStream);
  }
  const lines = createInterface({ input: input.pipe(createGunzip()), crlfDelay: Infinity });
  const found = new Map<string, ProductReviews>();
  const asinPattern = /"asin":\s*"([A-Z0-9]{10})"/;
  const parentPattern = /"parent_asin":\s*"([A-Z0-9]{10})"/;
  let read = 0;
  const started = Date.now();
  for await (const line of lines) {
    read += 1;
    if (read % 2_000_000 === 0) out(`  ${(read / 1e6).toFixed(0)} M reviews read, ${found.size} products matched, ${Math.round((Date.now() - started) / 1000)} s`);
    // Cheap first: only a line whose ASIN is wanted is parsed.
    const asin = asinPattern.exec(line)?.[1];
    const parent = parentPattern.exec(line)?.[1];
    const key = asin !== undefined && asins.has(asin) ? asin : parent !== undefined && asins.has(parent) ? parent : null;
    if (key === null) continue;
    const raw = JSON.parse(line) as { rating: number; title?: string; text?: string; timestamp?: number; helpful_vote?: number; verified_purchase?: boolean };
    const text = (raw.text ?? "").replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "").replace(/[ \t]+/g, " ").trim();
    const entry = found.get(key) ?? { count: 0, ratingSum: 0, small: 0, trueToSize: 0, large: 0, reviews: [] };
    entry.count += 1;
    entry.ratingSum += raw.rating;
    if (RUNS_SMALL.test(text)) entry.small += 1;
    else if (RUNS_LARGE.test(text)) entry.large += 1;
    else if (TRUE_TO_SIZE.test(text)) entry.trueToSize += 1;
    if (text.length >= 20) {
      const review: KeptReview = {
        rating: raw.rating,
        title: (raw.title ?? "").trim().slice(0, 140),
        text: text.length > MAX_TEXT ? `${text.slice(0, text.lastIndexOf(" ", MAX_TEXT))}…` : text,
        at: new Date(raw.timestamp ?? 0).toISOString().slice(0, 10),
        helpful: raw.helpful_vote ?? 0,
        verified: raw.verified_purchase === true,
      };
      entry.reviews.push(review);
      if (entry.reviews.length > KEEP_PER_PRODUCT * 2) entry.reviews = entry.reviews.sort((a, b) => rank(b) - rank(a)).slice(0, KEEP_PER_PRODUCT);
    }
    found.set(key, entry);
  }
  for (const entry of found.values()) entry.reviews = entry.reviews.sort((a, b) => rank(b) - rank(a)).slice(0, KEEP_PER_PRODUCT);
  await writeFile(target, JSON.stringify({ source: SOURCE, read, products: Object.fromEntries(found) }));
  const total = [...found.values()].reduce((sum, entry) => sum + entry.count, 0);
  out(`${read} reviews read in ${Math.round((Date.now() - started) / 1000)} s: ${found.size} products have ${total} reviews. Written to ${target}.`);
}

main().catch((error: unknown) => {
  process.stderr.write(`[amazon-reviews] ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
  process.exitCode = 1;
});
