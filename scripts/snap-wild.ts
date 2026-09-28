/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * E9's photographs in the wild: chairs filed by colour on Wikimedia Commons, chosen by rule, licence and author kept per file.
 */

/**
 * docs/adr/024 (addendum).
 *
 *   pnpm snap:wild choose [--per-colour 3]   builds evals/snap-wild.json from Commons
 *   pnpm snap:wild fetch                     downloads the listed photographs to .local/e9-wild
 *
 * E9's studio set asks whether the shop reads the colour the catalogue gave a
 * piece photographed on white. A shopper's photograph is a chair in a room, in
 * a street, in odd light. Commons files photographs of chairs under colour
 * categories ("Red chairs", "Blue chairs", …), and those categories were
 * chosen by the people who filed them — so the label is a person's, not this
 * project's.
 *
 * Nothing is picked by eye: in each category the files are taken in the
 * category's own order, and the first ones that meet every rule are kept —
 * a JPEG at least 800 px wide, an open licence (CC0, public domain, CC BY,
 * CC BY-SA), and filed under no other colour, so the label is not ambiguous.
 * The list is committed with each file's author, licence and address, so the
 * run can be repeated after Commons changes; the photographs themselves are
 * not committed (.local/e9-wild, a copy about 960 px wide each —
 * Commons serves its nearest standard size).
 *
 * Commons asks automated clients to name themselves and go slowly: every
 * request carries a User-Agent, waits four seconds, and on "too many
 * requests" waits as long as Commons asks (or a minute) before one retry.
 */

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

import { z } from "zod";

export const WILD_MANIFEST = path.join("evals", "snap-wild.json");
export const WILD_DIR = path.join(".local", "e9-wild");
const API = "https://commons.wikimedia.org/w/api.php";
const USER_AGENT = "VitrineCapstoneEval/1.0 (student research project, ITC 4949; colour-reading evaluation)";
const PAUSE_MS = 4000;

/** Commons category → the shop's colour word. */
const CATEGORIES = {
  "Category:Red chairs": "red",
  "Category:Blue chairs": "blue",
  "Category:Green chairs": "green",
  "Category:Yellow chairs": "yellow",
  "Category:Black chairs": "black",
  "Category:White chairs": "white",
  "Category:Pink chairs": "pink",
  "Category:Orange chairs": "orange",
} as const;

const OPEN_LICENCE = /^(CC0|Public domain|PD|CC BY(-SA)? \d(\.\d)?)/i;

export const wildPhotoSchema = z.object({
  file: z.string().min(1),
  colour: z.string().min(1),
  category: z.string().min(1),
  author: z.string().min(1),
  licence: z.string().min(1),
  licenceUrl: z.string().nullable(),
  page: z.url(),
  image: z.url(),
  local: z.string().min(1),
});
export const wildManifestSchema = z.object({
  chosen: z.string(),
  rule: z.string(),
  photographs: z.array(wildPhotoSchema),
});
export type WildPhoto = z.infer<typeof wildPhotoSchema>;

const out = (line = "") => process.stdout.write(`${line}\n`);
const pause = () => new Promise((resolve) => setTimeout(resolve, PAUSE_MS));

/** A polite GET: paced, and on 429 it waits as told before trying once more. */
async function politeGet(url: string): Promise<Response> {
  await pause();
  const first = await fetch(url, { headers: { "user-agent": USER_AGENT } });
  if (first.status !== 429) return first;
  const wait = Math.min(300, Number(first.headers.get("retry-after")) || 60);
  out(`  Commons asked to slow down; waiting ${wait} s`);
  await new Promise((resolve) => setTimeout(resolve, wait * 1000));
  return fetch(url, { headers: { "user-agent": USER_AGENT } });
}

async function api(params: Record<string, string>): Promise<unknown> {
  const response = await politeGet(`${API}?${new URLSearchParams({ format: "json", formatversion: "2", ...params })}`);
  if (!response.ok) throw new Error(`Commons answered ${response.status}`);
  const body = (await response.json()) as { error?: { info?: string } };
  if (body.error !== undefined) throw new Error(`Commons: ${body.error.info ?? "error"}`);
  return body;
}

