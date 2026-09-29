/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Server-side access to the shop-running stores: catalogue editing, dashboards, the audit log, and search recording.
 */

import { after, connection } from "next/server";

import { listAudit } from "@/lib/admin/audit";
import { createCatalogAdminStore, type CatalogAdminStore } from "@/lib/admin/catalog-store";
import { createDashboardStore, type DashboardStore } from "@/lib/admin/dashboard-store";
import { recordConciergeEvents, recordRecoEvents, type ConciergeEventInput, type RecoEventInput } from "@/lib/admin/events";
import { recordSearch, type SearchEventInput } from "@/lib/admin/search-events";
import { createReportStore, type ReportStore } from "@/lib/report/store";
import { sql } from "@/lib/db/client";
import { bumpCatalogVersion } from "@/lib/kv/cache";
import { logger } from "@/lib/log";

let catalogStore: CatalogAdminStore | undefined;
let dashboardStore: DashboardStore | undefined;

export async function catalogAdmin(): Promise<CatalogAdminStore> {
  await connection();
  return (catalogStore ??= withCatalogVersion(createCatalogAdminStore(sql)));
}

/**
 * Every staff change to the catalogue moves its version on (docs/adr/039), so
 * no cached search ranking made before the change is read after it.
 */
function withCatalogVersion(store: CatalogAdminStore): CatalogAdminStore {
  const thenBump =
    <A extends unknown[], R>(change: (...args: A) => Promise<R>) =>
    async (...args: A): Promise<R> => {
      const result = await change(...args);
      await bumpCatalogVersion();
      return result;
    };
  return {
    ...store,
    updateProduct: thenBump(store.updateProduct),
    setStock: thenBump(store.setStock),
    createProduct: thenBump(store.createProduct),
    addPhoto: thenBump(store.addPhoto),
  };
}

export async function dashboards(): Promise<DashboardStore> {
  await connection();
  return (dashboardStore ??= createDashboardStore(sql));
}

let reportStore: ReportStore | undefined;

export async function reports(): Promise<ReportStore> {
  await connection();
  return (reportStore ??= createReportStore(sql));
}

export async function auditEntries(options: Parameters<typeof listAudit>[1]) {
  await connection();
  return listAudit(sql, options);
}

/** Written after the response when there is one to wait for; during a stream, straight away (the write never throws). */
function afterOrNow(write: () => Promise<void>): void {
  try {
    after(write);
  } catch {
    void write();
  }
}

/** Concierge turns and tool runs, for its dashboard (docs/adr/034). */
export function logConciergeEvents(events: ConciergeEventInput[]): void {
  if (events.length === 0) return;
  afterOrNow(() => recordConciergeEvents(sql, events, { onError: (error) => logger.warn({ err: error }, "Concierge event not recorded") }));
}

/** Shelves seen, opened and bought from, for the recommendations dashboard (docs/adr/034). */
export function logRecoEvents(events: RecoEventInput[]): void {
  if (events.length === 0) return;
  afterOrNow(() => recordRecoEvents(sql, events, { onError: (error) => logger.warn({ err: error }, "Recommendation event not recorded") }));
}

/** Records a search after the response is sent, so it never slows a search down (docs/adr/018). */
export function logSearch(event: SearchEventInput): void {
  after(() => recordSearch(sql, event, { onError: (error) => logger.warn({ err: error }, "Search event not recorded") }));
}
