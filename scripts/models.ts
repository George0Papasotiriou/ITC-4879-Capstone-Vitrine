/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * The hand-run batch that has an AI make 3D models from catalogue photographs: priced first, spent only with --yes.
 */

/**
 * docs/adr/059.
 *
 *   pnpm models ai --dry-run [--limit 10] [--provider trellis|trellis-2] [--scanned] [--kinds CHAIR,SOFA]
 *   pnpm models ai --yes     [same options]
 *
 * Without --yes nothing is sent: the run prints how many pieces, the unit
 * price and the total, whether FAL_KEY is set (never its value) and what is
 * left of today's budget. With --yes, each piece in turn passes the cost guard
 * (kill switch, daily budget — src/lib/ai/usage.ts), is sent to fal as its
 * public studio photograph, and the returned mesh is fitted (ai-fit.ts),
 * checked with Khronos's validator where it is installed, stored, recorded in
 * `product_models` ("ready", or "rejected" when it does not fit) and its cost
 * recorded as `model_3d`. The run stops at the first refusal by the guard.
 *
 * --scanned picks pieces that have a real scan: their AI models are never
 * shown (the scan wins) but evaluation E10 compares them with the scan — the
 * pilot George approves before any wider batch.
 */

import { parseArgs } from "node:util";

import { uuidv7 } from "uuidv7";

import { serverEnv } from "@/env";
import { MODELS, USD_TO_EUR, type ModelEntry } from "@/lib/ai/models";
import { Fal3dError, generate3d, type Fal3dModel } from "@/lib/ai/providers/fal-3d";
import { createUsageStore } from "@/lib/ai/usage";
import { makeParts } from "@/lib/catalog/model";
import { fitAiModel, MIN_FIT } from "@/lib/catalog/model/ai-fit";
import { canMakeModel } from "@/lib/catalog/model/family";
import { ROOM_PLACEMENT } from "@/lib/catalog/taxonomy";
import { sql } from "@/lib/db/client";
import { storage } from "@/lib/storage";

const out = (line: string) => process.stdout.write(`${line}\n`);