/** Commons writes authors as HTML (links to user pages); the list keeps the words. */
const plain = (html: string | undefined) =>
  (html ?? "")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();

type ImageInfo = {
  title: string;
  categories?: { title: string }[];
  imageinfo?: { thumburl?: string; thumbwidth?: number; width: number; mime: string; descriptionurl: string; extmetadata?: Record<string, { value?: string }> }[];
};

async function choose(perColour: number): Promise<void> {
  const colourCategories = new Set(Object.keys(CATEGORIES));
  const photographs: WildPhoto[] = [];
  for (const [category, colour] of Object.entries(CATEGORIES)) {
    const members = (await api({ action: "query", list: "categorymembers", cmtitle: category, cmtype: "file", cmlimit: "50", cmsort: "sortkey" })) as {
      query: { categorymembers: { title: string }[] };
    };
    const titles = members.query.categorymembers.map((member) => member.title);
    const info = (await api({
      action: "query",
      titles: titles.join("|"),
      prop: "imageinfo|categories",
      iiprop: "url|size|mime|extmetadata",
      iiurlwidth: "800",
      cllimit: "max",
    })) as { query: { pages: ImageInfo[] } };
    const byTitle = new Map(info.query.pages.map((page) => [page.title, page]));
    let kept = 0;
    for (const title of titles) {
      if (kept >= perColour) break;
      const page = byTitle.get(title);
      const image = page?.imageinfo?.[0];
      if (page === undefined || image === undefined || image.thumburl === undefined) continue;
      if (image.mime !== "image/jpeg" || image.width < 800) continue;
      const licence = plain(image.extmetadata?.LicenseShortName?.value);
      if (!OPEN_LICENCE.test(licence)) continue;
      const otherColours = (page.categories ?? []).filter((entry) => colourCategories.has(entry.title) && entry.title !== category);
      if (otherColours.length > 0) continue;
      const author = plain(image.extmetadata?.Artist?.value) || "unknown (see the file page)";
      const name = `${colour}-${String(kept + 1).padStart(2, "0")}.jpg`;
      photographs.push({
        file: title,
        colour,
        category,
        author,
        licence,
        licenceUrl: image.extmetadata?.LicenseUrl?.value ?? null,
        page: image.descriptionurl,
        image: image.thumburl,
        local: name,
      });
      kept += 1;
    }
    out(`  ${category.padEnd(24)} ${kept} kept of ${titles.length} looked at`);
  }
  const manifest = {
    chosen: new Date().toISOString().slice(0, 10),
    rule: `First ${perColour} files per category in Commons' own order that are JPEG, at least 800 px wide, CC0/public domain/CC BY/CC BY-SA, and in no other colour category. Label = the category.`,
    photographs,
  };
  wildManifestSchema.parse(manifest);
  await writeFile(WILD_MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
  out(`${photographs.length} photographs listed in ${WILD_MANIFEST}`);
}

async function fetchAll(): Promise<void> {
  const manifest = wildManifestSchema.parse(JSON.parse(await readFile(WILD_MANIFEST, "utf8")));
  await mkdir(WILD_DIR, { recursive: true });
  let fetched = 0;
  for (const photo of manifest.photographs) {
    const target = path.join(WILD_DIR, photo.local);
    if (existsSync(target)) continue;
    const response = await politeGet(photo.image);
    if (!response.ok) {
      out(`  ${photo.file}: ${response.status}, skipped`);
      continue;
    }
    await writeFile(target, Buffer.from(await response.arrayBuffer()));
    fetched += 1;
  }
  out(`${fetched} downloaded to ${WILD_DIR}; ${manifest.photographs.length} listed`);
}

async function main(): Promise<void> {
  const { positionals, values } = parseArgs({ allowPositionals: true, options: { "per-colour": { type: "string" } } });
  const command = positionals[0];
  if (command === "choose") await choose(Math.max(1, Number.parseInt(values["per-colour"] ?? "3", 10)));
  else if (command === "fetch") await fetchAll();
  else out("usage: pnpm snap:wild choose [--per-colour 3] | fetch");
}

if (process.argv[1]?.endsWith("snap-wild.ts")) {
  main().catch((error: unknown) => {
    process.stderr.write(`[snap:wild] ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
