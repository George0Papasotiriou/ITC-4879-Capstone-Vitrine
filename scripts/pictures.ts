/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * The hand-run side of AI pictures: the sixteen showroom rooms, and the pilot behind evaluation E11. Priced first, spent only with --yes.
 */

/**
 * docs/adr/060.
 *
 *   pnpm pictures list
 *   pnpm pictures sheet [--run <name>]     (the pilot's pictures side by side, as .local/e11/<run>/index.html)
 *   pnpm pictures showrooms --dry-run | --yes [--only scandinavian-bedroom,dark-moody-living]
 *   pnpm pictures pilot --dry-run | --yes [--model pro|flash|both] [--limit 12] [--rooms <folder of room photographs>]
 *                       [--showrooms-from https://<the shop>]
 *
 * Without --yes nothing is sent: each command prints what it would make, the
 * price of each and the total, whether the key is set (never its value) and
 * what is left of today's budget. With --yes every call passes the cost guard
 * (kill switch, daily budget) first and is recorded under room_picture.
 *
 * showrooms: photographs each style's missing rooms at 4K (showrooms.ts) and
 *   stores them as catalogue media; scenes are placed into them from then on.
 * pilot: the evaluation (docs/report/evaluations/e11-pictures.md). Twelve
 *   pieces of twelve kinds, one style each in turn, made by the real pipeline
 *   (render.ts: the brief, the references, the check, a second attempt) with
 *   Nano Banana Pro, Nano Banana 2 or both. Each picture is written to
 *   .local/e11/<run>/ with its verdict, attempts, seconds and cost, and the
 *   summary to docs/report/evaluations/e11-pictures.json. Nothing is shown in
 *   the shop. --rooms adds pictures of the pieces in the room photographs in
 *   that folder — only photographs their owner agreed to send to the model.
 *   --showrooms-from reads the showroom rooms from a running shop (they are
 *   public catalogue media), so a pilot on this machine uses the rooms made
 *   once in production instead of paying for them again.
 */

import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

import { serverEnv } from "@/env";
import { MODELS, USD_TO_EUR, type ModelEntry, type Usage, costMicros } from "@/lib/ai/models";
import { createUsageStore } from "@/lib/ai/usage";
import { ABO_PRODUCT_KINDS, roomPlacement } from "@/lib/catalog/taxonomy";
import { sql } from "@/lib/db/client";
import { fixtureJudge, fixtureMaker, googleChain, googleJudge, googleMaker, type ImageMaker, type PictureJudge } from "@/lib/pictures/makers";
import { roomTypeFor, SCENE_STYLE_IDS, showroomFiles, type PictureKind, type SceneStyle } from "@/lib/pictures/pictures";
import { encodePicture, renderPicture } from "@/lib/pictures/render";
import { forgetShowroomTiles, madeShowrooms, makeShowroom, SHOWROOMS } from "@/lib/pictures/showrooms";
import { chooseReferenceMedia, detailCrop, prepareImage, type PictureImage } from "@/lib/pictures/studio";
import { storage } from "@/lib/storage";

const out = (line: string) => process.stdout.write(`${line}\n`);

/** The pilot's kinds, one piece of each: everything a room picture is asked for most. */
const PILOT_KINDS = ["SOFA", "CHAIR", "TABLE", "DESK", "BED", "LAMP", "RUG", "CABINET", "SHELF", "OTTOMAN", "STOOL_SEATING", "DRESSER"] as const;

/**
 * What one picture is expected to cost, for the dry run: the image, about
 * six images read at high resolution (≈1,100 tokens each), about 1,500
 * thinking tokens, and the check (≈5,000 tokens in, 300 out); a third of
 * pictures are expected to be made twice.
 */
function expectedUsd(entry: ModelEntry, withCheck = true): number {
  const make = (costMicros(entry.pricing, { units: 1, inputTokens: 6_600, outputTokens: 1_500 }) ?? 0) / 1e6;
  const check = withCheck ? (costMicros(MODELS.pictureJudge.pricing, { inputTokens: 5_000, outputTokens: 300 }) ?? 0) / 1e6 : 0;
  return (make + check) * (withCheck ? 1.33 : 1);
}

type Piece = { id: string; slug: string; kind: string; title_en: string; dims_cm: { w: number; d: number; h: number } | null; colors: string[]; materials: string[]; color_label: string | null };

