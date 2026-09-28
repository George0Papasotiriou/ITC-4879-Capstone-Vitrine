/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Integration tests for the worker job that stores the catalogue's 3D scans.
 */

import { readFile } from "node:fs/promises";

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { ABO_BUCKET } from "@/lib/catalog/abo";
import { glbFromParts } from "@/lib/catalog/glb";
import { catalogFixtureSchema, type ProductInput } from "@/lib/catalog/input";
import { modelKey } from "@/lib/catalog/model-compress";
import { upsertCatalog } from "@/lib/catalog/write";
import * as schema from "@/lib/db/schema";
import { compressPendingModels } from "@/worker/processors/catalog-models";

/**
 * docs/adr/035. The job reads which pieces still need their scan, fetches
 * each, compresses it, stores it, and only then adds the media row. The
 * download is a stand-in here: tests never reach ABO's bucket.
 */

const url = process.env.DATABASE_URL;

describe.skipIf(url === undefined || url === "")("3D scans job", () => {
  let connection: ReturnType<typeof postgres>;
  let fixture: ProductInput[];
  const stored = new Map<string, number>();
  const files = {
    putObject: async ({ key, body }: { key: string; body: Uint8Array }) => {
      stored.set(key, body.byteLength);
    },
  };
  const log = { warn: () => {} };
  // A real glTF binary: an 80 × 40 × 75 cm box, the size of a sideboard.
  const glb = glbFromParts([{ x: 0, y: 0.375, z: 0, width: 0.8, height: 0.75, depth: 0.4, color: "#8a6a4a" }]);
  const requested: string[] = [];
  const answers = new Map<string, () => Response>();
  const download = async (address: string) => {
    requested.push(address);
    const answer = answers.get(address);
    return answer === undefined ? new Response(new Uint8Array(glb), { status: 200, headers: { "content-length": String(glb.byteLength) } }) : answer();
  };

  beforeAll(async () => {
    connection = postgres(url as string, { max: 2, onnotice: () => {} });
    const db = drizzle(connection, { schema });
    await migrate(db, { migrationsFolder: "./drizzle" });
    await connection`TRUNCATE products, brands, categories CASCADE`;
    const specimen = catalogFixtureSchema.parse(JSON.parse(await readFile("src/lib/catalog/fixtures/specimen.json", "utf8"))).products;
    // Three pieces with scans, the first the most popular.
    fixture = specimen.map((product, index) =>
      index < 3 ? { ...product, modelSource: `${index}/SCAN${index}.glb`, popularity: 100 - index } : { ...product, modelSource: undefined },
    );
    await upsertCatalog(db, fixture);
  });

  beforeEach(() => {
    stored.clear();
    requested.length = 0;
    answers.clear();
  });

  afterAll(async () => {
    await connection?.end();
  });

  const models = () => connection<{ source_id: string; src: string; bytes: number }[]>`
    SELECT p.source_id, m.src, m.bytes FROM product_media m JOIN products p ON p.id = m.product_id WHERE m.kind = 'model' ORDER BY p.source_id
  `;

  it("stores the most popular pending scans first, then adds their media rows", async () => {
    const stats = await compressPendingModels({ sql: connection, files, download, log }, 2);
    expect(requested).toEqual([`${ABO_BUCKET}/3dmodels/original/0/SCAN0.glb`, `${ABO_BUCKET}/3dmodels/original/1/SCAN1.glb`]);
    expect(stats).toMatchObject({ processed: 2, skipped: 0, remaining: 1, bytesIn: glb.byteLength * 2 });

    const rows = await models();
    expect(rows.map((row) => row.src).sort()).toEqual([`/media/${modelKey(fixture[0]!.sourceId)}`, `/media/${modelKey(fixture[1]!.sourceId)}`].sort());
    // What was stored is what the row says it is.
    for (const row of rows) expect(stored.get(row.src.replace("/media/", ""))).toBe(row.bytes);
  });

  it("does not make a scan twice: the next run takes only what is left", async () => {
    const stats = await compressPendingModels({ sql: connection, files, download, log }, 8);
    expect(requested).toEqual([`${ABO_BUCKET}/3dmodels/original/2/SCAN2.glb`]);
    expect(stats).toMatchObject({ processed: 1, remaining: 0 });
    expect(await compressPendingModels({ sql: connection, files, download, log }, 8)).toMatchObject({ processed: 0, remaining: 0 });
  });

  it("sets aside a scan that cannot be fetched, is too large or cannot be read, without storing anything", async () => {
    await connection`DELETE FROM product_media WHERE kind = 'model'`;
    answers.set(`${ABO_BUCKET}/3dmodels/original/0/SCAN0.glb`, () => new Response("gone", { status: 404 }));
    answers.set(`${ABO_BUCKET}/3dmodels/original/1/SCAN1.glb`, () => new Response(new Uint8Array(glb), { headers: { "content-length": String(200 * 1024 * 1024) } }));
    answers.set(`${ABO_BUCKET}/3dmodels/original/2/SCAN2.glb`, () => new Response("not a model"));

    const stats = await compressPendingModels({ sql: connection, files, download, log }, 8);
    expect(stats).toMatchObject({ processed: 0, skipped: 3, remaining: 0 });
    expect(stored.size).toBe(0);
    expect(await models()).toEqual([]);
    const [left] = await connection<{ n: number }[]>`SELECT count(*)::int AS n FROM products WHERE model_source IS NOT NULL`;
    // Set aside until the next deploy's sync offers them again.
    expect(left?.n).toBe(0);
  });
});
