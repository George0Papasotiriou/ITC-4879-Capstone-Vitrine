/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Evaluation E9 (colour reading): does the shop's reading of a photograph agree with the catalogue's own colour word?
 */

/**
 * Search by photo without a multimodal model reads colour (docs/adr/024), so
 * the question this evaluation asks is the one the feature rests on: **when the
 * shop looks at a photograph, does it name the colour the catalogue gave that
 * piece?**
 *
 *   pnpm evals:snap                measure every product photograph with one colour word
 *   pnpm evals:snap --limit 40     the first forty, for a quick run
 *
 * THE DATA. Every active product whose catalogue entry names exactly one colour
 * and whose first photograph is a file in `public/` — the studio photographs of
 * the Amazon Berkeley Objects dataset (CC BY-NC 4.0) and the capsule's own
 * drawings. The label is the dataset's colour attribute, not a person judging
 * the photograph, so this measures **agreement with the catalogue**, not truth:
 * where the two disagree the photograph is sometimes right and the label wrong.
 *
 * WHAT IS MEASURED. The same code a shopper's photograph goes through
 * (`paletteOfImage`): top-1 agreement (the largest colour the shop reports is
 * the catalogue's word), agreement anywhere in what it would search with, and
 * the confusions, which are the interesting part — "beige" against "brown" is a
 * different kind of mistake from "blue" against "brown".
 *
 * Writes docs/report/evaluations/e9-colour-reading.md and .json.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import postgres from "postgres";

import { colorLabel } from "@/lib/search/vocabulary";
import { paletteOfImage } from "@/lib/vision/snap-server";
import { searchableColours } from "@/lib/vision/palette";

type Row = { id: string; title: string; colors: string[]; src: string; source: string };

const args = process.argv.slice(2);
const limitAt = args.indexOf("--limit");
const limit = limitAt === -1 ? Number.POSITIVE_INFINITY : Number(args[limitAt + 1]);

const out: string[] = [];
const say = (line = "") => {
  out.push(line);
  console.log(line);
};

const percent = (part: number, whole: number) => (whole === 0 ? 0 : Math.round((part / whole) * 1000) / 10);

async function main() {
  const url = process.env.DATABASE_URL;
  if (url === undefined || url === "") throw new Error("DATABASE_URL is not set; run through `pnpm evals:snap`.");
  const sql = postgres(url, { max: 4, onnotice: () => {} });

  // One colour word only: a piece the catalogue calls "grey and brown" has no
  // single right answer, and grading it either way would flatter or punish the
  // reading for no reason.
  const rows = await sql<Row[]>`
    SELECT p.id, p.title_en AS title, p.colors, m.src, p.source
    FROM products p
    JOIN LATERAL (
      SELECT m.src FROM product_media m WHERE m.product_id = p.id AND m.kind = 'image' ORDER BY m.position LIMIT 1
    ) m ON true
    WHERE p.status = 'active' AND array_length(p.colors, 1) = 1 AND m.src LIKE '/%'
    ORDER BY p.source, p.id
  `;

  const seen: { title: string; expected: string; top: string | null; searchable: string[]; source: string }[] = [];
  for (const row of rows.slice(0, Number.isFinite(limit) ? limit : rows.length)) {
    const file = path.join("public", row.src.replace(/^\//, "").split("?")[0]!);
    const bytes = await readFile(file).catch(() => null);
    if (bytes === null) continue;
    const found = await paletteOfImage(bytes);
    if (found === null) continue;
    const searchable = searchableColours(found);
    seen.push({ title: row.title, expected: row.colors[0]!, top: found[0]?.color ?? null, searchable, source: row.source });
  }
  await sql.end();

  const top1 = seen.filter((entry) => entry.top === entry.expected).length;
  const anywhere = seen.filter((entry) => entry.searchable.includes(entry.expected)).length;

  const byColour = new Map<string, { n: number; top1: number }>();
  const confusions = new Map<string, number>();
  for (const entry of seen) {
    const bucket = byColour.get(entry.expected) ?? { n: 0, top1: 0 };
    bucket.n += 1;
    if (entry.top === entry.expected) bucket.top1 += 1;
    byColour.set(entry.expected, bucket);
    if (entry.top !== entry.expected && entry.top !== null) {
      const key = `${entry.expected} → ${entry.top}`;
      confusions.set(key, (confusions.get(key) ?? 0) + 1);
    }
  }

  say(`# E9 (colour reading): the shop's reading against the catalogue's colour word`);
  say();
  say(`Generated ${new Date().toISOString()} by \`scripts/evaluate-snap.ts\` (\`pnpm evals:snap\`).`);
  say();
  say("Search by photo reads colour while there is no multimodal key (docs/adr/024). This measures");
  say("that reading against the catalogue's own colour word, on every product photograph the shop");
  say("holds whose entry names exactly one colour. The label is the dataset's attribute rather than");
  say("a person judging the photograph, so a disagreement is not always the reading's mistake.");
  say();
  say("## Verdict");
  say();
  say("| Photographs | Top colour agrees | Agrees anywhere in the search |");
  say("|---|---|---|");
  say(`| ${seen.length} | ${top1} (${percent(top1, seen.length)}%) | ${anywhere} (${percent(anywhere, seen.length)}%) |`);
  say();

  say("## By colour");
  say();
  say("| Catalogue word | Photographs | Top colour agrees |");
  say("|---|---|---|");
  for (const [colour, bucket] of [...byColour.entries()].sort((a, b) => b[1].n - a[1].n)) {
    say(`| ${colorLabel(colour, "en")} | ${bucket.n} | ${bucket.top1} (${percent(bucket.top1, bucket.n)}%) |`);
  }
  say();

  say("## Where it disagrees most");
  say();
  say("| Catalogue word → what the shop read | Photographs |");
  say("|---|---|");
  for (const [pair, count] of [...confusions.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
    say(`| ${pair} | ${count} |`);
  }
  say();
  say("## How to reproduce");
  say();
  say("```");
  say("pnpm local   # or any local stack with the catalogue seeded");
  say("pnpm evals:snap");
  say("```");

  await mkdir("docs/report/evaluations", { recursive: true });
  await writeFile("docs/report/evaluations/e9-colour-reading.md", `${out.join("\n")}\n`, "utf8");
  await writeFile(
    "docs/report/evaluations/e9-colour-reading.json",
    `${JSON.stringify({ generatedAt: new Date().toISOString(), photographs: seen.length, top1, anywhere, byColour: Object.fromEntries(byColour), confusions: Object.fromEntries(confusions), seen }, null, 2)}\n`,
    "utf8",
  );
  console.log("\ndocs/report/evaluations/e9-colour-reading.md written");
}

await main();