async function piecePhotos(productId: string): Promise<{ references: PictureImage[]; detail: PictureImage | null }> {
  const env = serverEnv();
  const media = await sql<{ src: string; kind: string; white_ground: boolean; position: number }[]>`
    SELECT src, kind, white_ground, position FROM product_media WHERE product_id = ${productId} AND kind = 'image'
  `;
  const chosen = chooseReferenceMedia(media.map((row) => ({ src: row.src, kind: row.kind, whiteGround: row.white_ground, position: row.position })));
  // Read where the files are, not through a shop that may not be running: the specimen photographs ship in
  // public/, the shop's own media are in storage, and the catalogue bucket's are fetched by their address.
  const files = await storage();
  const originals = await Promise.all(
    chosen.map(async (entry): Promise<PictureImage | null> => {
      if (entry.src.startsWith("/media/")) {
        const object = await files.getObject(entry.src.slice("/media/".length));
        return object === null ? null : { bytes: object.body, contentType: object.contentType };
      }
      if (entry.src.startsWith("/")) {
        const bytes = await readFile(path.join("public", ...entry.src.split("/").filter(Boolean))).catch(() => null);
        return bytes === null ? null : { bytes: new Uint8Array(bytes), contentType: "image/webp" };
      }
      const response = await fetch(new URL(entry.src, env.APP_URL), { signal: AbortSignal.timeout(20_000) }).catch(() => null);
      return response === null || !response.ok ? null : { bytes: new Uint8Array(await response.arrayBuffer()), contentType: response.headers.get("content-type") ?? "image/jpeg" };
    }),
  );
  const references = (await Promise.all(originals.map((image) => (image === null ? null : prepareImage(image))))).filter((image): image is PictureImage => image !== null);
  const studio = chosen[0]?.whiteGround === true ? originals[0] : null;
  return { references, detail: studio == null ? null : await detailCrop(studio) };
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      "dry-run": { type: "boolean", default: false },
      yes: { type: "boolean", default: false },
      only: { type: "string" },
      model: { type: "string", default: "pro" },
      limit: { type: "string", default: "12" },
      rooms: { type: "string" },
      "showrooms-from": { type: "string" },
      run: { type: "string" },
    },
  });
  const command = positionals[0];
  const env = serverEnv();
  const usage = createUsageStore(sql, { mode: env.aiMode, killSwitch: env.AI_KILL_SWITCH, dailyBudgetEur: env.AI_DAILY_BUDGET_EUR });
  const files = await storage();
  const fixture = env.PICTURES_PROVIDER === "fixture";
  const key = env.GOOGLE_GENERATIVE_AI_API_KEY;
  const budget = async () => {
    const settings = await usage.settings();
    out(
      `Google key ${key === undefined ? "is NOT set" : "is set"}${fixture ? " (PICTURES_PROVIDER=fixture: the test stand-in, nothing is paid)" : ""}. Today's budget: €${(settings.dailyBudgetMicros / 1e6).toFixed(2)}, €${((await usage.spentToday()) / 1e6).toFixed(2)} spent. Kill switch ${settings.killSwitch ? "ON" : "off"}.`,
    );
  };
  // The showroom rooms take whichever model can make them (the other stands in); the pilot compares the two, so each stands alone.
  const maker = (entry: ModelEntry, { alone = false }: { alone?: boolean } = {}): ImageMaker => (fixture ? fixtureMaker() : alone ? googleMaker(entry, key!) : googleChain(entry, key!));
  const judge = (): PictureJudge => (fixture ? fixtureJudge() : googleJudge(key!));
  const spendAs = (surface: string) => async (entry: ModelEntry, used: Usage) => {
    await usage.record({ feature: "room_picture", model: entry, surface, actorKey: null, usage: used, paid: !fixture });
  };
  const mayRun = () => {
    if (values["dry-run"] || !values.yes) {
      out(values["dry-run"] ? "Dry run: nothing was sent." : "Nothing was sent. Add --yes to spend, once the price above is approved.");
      return false;
    }
    if (!fixture && key === undefined) throw new Error("GOOGLE_GENERATIVE_AI_API_KEY is not set");
    return true;
  };

  if (command === "list") {
    const made = await madeShowrooms(files);
    out(`Showroom rooms made: ${made.length} of ${SHOWROOMS.length}.`);
    for (const entry of SHOWROOMS) out(`  ${made.some((done) => done.style === entry.style && done.room === entry.room) ? "made   " : "missing"} ${entry.style}-${entry.room}`);
    const [today] = await sql<{ made: number; failed: number; cost: number | null }[]>`
      SELECT count(*) FILTER (WHERE status = 'done')::int AS made, count(*) FILTER (WHERE status = 'failed')::int AS failed, sum(cost_micros)::int AS cost
      FROM pictures WHERE created_at >= date_trunc('day', now()) AND provider <> 'drawn'
    `;
    out(`Pictures today: ${today?.made ?? 0} made, ${today?.failed ?? 0} failed, €${((today?.cost ?? 0) / 1e6).toFixed(2)}.`);
    await budget();
    return;
  }

  if (command === "showrooms") {
    const only = values.only?.split(",").map((entry) => entry.trim());
    const made = await madeShowrooms(files);
    const missing = SHOWROOMS.filter((entry) => !made.some((done) => done.style === entry.style && done.room === entry.room)).filter((entry) => only === undefined || only.includes(`${entry.style}-${entry.room}`));
    const unit = expectedUsd(MODELS.imagePro4k, false);
    out(`${missing.length} showroom rooms to make × about $${unit.toFixed(3)} (${MODELS.imagePro4k.id} at 4K) = about $${(unit * missing.length).toFixed(2)}, €${(unit * missing.length * USD_TO_EUR).toFixed(2)}.`);
    for (const entry of missing) out(`  ${entry.style}-${entry.room}`);
    await budget();
    if (!mayRun()) return;
    let done = 0;
    for (const entry of missing) {
      const gate = await usage.open(new Date(), { paid: !fixture });
      if (!gate.ok) {
        out(`Stopped by the cost guard: ${gate.reason}. ${done} rooms made.`);
        break;
      }
      const started = Date.now();
      const result = await makeShowroom({ maker: maker(MODELS.imagePro4k), files, spend: spendAs("showroom-base") }, entry);
      out(`  ${entry.style}-${entry.room}: ${result.ok ? `made by ${result.model}, ${(result.bytes / 1e6).toFixed(1)} MB` : `failed (${result.reason}${result.detail === null ? "" : `: ${result.detail}`})`} in ${Math.round((Date.now() - started) / 1000)} s`);
      if (result.ok) done += 1;
    }
    forgetShowroomTiles();
    out(`${done} showroom rooms made. Look at them in ${showroomFiles("warm-minimal", "living").original.replace(/warm-minimal-living\.jpg$/, "")} (served at /media/…).`);
    return;
  }

  if (command === "pilot") {
    const models: ModelEntry[] = values.model === "both" ? [MODELS.imagePro, MODELS.image] : values.model === "flash" ? [MODELS.image] : [MODELS.imagePro];
    const limit = Math.max(1, Math.min(PILOT_KINDS.length, Number.parseInt(values.limit, 10) || 12));
    const pieces: Piece[] = [];
    for (const kind of PILOT_KINDS.slice(0, limit)) {
      const [piece] = await sql<Piece[]>`
        SELECT p.id, p.slug, p.kind, p.title_en, p.dims_cm, p.colors, p.materials, p.color_label FROM products p
        WHERE p.status = 'active' AND p.kind = ${kind} AND p.dims_cm IS NOT NULL
          AND EXISTS (SELECT 1 FROM product_media m WHERE m.product_id = p.id AND m.kind = 'image' AND m.white_ground)
        ORDER BY p.popularity DESC, p.id LIMIT 1
      `;
      if (piece !== undefined) pieces.push(piece);
    }
    const rooms = values.rooms === undefined ? [] : (await readdir(values.rooms)).filter((name) => /\.(jpe?g|png|webp|heic)$/i.test(name)).slice(0, 3);
    const jobs = pieces.length + rooms.length;
    let total = 0;
    for (const entry of models) {
      const unit = expectedUsd(entry);
      total += unit * jobs;
      out(`${jobs} pictures (${pieces.length} showroom${rooms.length > 0 ? `, ${rooms.length} in your room photographs` : ""}) × about $${unit.toFixed(3)} (${entry.id} at 2K, with its check and a second attempt for a third) = about $${(unit * jobs).toFixed(2)}`);
    }
    out(`Total about $${total.toFixed(2)}, €${(total * USD_TO_EUR).toFixed(2)}.`);
    pieces.forEach((piece, index) => out(`  ${piece.kind.padEnd(14)} ${SCENE_STYLE_IDS[index % SCENE_STYLE_IDS.length]!.padEnd(14)} ${piece.title_en.slice(0, 64)}`));
    await budget();
    if (!mayRun()) return;

    const run = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    const folder = path.join(".local", "e11", run);
    const results: Record<string, unknown>[] = [];
    for (const entry of models) {
      const name = entry === MODELS.imagePro ? "pro" : "flash";
      await mkdir(path.join(folder, name), { recursive: true });
      const tasks: { piece: Piece; kind: PictureKind; style: SceneStyle | null; room: PictureImage | null; label: string }[] = [];
      for (const [index, piece] of pieces.entries()) {
        const style = SCENE_STYLE_IDS[index % SCENE_STYLE_IDS.length]!;
        const original = showroomFiles(style, roomTypeFor(piece.kind, piece.title_en, piece.dims_cm)).original;
        const from = values["showrooms-from"];
        const base =
          from === undefined
            ? await files.getObject(original)
            : await fetch(new URL(`/media/${original}`, from), { signal: AbortSignal.timeout(30_000) })
                .then(async (response) => (response.ok ? { body: new Uint8Array(await response.arrayBuffer()), contentType: "image/jpeg" } : null))
                .catch(() => null);
        tasks.push({ piece, kind: "scene", style, room: base === null ? null : { bytes: base.body, contentType: base.contentType }, label: `${piece.slug}-${style}` });
      }
      for (const [index, file] of rooms.entries()) {
        const piece = pieces[index % pieces.length]!;
        tasks.push({ piece, kind: "quick", style: null, room: { bytes: new Uint8Array(await readFile(path.join(values.rooms!, file))), contentType: "image/jpeg" }, label: `${piece.slug}-room-${index + 1}` });
      }
      for (const task of tasks) {
        const gate = await usage.open(new Date(), { paid: !fixture });
        if (!gate.ok) {
          out(`Stopped by the cost guard: ${gate.reason}.`);
          break;
        }
        const started = Date.now();
        let spent = 0;
        const spend = async (model: ModelEntry, used: Usage) => {
          spent += costMicros(model.pricing, used) ?? 0;
          await spendAs("pilot")(model, used);
        };
        const photos = await piecePhotos(task.piece.id);
        const roomType = roomTypeFor(task.piece.kind, task.piece.title_en, task.piece.dims_cm);
        const rendered = await renderPicture(
          { maker: maker(entry, { alone: true }), judge: judge(), spend },
          {
            kind: task.kind,
            piece: {
              title: task.piece.title_en,
              kindLabel: ABO_PRODUCT_KINDS[task.piece.kind]?.kindEn ?? null,
              dimsCm: task.piece.dims_cm,
              lies: roomPlacement(task.piece.kind, task.piece.dims_cm) === "lie",
              colours: task.piece.color_label === null ? task.piece.colors : [task.piece.color_label],
              materials: task.piece.materials,
            },
            style: task.style,
            roomType,
            room: task.room,
            references: photos.references,
            detail: photos.detail,
          },
        );
        const seconds = Math.round((Date.now() - started) / 1000);
        if (rendered.ok) await writeFile(path.join(folder, name, `${task.label}.jpg`), (await encodePicture(rendered.image)).download);
        const line = { model: entry.id, folder: name, label: task.label, title: task.piece.title_en, piece: task.piece.slug, kind: task.piece.kind, picture: task.kind, style: task.style, roomType, showroom: task.room !== null && task.kind === "scene", ok: rendered.ok, reason: rendered.ok ? null : rendered.reason, notes: rendered.notes, attempts: rendered.attempts, verdict: rendered.verdict, seconds, costEur: (spent / 1e6) * USD_TO_EUR };
        results.push(line);
        out(`  ${name} ${task.label}: ${rendered.ok ? "kept" : `failed (${rendered.reason})`}, ${rendered.attempts} attempt(s), ${seconds} s, €${line.costEur.toFixed(3)}${rendered.verdict === null ? "" : `, scores ${rendered.verdict.fidelity}/${rendered.verdict.realism}/${rendered.verdict.scale}`}${rendered.notes.length === 0 ? "" : ` — ${rendered.notes.join("; ")}`}`);
      }
    }
    await writeFile(path.join(folder, "results.json"), JSON.stringify(results, null, 2));
    // A rehearsal with the tests' stand-in never becomes the evaluation's record.
    if (!fixture) {
      await mkdir(path.join("docs", "report", "evaluations"), { recursive: true });
      await writeFile(path.join("docs", "report", "evaluations", "e11-pictures.json"), JSON.stringify({ run, results }, null, 2));
    }
    out(`Pictures in ${folder}${fixture ? " (a rehearsal with the test stand-in)" : "; results in docs/report/evaluations/e11-pictures.json"}. \`pnpm pictures sheet\` lays them side by side.`);
    return;
  }

  if (command === "sheet") {
    // The pilot's pictures side by side, one row per piece, one column per model, with what the check said.
    const runs = (await readdir(path.join(".local", "e11")).catch(() => [] as string[])).sort();
    const run = values.run ?? runs.at(-1);
    if (run === undefined) throw new Error("No pilot has run yet (.local/e11 is empty).");
    const folder = path.join(".local", "e11", run);
    const results = JSON.parse(await readFile(path.join(folder, "results.json"), "utf8")) as { folder: string; label: string; title: string; model: string; ok: boolean; reason: string | null; attempts: number; seconds: number; costEur: number; verdict: { fidelity: number; realism: number; scale: number; roomKept: number | null; issues: string[] } | null }[];
    const columns = [...new Set(results.map((entry) => entry.folder))];
    const labels = [...new Set(results.map((entry) => entry.label))];
    const escape = (text: string) => text.replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char]!);
    const cell = (entry: (typeof results)[number] | undefined) => {
      if (entry === undefined) return "<td></td>";
      const scores = entry.verdict === null ? "no verdict" : `fidelity ${entry.verdict.fidelity} · realism ${entry.verdict.realism} · scale ${entry.verdict.scale}${entry.verdict.roomKept === null ? "" : ` · room ${entry.verdict.roomKept}`}`;
      const image = entry.ok ? `<a href="${entry.folder}/${entry.label}.jpg"><img src="${entry.folder}/${entry.label}.jpg" alt="${escape(entry.title)}" loading="lazy"></a>` : `<p class="failed">Not kept: ${escape(entry.reason ?? "")}</p>`;
      const issues = entry.verdict === null || entry.verdict.issues.length === 0 ? "" : `<ul>${entry.verdict.issues.map((issue) => `<li>${escape(issue)}</li>`).join("")}</ul>`;
      return `<td>${image}<p>${scores}</p><p>${entry.attempts} attempt${entry.attempts === 1 ? "" : "s"} · ${entry.seconds} s · €${entry.costEur.toFixed(3)}</p>${issues}</td>`;
    };
    const rows = labels.map((label) => `<tr><th scope="row">${escape(results.find((entry) => entry.label === label)!.title)}<br><small>${escape(label)}</small></th>${columns.map((column) => cell(results.find((entry) => entry.label === label && entry.folder === column))).join("")}</tr>`);
    const total = (column: string) => results.filter((entry) => entry.folder === column);
    const summary = columns.map((column) => `<li><strong>${column}</strong>: ${total(column).filter((entry) => entry.ok).length} of ${total(column).length} kept, €${total(column).reduce((sum, entry) => sum + entry.costEur, 0).toFixed(2)}</li>`).join("");
    const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>E11 pilot ${escape(run)}</title>
