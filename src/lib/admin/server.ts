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
import { recordSearch, type SearchEventInput } from "@/lib/admin/search-events";
import { createReportStore, type ReportStore } from "@/lib/report/store";
import { sql } from "@/lib/db/client";
import { logger } from "@/lib/log";

let catalogStore: CatalogAdminStore | undefined;
let dashboardStore: DashboardStore | undefined;

export async function catalogAdmin(): Promise<CatalogAdminStore> {
  await connection();
  return (catalogStore ??= createCatalogAdminStore(sql));
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

/** Records a search after the response is sent, so it never slows a search down (docs/adr/018). */
export function logSearch(event: SearchEventInput): void {
  after(() => recordSearch(sql, event, { onError: (error) => logger.warn({ err: error }, "Search event not recorded") }));
}
