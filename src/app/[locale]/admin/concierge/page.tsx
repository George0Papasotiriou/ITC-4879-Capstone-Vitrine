/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * The Concierge dashboard: how often it is used, how quick it is, and whether people accept and keep what it does.
 */

import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";

import { DayBars, Panel, ShareTable, Stat } from "@/components/admin/charts";
import { PeriodNav } from "@/components/admin/period-nav";
import { SmartLink } from "@/components/ui/smart-link";
import { requireLocale } from "@/i18n/params";
import { EVENTS_KEEP_DAYS } from "@/lib/admin/events";
import { parsePeriod, periodFor } from "@/lib/admin/metrics";
import { dashboards } from "@/lib/admin/server";
import { requirePermission } from "@/lib/auth/session";

/**
 * docs/adr/034. For "reports:read". Every figure comes from the anonymous
 * Concierge log and the usage log; a rate with nothing to divide by shows as
 * a dash, never as 0%. Demo answers are counted as turns (they are real use of
 * the Concierge) but cost nothing, so the cost per turn reads the usage log.
 */

export async function generateMetadata({ params }: PageProps<"/[locale]/admin/concierge">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "admin.concierge" });
  return { title: t("title"), robots: { index: false, follow: false } };
}

export default async function ConciergeDashboard({ params, searchParams }: PageProps<"/[locale]/admin/concierge">) {
  const locale = await requireLocale(params);
  await requirePermission(locale, `/${locale}/admin/concierge`, "reports:read");
  const days = parsePeriod((await searchParams).days);
  const period = periodFor(days);
  const figures = await (await dashboards()).conciergeFigures(period);

  const t = await getTranslations("admin.concierge");
  const d = await getTranslations("admin.dashboard");
  const format = await getFormatter();
  const none = d("none");
  const percent = (value: number | null) => (value === null ? none : format.number(value, { style: "percent", maximumFractionDigits: 1 }));
  const seconds = (ms: number | null) => (ms === null ? none : format.number(ms / 1000, { style: "unit", unit: "second", maximumFractionDigits: 1 }));
  const euro = (micros: number | null) =>
    micros === null ? none : format.number(micros / 1_000_000, { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: micros > 0 && micros < 1_000_000 ? 4 : 2 });
  const dayLabel = (day: string) => format.dateTime(new Date(`${day}T12:00:00Z`), { day: "numeric", month: "short", timeZone: "UTC" });
  const reason = (value: string) => (t.has(`refusedReasons.${value}`) ? t(`refusedReasons.${value}`) : value);

  return (
    <main className="mx-auto w-full max-w-[1440px] px-6 py-10 md:px-10 md:py-16" data-agent-id="admin:concierge">
      <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="font-display text-3xl">{t("title")}</h1>
          <p className="text-slate mt-3 max-w-[70ch]">{t("lede", { days: EVENTS_KEEP_DAYS })}</p>
          <p className="text-slate mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm">
            <SmartLink href="/admin/ai" className="underline underline-offset-4">
              {t("spendLink")}
            </SmartLink>
            <a href={`/api/admin/export/concierge?days=${days}`} className="underline underline-offset-4" data-agent-id="concierge:export">
              {t("export")}
            </a>
          </p>
        </div>
        <PeriodNav base="/admin/concierge" days={days} agentPrefix="concierge" />
      </div>

      <section aria-labelledby="concierge-summary" className="mt-10">
        <h2 id="concierge-summary" className="sr-only">
          {t("summary")}
        </h2>
        <dl className="border-hairline bg-hairline grid gap-px overflow-hidden border sm:grid-cols-2 xl:grid-cols-4 [&>div]:bg-glass">
          <Stat label={t("turns")} value={format.number(figures.turns)} note={t("refusedNote", { count: figures.refused })} agentId="concierge:turns" />
          <Stat label={t("latency")} value={seconds(figures.latencyP50)} note={t("latencyNote", { p95: seconds(figures.latencyP95) })} agentId="concierge:latency" />
          <Stat label={t("approvalRate")} value={percent(figures.approvalRate)} note={t("approvalNote")} agentId="concierge:approval-rate" />
          <Stat label={t("undoRate")} value={percent(figures.undoRate)} note={t("undoNote")} agentId="concierge:undo-rate" />
        </dl>
        <p className="text-slate mt-3 text-sm" data-agent-id="concierge:cost-per-turn">
          {t("costPerTurn", { cost: euro(figures.costPerTurnMicros), total: euro(figures.costMicros) })}
        </p>
      </section>

      <Panel id="concierge-by-day" title={t("byDay.title")} className="mt-12">
        {figures.turns === 0 ? (
          <p className="text-slate text-sm">{t("empty")}</p>
        ) : (
          <DayBars
            data={figures.turnsByDay}
            label={t("byDay.chartLabel", { max: format.number(Math.max(0, ...figures.turnsByDay.map((entry) => entry.value))) })}
            formatValue={(value) => format.number(value)}
            formatDay={dayLabel}
            tableCaption={t("byDay.title")}
            columns={[t("byDay.day"), t("byDay.value")]}
          />
        )}
      </Panel>

      <div className="mt-12 grid gap-x-14 gap-y-12 lg:grid-cols-[2fr_1fr]">
        <Panel id="concierge-tools" title={t("tools.title")} lede={t("tools.lede")}>
          {figures.tools.length === 0 ? (
            <p className="text-slate text-sm">{t("empty")}</p>
          ) : (
            <ShareTable
              caption={t("tools.title")}
              columns={[t("tools.tool"), t("tools.runs"), t("tools.errors"), t("tools.approved"), t("tools.declined"), t("tools.undone")]}
              agentId="concierge:tools"
              rows={figures.tools.map((tool) => ({
                key: tool.tool,
                label: <code className="text-sm">{tool.tool}</code>,
                value: tool.runs + tool.errors,
                cells: [format.number(tool.runs), format.number(tool.errors), format.number(tool.approved), format.number(tool.declined), format.number(tool.undone)],
              }))}
            />
          )}
        </Panel>

        <Panel id="concierge-refused" title={t("refused.title")} lede={t("refused.lede")}>
          {figures.refusedBy.length === 0 ? (
            <p className="text-slate text-sm">{t("refused.none")}</p>
          ) : (
            <ShareTable
              caption={t("refused.title")}
              columns={[t("refused.reason"), t("refused.count")]}
              agentId="concierge:refused"
              rows={figures.refusedBy.map((row) => ({ key: row.reason, label: reason(row.reason), value: row.count, cells: [format.number(row.count)] }))}
            />
          )}
        </Panel>
      </div>
    </main>
  );
}
