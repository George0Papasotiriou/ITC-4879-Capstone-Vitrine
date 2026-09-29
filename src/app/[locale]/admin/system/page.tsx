/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * The store beside the database: what Redis holds, the search cache's hit rate, refusals by limit, trending searches.
 */

import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";

import { Panel, ShareTable, Stat } from "@/components/admin/charts";
import { requireLocale } from "@/i18n/params";
import { requirePermission } from "@/lib/auth/session";
import type { LimitName } from "@/lib/kv/rate-limit";
import { systemFigures } from "@/lib/kv/system";
import { STATS_KEY_CAP } from "@/lib/kv/types";

/**
 * docs/adr/039. For "reports:read". Everything is read live from the store;
 * nothing here names a person (limits and trending keep only keyed hashes).
 */

export async function generateMetadata({ params }: PageProps<"/[locale]/admin/system">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "admin.system" });
  return { title: t("title"), robots: { index: false, follow: false } };
}

const LIMITS: LimitName[] = ["concierge", "concierge-tools", "support-new", "support-reply", "hand-over", "reco-events", "study", "mcp"];

export default async function SystemPage({ params }: PageProps<"/[locale]/admin/system">) {
  const locale = await requireLocale(params);
  await requirePermission(locale, `/${locale}/admin/system`, "reports:read");
  const t = await getTranslations("admin.system");
  const format = await getFormatter();

  const { stats, cache, refusedToday, refusedYesterday, trending } = await systemFigures();
  const lookups = cache.hits + cache.misses;
  const namespaceName = (namespace: string) => (t.has(`namespaces.${namespace}`) ? t(`namespaces.${namespace}` as "namespaces.limit") : namespace);
  const totalKeys = Object.values(stats.keysByNamespace).reduce((sum, count) => sum + count, 0);

  return (
    <main className="mx-auto w-full max-w-[1440px] px-6 py-10 md:px-10 md:py-16" data-agent-id="admin:system">
      <h1 className="font-display text-3xl">{t("title")}</h1>
      <p className="text-slate mt-3 max-w-[70ch]">{t("lede")}</p>

      <Panel id="system-store" title={t("storeTitle")} className="mt-10">
        <dl className="border-hairline bg-hairline grid gap-px overflow-hidden border sm:grid-cols-3 [&>div]:bg-glass">
          <Stat label={t("storeKind")} value={stats.kind === "redis" ? "Redis" : t("kindMemory")} note={stats.kind === "redis" ? t("kindRedis") : undefined} agentId="system:kind" />
          <Stat label={t("memory")} value={stats.usedMemory ?? "—"} agentId="system:memory" />
          <Stat label={t("keys")} value={format.number(totalKeys)} note={stats.truncated ? t("keysTruncated", { cap: format.number(STATS_KEY_CAP) }) : undefined} agentId="system:keys" />
        </dl>
        {totalKeys === 0 ? null : (
          <ShareTable
            caption={t("keysLede")}
            columns={[t("namespace"), t("count")]}
            agentId="system:namespaces"
            rows={Object.entries(stats.keysByNamespace)
              .sort((a, b) => b[1] - a[1])
              .map(([namespace, count]) => ({ key: namespace, label: namespaceName(namespace), value: count, cells: [format.number(count)] }))}
          />
        )}
      </Panel>

      <Panel id="system-cache" title={t("cacheTitle")} lede={t("cacheLede")} className="mt-12">
        <dl className="border-hairline bg-hairline grid gap-px overflow-hidden border sm:grid-cols-3 [&>div]:bg-glass">
          <Stat label={t("hits")} value={format.number(cache.hits)} agentId="system:cache-hits" />
          <Stat label={t("misses")} value={format.number(cache.misses)} agentId="system:cache-misses" />
          <Stat label={t("hitRate")} value={lookups === 0 ? "—" : format.number(cache.hits / lookups, { style: "percent", maximumFractionDigits: 1 })} agentId="system:cache-rate" />
        </dl>
      </Panel>

      <Panel id="system-limits" title={t("limitsTitle")} lede={t("limitsLede")} className="mt-12">
        <ShareTable
          caption={t("limitsTitle")}
          columns={[t("limitColumn"), t("today"), t("yesterday")]}
          agentId="system:limits"
          rows={LIMITS.map((name) => ({
            key: name,
            label: t(`limits.${name}` as "limits.concierge"),
            value: refusedToday[name],
            cells: [format.number(refusedToday[name]), format.number(refusedYesterday[name])],
          }))}
        />
      </Panel>

      <Panel id="system-trending" title={t("trendingTitle")} lede={t("trendingLede")} className="mt-12">
        {trending.length === 0 ? (
          <p className="text-slate text-sm">{t("trendingEmpty")}</p>
        ) : (
          <ShareTable
            caption={t("trendingTitle")}
            columns={[t("term"), t("people"), t("score")]}
            agentId="system:trending"
            rows={trending.map((entry) => ({
              key: entry.term,
              label: entry.term,
              value: entry.score,
              cells: [format.number(entry.people), format.number(entry.score, { maximumFractionDigits: 2 })],
            }))}
          />
        )}
      </Panel>
    </main>
  );
}
