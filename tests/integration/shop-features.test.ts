/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Integration tests for the shop features of docs/adr/034: staff products, the dashboards' events, "Complete the set" and "Fits your space".
 */

import { readFile } from "node:fs/promises";

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { uuidv7 } from "uuidv7";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { newProductSchema, productDetailsSchema } from "@/lib/admin/catalog";
import { createCatalogAdminStore, MAX_PRODUCT_PHOTOS } from "@/lib/admin/catalog-store";
import { createDashboardStore } from "@/lib/admin/dashboard-store";
import { recordConciergeEvents, recordRecoEvents } from "@/lib/admin/events";
import { periodFor } from "@/lib/admin/metrics";
import { catalogFixtureSchema } from "@/lib/catalog/input";
import { createCatalogQueries } from "@/lib/catalog/queries";
import { upsertCatalog } from "@/lib/catalog/write";
import * as schema from "@/lib/db/schema";
import { AGAINST_A_WALL, fitsYourSpace, WALL_CLEARANCE_CM, WALL_PIECE_MIN_CM } from "@/lib/prefs/preferences";
import { completeTheSet } from "@/lib/reco/complete-set";
import { createJudgmentStore, judgmentKey } from "@/lib/search/judgments-store";
import { createTasteGraph } from "@/lib/reco/store";

const url = process.env.DATABASE_URL;

