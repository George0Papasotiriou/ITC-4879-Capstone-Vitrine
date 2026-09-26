/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * The AI page: what the shop's AI features cost, per day and per feature, with the switches that govern them.
 */

import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";

import { AiSettings } from "@/components/admin/ai-settings";
import { DayBars, Panel, ShareTable, Stat } from "@/components/admin/charts";
import { SmartLink } from "@/components/ui/smart-link";
import { requireLocale } from "@/i18n/params";
import { parsePeriod, periodFor, PERIODS } from "@/lib/admin/metrics";
import { dashboards } from "@/lib/admin/server";
import { AI_FEATURES, MODELS, type AiFeature } from "@/lib/ai/models";
import { aiMode, usageStore } from "@/lib/ai/server";
import { can } from "@/lib/auth/roles";
import { requirePermission } from "@/lib/auth/session";
import { cn } from "@/lib/ui/cn";

/**
 * Reading the figures needs "reports:read" (merchandiser, admin); changing a
 * switch needs "ai:manage" (admin), and is recorded in the audit log
 * (docs/adr/020). Costs are kept in millionths of a euro because a single
 * Concierge answer costs a fraction of a cent (src/lib/ai/models.ts).
 */

export async function generateMetadata({ params }: PageProps<"/[locale]/admin/ai">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "admin.ai" });
  return { title: t("title"), robots: { index: false, follow: false } };
}

export default async function AiPage({ params, searchParams }: PageProps<"/[locale]/admin/ai">) {
  const locale = await requireLocale(params);
  const user = await requirePermission(locale, `/${locale}/admin/ai`, "reports:read");
  const days = parsePeriod((await searchParams).days);
  const period = periodFor(days);

  const usage = await usageStore();
  const [spend, settings, spentTodayMicros] = await Promise.all([(await dashboards()).aiSpend(period), usage.settings(), usage.spentToday()]);

  const t = await getTranslations("admin.ai");
  const d = await getTranslations("admin.dashboard");
  const format = await getFormatter();
  const mode = aiMode();
  const budgetEur = settings.dailyBudgetMicros / 1_000_000;

  /** Micros as money: four decimals while the amount is under a euro, so a single answer is still readable. */
  const euro = (micros: number) =>
    format.number(micros / 1_000_000, { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: micros > 0 && micros < 1_000_000 ? 4 : 2 });
  const dayLabel = (day: string) => format.dateTime(new Date(`${day}T12:00:00Z`), { day: "numeric", month: "short", timeZone: "UTC" });
  const featureName = (feature: string) => (AI_FEATURES.includes(feature as AiFeature) ? t(`features.${feature}`) : feature);

  return (
    <main className="mx-auto w-full max-w-[1440px] px-6 py-10 md:px-10 md:py-16" data-agent-id="admin:ai">
      <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="font-display text-3xl">{t("title")}</h1>
          <p className="text-slate mt-3 max-w-[70ch]">{t("lede")}</p>
          <p className="text-slate mt-2 text-sm" data-agent-id="admin:ai-mode">
            {t("mode")}: {mode === "google" ? t("modes.google", { model: MODELS.concierge.id }) : t(`modes.${mode}`)}
          </p>
        </div>
        <nav aria-label={d("periodLabel")}>
          <ul className="flex gap-1">
            {PERIODS.map((option) => (
              <li key={option}>
                <SmartLink
                  href={`/admin/ai?days=${option}`}
                  aria-current={option === days ? "page" : undefined}
                  className={cn("rounded-plinth flex h-11 items-center px-4 text-sm whitespace-nowrap no-underline transition-colors", option === days ? "bg-dusk text-glass" : "text-dusk hover:bg-dusk/[0.05]")}
                  data-agent-id={`ai:period:${option}`}
                >
                  {d(`periods.${option}`)}
                </SmartLink>
              </li>
            ))}
          </ul>
        </nav>
      </div>

      <section aria-labelledby="ai-today" className="mt-10">
        <h2 id="ai-today" className="sr-only">
          {t("today")}
        </h2>
        <dl className="border-hairline bg-hairline grid gap-px overflow-hidden border sm:grid-cols-2 xl:grid-cols-4 [&>div]:bg-glass">
          <Stat label={t("today")} value={euro(spentTodayMicros)} note={t("todayNote", { budget: format.number(budgetEur, { style: "currency", currency: "EUR" }) })} agentId="ai:today" />
          <Stat label={t("period")} value={euro(spend.totalMicros)} agentId="ai:period-total" />
          <Stat label={t("calls")} value={format.number(spend.calls)} note={t("demoCalls") + ": " + format.number(spend.demoCalls)} agentId="ai:calls" />
          <Stat label={t("unpriced")} value={format.number(spend.unpriced)} note={t("unpricedNote", { count: spend.unpriced })} agentId="ai:unpriced" />
        </dl>
      </section>

      <Panel id="ai-by-day" title={t("byDay.title")} className="mt-12">
        {/* An empty chart says less than a sentence: until something has been spent, say so. */}
        {spend.byDay.every((entry) => entry.value === 0) ? (
          <p className="text-slate text-sm">{t("empty")}</p>
        ) : (
          <DayBars
            data={spend.byDay}
            label={t("byDay.chartLabel", { max: euro(Math.max(0, ...spend.byDay.map((entry) => entry.value))) })}
            formatValue={euro}
            formatDay={dayLabel}
            tableCaption={t("byDay.title")}
            columns={[t("byDay.day"), t("byDay.value")]}
          />
        )}
      </Panel>

      <div className="mt-12 grid gap-x-14 gap-y-12 lg:grid-cols-2">
        <Panel id="ai-by-feature" title={t("byFeature.title")}>
          {spend.byFeature.length === 0 ? (
            <p className="text-slate text-sm">{t("empty")}</p>
          ) : (
            <ShareTable
              caption={t("byFeature.title")}
              columns={[t("byFeature.feature"), t("byFeature.calls"), t("byFeature.tokens"), t("byFeature.cost")]}
              agentId="ai:by-feature"
              rows={spend.byFeature.map((row) => ({
                key: row.feature,
                label: featureName(row.feature),
                value: row.costMicros,
                cells: [format.number(row.calls), format.number(row.inputTokens + row.outputTokens), euro(row.costMicros)],
              }))}
            />
          )}
        </Panel>

        <Panel id="ai-voice" title={t("voice.title")} lede={t("voice.lede")}>
          {spend.voice.length === 0 ? (
            <p className="text-slate text-sm">{t("voice.empty")}</p>
          ) : (
            <ShareTable
              caption={t("voice.title")}
              columns={[t("voice.provider"), t("voice.sessions"), t("voice.minutes"), t("voice.cost")]}
              agentId="ai:voice"
              rows={spend.voice.map((row) => ({
                key: row.provider,
                label: t.has(`voice.providers.${row.provider}`) ? t(`voice.providers.${row.provider}`) : row.provider,
                value: row.costMicros,
                cells: [format.number(row.sessions), format.number(row.seconds / 60, { maximumFractionDigits: 1 }), euro(row.costMicros)],
              }))}
            />
          )}
        </Panel>

        {can(user.roles, "ai:manage") ? (
          <Panel id="ai-settings" title={t("settings")} lede={t("settingsLede")}>
            <AiSettings killSwitch={settings.killSwitch} dailyBudgetEur={budgetEur} />
          </Panel>
        ) : null}
      </div>
    </main>
  );
}
