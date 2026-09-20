/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Job processor that builds the weekly PDF report, stores it, and emails the admins a link.
 */

import { serverEnv } from "@/env";
import { createDashboardStore } from "@/lib/admin/dashboard-store";
import { dayKey, weekEnding } from "@/lib/admin/metrics";
import { sql } from "@/lib/db/client";
import { appMailer } from "@/lib/email/server";
import { emailLocale, weeklyReport } from "@/lib/email/templates";
import type { JobPayloads } from "@/lib/jobs/types";
import { loggerFor } from "@/lib/log";
import { createReportStore, REPORT_KIND, reportKey } from "@/lib/report/store";
import { createSupportStore } from "@/lib/support/store";
import { money, summarize, weeklyReportPdf } from "@/lib/report/weekly";
import { storage } from "@/lib/storage";

/**
 * The weekly report (docs/adr/020).
 *
 * It reads the same store the dashboards read, writes the PDF into the shop's
 * storage under one key per week, records the row, and emails every admin a
 * link that works for seven days. Running it twice for the same week replaces
 * the file and the row rather than adding a second one, so a retry is safe.
 *
 * The link is short-lived and signed; the file itself is never attached, so a
 * forwarded email does not carry the shop's figures with it forever.
 */

const LINK_SECONDS = 7 * 24 * 60 * 60;
const DAY = 24 * 60 * 60 * 1000;

export async function processWeeklyReport(payload: JobPayloads["weekly-report"], jobId: string) {
  const log = loggerFor({ job: "weekly-report", jobId });
  // The week that has ended: up to yesterday, so a Monday report covers whole days.
  const endDay = payload.endDay ?? dayKey(new Date(Date.now() - DAY));
  const period = weekEnding(endDay);

  const dashboards = createDashboardStore(sql);
  const [overview, ai, support] = await Promise.all([dashboards.overview(period), dashboards.aiSpend(period), createSupportStore(sql).stats(period)]);

  const generatedAt = new Date();
  const bytes = weeklyReportPdf({ period: { start: period.dayKeys[0]!, end: endDay }, generatedAt, overview, ai, support });
  const key = reportKey(REPORT_KIND, endDay);

  const store = await storage();
  await store.putObject({ key, body: bytes, contentType: "application/pdf" });

  const reports = createReportStore(sql);
  const summary = summarize({ overview, ai, support });
  const reportId = await reports.save(
    { kind: REPORT_KIND, periodStart: period.dayKeys[0]!, periodEnd: endDay, storageKey: key, bytes: bytes.byteLength, summary },
    generatedAt,
  );

  const url = await store.presignedDownloadUrl({ key, expiresInSeconds: LINK_SECONDS });
  const mailer = appMailer();
  const admins = await reports.admins();
  // ADMIN_EMAILS is how the first admin exists before anyone has signed in (docs/adr/016).
  const recipients = new Set([...admins.map((admin) => admin.email), ...serverEnv().ADMIN_EMAILS]);
  let emailed = 0;

  for (const email of recipients) {
    const name = admins.find((admin) => admin.email === email)?.name ?? email.split("@")[0]!;
    const locale = emailLocale("en");
    try {
      await mailer.sendEmail({
        to: email,
        kind: "weekly_report",
        locale,
        content: weeklyReport(locale, {
          name,
          start: period.dayKeys[0]!,
          end: endDay,
          url,
          sales: money(summary.salesCents),
          orders: summary.orders,
          ai: money(Math.round(summary.aiMicros / 10_000)),
        }),
      });
      emailed += 1;
    } catch (error) {
      log.warn({ err: error }, "weekly report email not written");
    }
  }

  const stats = { reportId, key, bytes: bytes.byteLength, week: `${period.dayKeys[0]!}..${endDay}`, emailed, reason: payload.reason };
  log.info(stats, "weekly report built");
  return stats;
}