<style>:root{--ink:#1d2330;--mist:#5d6676;--ground:#f6f4ef;--line:#ddd8cc}@media (prefers-color-scheme:dark){:root{--ink:#eceae4;--mist:#a3a9b5;--ground:#161a22;--line:#2c3240}}
body{margin:0;padding:24px 16px;background:var(--ground);color:var(--ink);font:15px/1.5 system-ui,sans-serif}h1{font-size:26px;margin:0 0 8px}
.wrap{overflow-x:auto}table{border-collapse:collapse;min-width:900px}th,td{border-top:1px solid var(--line);padding:12px;vertical-align:top;text-align:left}
thead th{position:sticky;top:0;background:var(--ground)}td{width:44%}th[scope=row]{min-width:14rem;width:14rem}small{overflow-wrap:anywhere}img{width:100%;border-radius:8px;display:block}p,ul{margin:6px 0;color:var(--mist);font-size:13px}.failed{color:#b4442c}small{color:var(--mist)}</style>
<h1>E11 pilot, ${escape(run)}</h1><ul>${summary}</ul><div class="wrap"><table><thead><tr><th>Piece</th>${columns.map((column) => `<th>${column}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table></div></html>`;
    await writeFile(path.join(folder, "index.html"), html);
    out(`Sheet written: ${path.join(folder, "index.html")}`);
    return;
  }

  out("Usage: pnpm pictures list | showrooms --dry-run|--yes [--only style-room,…] | pilot --dry-run|--yes [--model pro|flash|both] [--limit 12] [--rooms <folder>] [--showrooms-from <url>] | sheet [--run <name>]");
  process.exitCode = 1;
}

main()
  .catch((error: unknown) => {
    process.stderr.write(`[pictures] ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(() => sql.end({ timeout: 5 }));
