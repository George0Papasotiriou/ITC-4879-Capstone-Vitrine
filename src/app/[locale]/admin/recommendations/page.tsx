/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * The recommendations dashboard: each shelf's click-through and how often what it suggests is put in the cart.
 */

import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";

import { DayBars, Panel, ShareTable } from "@/components/admin/charts";
import { PeriodNav } from "@/components/admin/period-nav";
import { SmartLink } from "@/components/ui/smart-link";
import { requireLocale } from "@/i18n/params";
import { EVENTS_KEEP_DAYS } from "@/lib/admin/events";
import { parsePeriod, periodFor } from "@/lib/admin/metrics";
import { dashboards } from "@/lib/admin/server";
import { requirePermission } from "@/lib/auth/session";

/**
 * docs/adr/034. For "reports:read". A shelf is counted as seen once per page
 * visit, a click when a piece on it is opened, and an add when that piece goes
 * into the cart within half an hour. Nothing identifies the shopper; the
 * shelf names are the Taste Graph's (for you, pairs with, complete the set …).
 */

export async function generateMetadata({ params }: PageProps<"/[locale]/admin/recommendations">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "admin.reco" });
  return { title: t("title"), robots: { index: false, follow: false } };
}

export default async function RecommendationsDashboard({ params, searchParams }: PageProps<"/[locale]/admin/recommendations">) {
  const locale = await requireLocale(params);
  await requirePermission(locale, `/${locale}/admin/recommendations`, "reports:read");
  const days = parsePeriod((await searchParams).days);
  const period = periodFor(days);
  const figures = await (await dashboards()).recoFigures(period, locale);

  const t = await getTranslations("admin.reco");
  const d = await getTranslations("admin.dashboard");
  const format = await getFormatter();
  const none = d("none");
  const percent = (value: number | null) => (value === null ? none : format.number(value, { style: "percent", maximumFractionDigits: 1 }));
  const dayLabel = (day: string) => format.dateTime(new Date(`${day}T12:00:00Z`), { day: "numeric", month: "short", timeZone: "UTC" });
  const shelfName = (shelf: string) => (t.has(`shelves.${shelf}`) ? t(`shelves.${shelf}`) : shelf);

  return (
    <main className="mx-auto w-full max-w-[1440px] px-6 py-10 md:px-10 md:py-16" data-agent-id="admin:recommendations">
      <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="font-display text-3xl">{t("title")}</h1>
          <p className="text-slate mt-3 max-w-[70ch]">{t("lede", { days: EVENTS_KEEP_DAYS })}</p>
          <p className="mt-2 text-sm">
            <a href={`/api/admin/export/recommendations?days=${days}`} className="underline underline-offset-4" data-agent-id="reco:export">
              {t("export")}
            </a>
          </p>
        </div>
        <PeriodNav base="/admin/recommendations" days={days} agentPrefix="reco" />
      </div>

      <Panel id="reco-shelves" title={t("shelvesTitle")} lede={t("shelvesLede")} className="mt-10">
        {figures.shelves.length === 0 ? (
          <p className="text-slate text-sm">{t("empty")}</p>
        ) : (
          <ShareTable
            caption={t("shelvesTitle")}
            columns={[t("columns.shelf"), t("columns.seen"), t("columns.clicks"), t("columns.clickRate"), t("columns.adds"), t("columns.addRate")]}
            agentId="reco:shelves"
            rows={figures.shelves.map((shelf) => ({
              key: shelf.shelf,
              label: shelfName(shelf.shelf),
              value: shelf.impressions,
              cells: [format.number(shelf.impressions), format.number(shelf.clicks), percent(shelf.clickRate), format.number(shelf.adds), percent(shelf.addRate)],
            }))}
          />
        )}
      </Panel>

      <div className="mt-12 grid gap-x-14 gap-y-12 lg:grid-cols-[3fr_2fr]">
        <Panel id="reco-by-day" title={t("byDay.title")}>
          {figures.clicksByDay.every((entry) => entry.value === 0) ? (
            <p className="text-slate text-sm">{t("empty")}</p>
          ) : (
            <DayBars
              data={figures.clicksByDay}
              label={t("byDay.chartLabel", { max: format.number(Math.max(0, ...figures.clicksByDay.map((entry) => entry.value))) })}
              formatValue={(value) => format.number(value)}
              formatDay={dayLabel}
              tableCaption={t("byDay.title")}
              columns={[t("byDay.day"), t("byDay.value")]}
            />
          )}
        </Panel>

        <Panel id="reco-top" title={t("top.title")}>
          {figures.topPieces.length === 0 ? (
            <p className="text-slate text-sm">{t("empty")}</p>
          ) : (
            <ShareTable
              caption={t("top.title")}
              columns={[t("top.piece"), t("columns.clicks"), t("columns.adds")]}
              agentId="reco:top"
              rows={figures.topPieces.map((piece) => ({
                key: piece.id,
                label: (
                  <SmartLink href={`/staff/products/${piece.id}`} className="underline-offset-4">
                    {piece.title}
                  </SmartLink>
                ),
                value: piece.clicks,
                cells: [format.number(piece.clicks), format.number(piece.adds)],
              }))}
            />
          )}
        </Panel>
      </div>
    </main>
  );
}
