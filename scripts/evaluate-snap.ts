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
    WHERE p.status = 'active' AND array_length(p.colors, 1) = 1 AND m.src LIKE '/products/%'
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
  // The baseline a reading has to beat: always answering the catalogue's most common word.
  const [majorityColour, majorityCount] = [...byColour.entries()].sort((a, b) => b[1].n - a[1].n)[0] ?? ["—", { n: 0 }];

  say("## Verdict");
  say();
  say("| Photographs | Top colour agrees | Agrees anywhere in the search | Always the most common word |");
  say("|---|---|---|---|");
  say(`| ${seen.length} | ${top1} (${percent(top1, seen.length)}%) | ${anywhere} (${percent(anywhere, seen.length)}%) | ${majorityCount.n} (${percent(majorityCount.n, seen.length)}%, "${majorityColour}") |`);
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
  say("## Discussion");
  say();
  say("What this evaluation changed. Its first run found two defects, both fixed before the figures");
  say("above were taken. The clothing capsule had filed its fabric names (\"ecru\", \"ink\") as colours,");
  say("which no filter and no search by photo could match; each is now filed under the shop's word");
  say("(`CAPSULE_COLOUR_WORDS`). And the backdrop test asked whether the edge of the frame was");
  say("*uniform*, so a sofa reaching across it made a studio shot look like a room and the white");
  say("ground was counted: seven black pieces in ten read \"white\". The edge is now summarised by its");
  say("median, and it is a backdrop when most of it is that one colour.");
  say();
  say("What was tried and not kept. Warm greys (a grey sofa under warm light) read as brown or beige");
  say("at chroma 13 to 18. Requiring more colour of warm hues fixed six of them and broke six pale");
  say("beiges (cream, ecru), which sit at the same chroma and hue: one fewer top-1 agreement, three");
  say("more anywhere. The two overlap except in lightness, and a rule on lightness would be tuned on");
  say("this very set; it is left for a labelled set held apart from this one.");
  say();
  say("Where it is weakest. Metals (gold, silver) are reflections of whatever surrounds them and are");
  say("rarely named right. White pieces on a white ground leave only shadows and legs to read. Slate");
  say("is filed as grey, and the reading calls it blue — the vocabulary itself is unsure there.");
  say();
  say("## Limitations");
  say();
  say("- The labels are the dataset's colour attribute, not a person judging each photograph.");
  say("- The photographs are studio shots; a shopper's photograph of a room is harder and is not measured here.");
  say("- The capsule's pictures are drawings, whose colours are exact; they flatter the capsule rows.");
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