describe.skipIf(url === undefined || url === "")("shop features (docs/adr/034)", () => {
  let connection: ReturnType<typeof postgres>;
  let staff: { userId: string; email: string };

  beforeAll(async () => {
    connection = postgres(url as string, { max: 4, onnotice: () => {} });
    const db = drizzle(connection, { schema });
    await migrate(db, { migrationsFolder: "./drizzle" });
    await connection`TRUNCATE products, brands, categories, interactions, item_neighbors, concierge_events, reco_events CASCADE`;
    await upsertCatalog(db, catalogFixtureSchema.parse(JSON.parse(await readFile("src/lib/catalog/fixtures/specimen.json", "utf8"))).products);
    await connection`UPDATE product_variants SET stock = 12`;
    const id = uuidv7();
    staff = { userId: id, email: `merch.${id}@vitrine.test` };
    await connection`INSERT INTO users (id, name, email, email_verified, role) VALUES (${id}, 'Merch', ${staff.email}, true, 'merchandiser')`;
  });

  afterAll(async () => {
    await connection?.end();
  });

  describe("a product made by staff", () => {
    const form = { kind: "CABINET", titleEn: "Oak sideboard, made in Volos", titleEl: "Δρύινος μπουφές", descriptionEn: "", descriptionEl: "", price: "689", stock: "3", width: "160", depth: "45", height: "80" };

    it("starts as a draft nobody outside the staff can see, audited, with its stock and search text", async () => {
      const store = createCatalogAdminStore(connection);
      const created = await store.createProduct(newProductSchema.parse(form), staff);
      if (!created.ok) throw new Error("not created");
      const [row] = await connection<{ status: string; source: string; source_id: string; price_cents: number; dims_cm: unknown; search_title: string; staff_edited_at: Date | null }[]>`
        SELECT status, source, source_id, price_cents, dims_cm, search_title, staff_edited_at FROM products WHERE id = ${created.id}
      `;
      expect(row).toMatchObject({ status: "draft", source: "staff", source_id: created.id, price_cents: 68_900, dims_cm: { w: 160, d: 45, h: 80 } });
      expect(row!.search_title).toContain("oak sideboard");
      expect(row!.staff_edited_at).not.toBeNull();
      expect((await store.readProduct(created.id))!.variants).toEqual([expect.objectContaining({ stock: 3 })]);
      const [audit] = await connection<{ action: string; actor_email: string }[]>`SELECT action, actor_email FROM audit_log WHERE entity_id = ${created.id} AND action = 'product.create'`;
      expect(audit).toEqual({ action: "product.create", actor_email: staff.email });
      // A draft is not in the shop.
      expect(await createCatalogQueries(connection).productBySlug(created.slug, "en")).toBeNull();
    });

    it("goes on sale only with a photograph, and then is in the shop", async () => {
      const store = createCatalogAdminStore(connection);
      const created = await store.createProduct(newProductSchema.parse({ ...form, titleEn: "Walnut console" }), staff);
      if (!created.ok) throw new Error("not created");
      const details = productDetailsSchema.parse({ titleEn: "Walnut console", titleEl: "", descriptionEn: "", descriptionEl: "", highlightsEn: "", highlightsEl: "", price: "689", compareAt: "", status: "active" });

      await expect(store.updateProduct(created.id, details, staff)).resolves.toEqual({ ok: false, reason: "needs_photo" });

      const photo = { src: `/media/catalog/staff/${created.id.replace(/-/g, "")}/a.webp`, width: 1100, height: 900, bytes: 84_000, whiteGround: true };
      await expect(store.addPhoto(created.id, photo, staff)).resolves.toMatchObject({ ok: true, position: 0 });
      await expect(store.updateProduct(created.id, details, staff)).resolves.toMatchObject({ ok: true });
      const inShop = await createCatalogQueries(connection).productBySlug(created.slug, "en");
      expect(inShop).toMatchObject({ title: "Walnut console" });
      expect(inShop!.media[0]).toMatchObject({ src: photo.src });
    });

    it("keeps at most eight photographs, and refuses one for a product that does not exist", async () => {
      const store = createCatalogAdminStore(connection);
      const created = await store.createProduct(newProductSchema.parse({ ...form, titleEn: "Pine shelf" }), staff);
      if (!created.ok) throw new Error("not created");
      for (let index = 0; index < MAX_PRODUCT_PHOTOS; index += 1) {
        await store.addPhoto(created.id, { src: `/media/catalog/staff/x/${index}.webp`, width: 800, height: 800, bytes: 1, whiteGround: false }, staff);
      }
      await expect(store.addPhoto(created.id, { src: "/media/catalog/staff/x/9.webp", width: 800, height: 800, bytes: 1, whiteGround: false }, staff)).resolves.toEqual({ ok: false, reason: "too_many" });
      await expect(store.addPhoto(uuidv7(), { src: "/media/catalog/staff/x/0.webp", width: 800, height: 800, bytes: 1, whiteGround: false }, staff)).resolves.toEqual({ ok: false, reason: "not_found" });
    });
  });

  describe("the dashboards' events", () => {
    it("records Concierge turns and tools without words, and the dashboard's figures match a hand count", async () => {
      const now = new Date();
      await recordConciergeEvents(
        connection,
        [
          { kind: "turn", surface: "chat", outcome: "ok", latencyMs: 900, steps: 2 },
          { kind: "turn", surface: "chat", outcome: "ok", latencyMs: 2_100, steps: 3 },
          { kind: "tool", surface: "chat", tool: "add_to_cart", outcome: "ok", latencyMs: 40 },
          { kind: "tool", surface: "chat", tool: "add_to_cart", outcome: "undone" },
          { kind: "tool", surface: "chat", tool: "start_checkout", outcome: "approval_asked" },
          { kind: "tool", surface: "chat", tool: "start_checkout", outcome: "declined" },
          { kind: "refused", surface: "chat", outcome: "credits" },
        ],
        { now },
      );
      const figures = await createDashboardStore(connection).conciergeFigures(periodFor(7, new Date(now.getTime() + 1_000)));
      expect(figures).toMatchObject({ turns: 2, refused: 1, latencyP50: 900, latencyP95: 2_100, approvalRate: 0, undoRate: 1, costPerTurnMicros: 0 });
      expect(figures.tools.find((tool) => tool.tool === "start_checkout")).toMatchObject({ approvalsAsked: 1, declined: 1 });
      const columns = await connection<{ column_name: string }[]>`SELECT column_name FROM information_schema.columns WHERE table_name = 'concierge_events'`;
      expect(columns.map((column) => column.column_name).sort()).toEqual(["id", "kind", "latency_ms", "occurred_at", "outcome", "steps", "surface", "tool"]);
    });

    it("counts shelves seen, opened and bought from, and forgets a product that is gone rather than losing the batch", async () => {
      const now = new Date();
      const [product] = await connection<{ id: string }[]>`SELECT id FROM products WHERE status = 'active' ORDER BY source_id LIMIT 1`;
      await recordRecoEvents(
        connection,
        [
          { shelf: "complete-set", kind: "impression", productId: null },
          { shelf: "complete-set", kind: "impression", productId: null },
          { shelf: "complete-set", kind: "click", productId: product!.id },
          { shelf: "complete-set", kind: "add_to_cart", productId: product!.id },
          { shelf: "popular", kind: "click", productId: uuidv7() },
        ],
        { now },
      );
      const figures = await createDashboardStore(connection).recoFigures(periodFor(7, new Date(now.getTime() + 1_000)));
      expect(figures.shelves.find((shelf) => shelf.shelf === "complete-set")).toEqual({ shelf: "complete-set", impressions: 2, clicks: 1, adds: 1, clickRate: 0.5, addRate: 1 });
      expect(figures.topPieces[0]).toMatchObject({ id: product!.id, clicks: 1, adds: 1 });
      const [orphan] = await connection<{ product_id: string | null }[]>`SELECT product_id FROM reco_events WHERE shelf = 'popular'`;
      expect(orphan).toEqual({ product_id: null });
    });
  });

  it("completes a set from the stored neighbour lists with pieces from other categories only", async () => {
    const graph = createTasteGraph(connection);
    await graph.rebuild({ now: Date.now() });
    const [anchor] = await connection<{ id: string }[]>`SELECT p.id FROM products p JOIN categories c ON c.id = p.category_id WHERE c.slug = 'seating' AND p.status = 'active' ORDER BY p.source_id LIMIT 1`;
    const { neighbours, categories } = await graph.neighboursOf([anchor!.id]);
    expect(neighbours.get(anchor!.id)?.length ?? 0).toBeGreaterThan(0);
    const set = completeTheSet({ anchors: [anchor!.id], neighbours, categoryOf: (id) => categories.get(id), limit: 4 });
    for (const suggestion of set) {
      expect(categories.get(suggestion.productId)).not.toBe("seating");
      expect(suggestion.anchorId).toBe(anchor!.id);
    }
  });

  it("finds pieces that fit a saved wall from the catalogue's measurements", async () => {
    const rooms = [{ name: "Living room", wallCm: 260 }];
    const candidates = await createCatalogQueries(connection).forWalls({ locale: "en", kinds: [...AGAINST_A_WALL], minWidthCm: WALL_PIECE_MIN_CM, maxWidthCm: 260 - WALL_CLEARANCE_CM, limit: 60 });
    for (const candidate of candidates) {
      expect(AGAINST_A_WALL.has(candidate.card.kind)).toBe(true);
      expect(candidate.dimsCm.w).toBeLessThanOrEqual(240);
    }
    const fits = fitsYourSpace(candidates.map((entry) => ({ productId: entry.card.id, category: entry.card.category, dims: entry.dimsCm })), rooms);
    for (const fit of fits) expect(fit.spareCm).toBeGreaterThanOrEqual(0);
  });
});

describe.skipIf(url === undefined || url === "")("E1 judgements (docs/adr/036)", () => {
  let connection: ReturnType<typeof postgres>;

  beforeAll(async () => {
    connection = postgres(url as string, { max: 2, onnotice: () => {} });
    await migrate(drizzle(connection, { schema }), { migrationsFolder: "./drizzle" });
  });

  afterAll(async () => {
    await connection?.end();
  });

  it("keeps one grade per query, language and product, folded, and a second grade replaces the first", async () => {
    const store = createJudgmentStore(connection);
    const [product] = await connection<{ id: string }[]>`SELECT id FROM products ORDER BY source_id LIMIT 1`;
    expect(await store.judge({ query: "Καναπές", locale: "el", productId: product!.id, grade: 2, userId: null })).toBe(true);
    expect(await store.judge({ query: "καναπεσ ", locale: "el", productId: product!.id, grade: 3, userId: null })).toBe(true);
    const all = await store.all();
    expect(all.get(`${judgmentKey("Καναπές")}|el`)).toEqual(new Map([[product!.id, 3]]));
    // A product that does not exist is not graded.
    expect(await store.judge({ query: "sofa", locale: "en", productId: uuidv7(), grade: 1, userId: null })).toBe(false);
  });
});