type Candidate = {
  id: string;
  slug: string;
  kind: string;
  title_en: string;
  attributes: Record<string, string>;
  materials: string[];
  colors: string[];
  dims_cm: { w: number; d: number; h: number } | null;
  studio: string | null;
};

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      "dry-run": { type: "boolean", default: false },
      yes: { type: "boolean", default: false },
      limit: { type: "string", default: "10" },
      provider: { type: "string", default: "trellis" },
      scanned: { type: "boolean", default: false },
      kinds: { type: "string" },
    },
  });
  if (positionals[0] !== "ai") {
    out("Usage: pnpm models ai --dry-run [--limit 10] [--provider trellis|trellis-2] [--scanned] [--kinds CHAIR,SOFA]   (then --yes to spend)");
    process.exitCode = 1;
    return;
  }
  const entry: ModelEntry = values.provider === "trellis-2" ? MODELS.model3dPro : MODELS.model3d;
  if (entry.pricing.kind !== "per_unit") throw new Error("A 3D model is priced per model");
  const limit = Math.max(1, Math.min(2000, Number.parseInt(values.limit, 10) || 10));
  const kinds = values.kinds === undefined ? Object.keys(ROOM_PLACEMENT) : values.kinds.split(",").map((kind) => kind.trim().toUpperCase());

  const rows = await sql<Candidate[]>`
    SELECT p.id, p.slug, p.kind, p.title_en, p.attributes, p.materials, p.colors, p.dims_cm,
      (SELECT m.src FROM product_media m WHERE m.product_id = p.id AND m.kind = 'image' ORDER BY m.white_ground DESC NULLS LAST, m.position LIMIT 1) AS studio
    FROM products p
    LEFT JOIN product_models pm ON pm.product_id = p.id AND pm.origin = 'ai'
    WHERE p.status = 'active' AND p.dims_cm IS NOT NULL AND p.kind = ANY(${kinds}::text[])
      AND EXISTS (SELECT 1 FROM product_media m WHERE m.product_id = p.id AND m.kind = 'model') = ${values.scanned}
      AND (pm.id IS NULL OR pm.status IN ('failed', 'queued'))
    ORDER BY p.popularity DESC, p.id
    LIMIT ${limit * 2}
  `;
  // fal fetches the photograph itself, so it must be a public https address (the catalogue's ABO photographs are).
  const pieces = rows.filter((row) => row.dims_cm !== null && canMakeModel(row.kind, row.dims_cm) && row.studio !== null && /^https:\/\//.test(row.studio)).slice(0, limit);

  const env = serverEnv();
  const usage = createUsageStore(sql, { mode: env.aiMode, killSwitch: env.AI_KILL_SWITCH, dailyBudgetEur: env.AI_DAILY_BUDGET_EUR });
  const settings = await usage.settings();
  const spent = await usage.spentToday();
  const unit = entry.pricing.usdPerUnit;
  const total = unit * pieces.length;
  out(`${pieces.length} pieces${values.scanned ? " with a real scan (for E10; never shown)" : ""} × $${unit.toFixed(2)} (${entry.id}) = $${total.toFixed(2)}, about €${(total * USD_TO_EUR).toFixed(2)}.`);
  out(`FAL_KEY ${env.FAL_KEY === undefined ? "is NOT set" : "is set"}. Today's budget: €${(settings.dailyBudgetMicros / 1e6).toFixed(2)}, €${(spent / 1e6).toFixed(2)} spent. Kill switch ${settings.killSwitch ? "ON" : "off"}.`);
  for (const piece of pieces.slice(0, 12)) out(`  ${piece.kind.padEnd(14)} ${piece.title_en.slice(0, 70)}`);
  if (pieces.length > 12) out(`  … and ${pieces.length - 12} more`);
  if (values["dry-run"] || !values.yes) {
    out(values["dry-run"] ? "Dry run: nothing was sent." : "Nothing was sent. Add --yes to spend, once the price above is approved.");
    return;
  }
  if (env.FAL_KEY === undefined) throw new Error("FAL_KEY is not set");

  const files = await storage();
  const validator = await import("gltf-validator").catch(() => null);
  const short = entry.id.split("/").pop()!;
  let made = 0;
  for (const piece of pieces) {
    const gate = await usage.open(new Date(), { paid: true });
    if (!gate.ok) {
      out(`Stopped by the cost guard: ${gate.reason}. ${made} models made.`);
      break;
    }
    const facts = { slug: piece.slug, kind: piece.kind, title: piece.title_en, attributes: piece.attributes, materials: piece.materials, colors: piece.colors, dims: piece.dims_cm! };
    const upsert = (fields: { status: string; key?: string | null; bytes?: number | null; triangles?: number | null; fit?: number | null; cost?: number | null; reason?: string | null }) => sql`
      INSERT INTO product_models (id, product_id, origin, status, provider, model, storage_key, bytes, triangles, fit, cost_micros, failure_reason)
      VALUES (${uuidv7()}, ${piece.id}, 'ai', ${fields.status}, 'fal', ${entry.id}, ${fields.key ?? null}, ${fields.bytes ?? null}, ${fields.triangles ?? null}, ${fields.fit ?? null}, ${fields.cost ?? null}, ${fields.reason ?? null})
      ON CONFLICT (product_id, origin) DO UPDATE SET status = excluded.status, model = excluded.model, storage_key = excluded.storage_key, bytes = excluded.bytes,
        triangles = excluded.triangles, fit = excluded.fit, cost_micros = excluded.cost_micros, failure_reason = excluded.failure_reason, updated_at = now()
    `;
    await upsert({ status: "running" });
    try {
      const { glbUrl } = await generate3d(entry.id as Fal3dModel, piece.studio!, { key: env.FAL_KEY });
      // fal has made (and charged for) the model: it is counted now, whatever happens to it next.
      await usage.record({ feature: "model_3d", model: entry, surface: "batch", actorKey: null, usage: { units: 1 }, paid: true });
      const response = await fetch(glbUrl, { signal: AbortSignal.timeout(120_000) });
      if (!response.ok) throw new Error(`download ${response.status}`);
      const original = new Uint8Array(await response.arrayBuffer());
      const reference = makeParts(facts).parts.map((part) => part.mesh);
      const fitted = await fitAiModel(original, reference, { w: facts.dims.w / 100, d: facts.dims.d / 100, h: facts.dims.h / 100 });
      const report = validator === null ? null : await validator.validateBytes(fitted.glb, { maxIssues: 10 });
      const errors = report?.issues.numErrors ?? 0;
      const key = `catalog/ai-3d/${short}/${piece.slug.replace(/[^a-z0-9-]/gi, "").slice(0, 80)}.glb`;
      await files.putObject({ key, body: fitted.glb, contentType: "model/gltf-binary" });
      const ready = fitted.fit >= MIN_FIT && errors === 0;
      await upsert({
        status: ready ? "ready" : "rejected",
        key,
        bytes: fitted.bytes,
        triangles: fitted.triangles,
        fit: Math.round(fitted.fit * 1000) / 1000,
        cost: Math.round(unit * 1e6),
        reason: ready ? null : errors > 0 ? `${errors} glTF errors` : `fit ${fitted.fit.toFixed(2)} below ${MIN_FIT}`,
      });
      made += 1;
      out(`  ${ready ? "ready   " : "rejected"} fit ${fitted.fit.toFixed(2)} ${(fitted.bytes / 1_048_576).toFixed(1)} MB  ${piece.title_en.slice(0, 60)}`);
    } catch (error) {
      const reason = error instanceof Fal3dError ? `${error.reason}: ${error.message}` : error instanceof Error ? error.message.slice(0, 160) : "failed";
      await upsert({ status: "failed", reason });
      out(`  failed   ${reason}  ${piece.title_en.slice(0, 60)}`);
      if (error instanceof Fal3dError && error.reason === "refused") break;
    }
  }
  out(`${made} models made.`);
}

main()
  .catch((error: unknown) => {
    process.stderr.write(`[models] ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(() => sql.end({ timeout: 5 }));
