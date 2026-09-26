/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * The audit log: who changed products, stock, reviews and roles, what exactly changed, and why.
 */

import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";

import { SmartLink } from "@/components/ui/smart-link";
import { requireLocale } from "@/i18n/params";
import { AUDIT_ENTITIES, type AuditEntity } from "@/lib/admin/audit";
import { auditEntries } from "@/lib/admin/server";
import { requirePermission } from "@/lib/auth/session";
import { formatMoney, money } from "@/lib/commerce/money";
import { cn } from "@/lib/ui/cn";

/** For "audit:read" (admin only). Paged by offset; the log only grows at the newest end. */

const PAGE_SIZE = 50;
const MONEY_FIELDS = new Set(["priceCents", "compareAtCents"]);
const KNOWN_FIELDS = new Set([
  "titleEn",
  "titleEl",
  "descriptionEn",
  "descriptionEl",
  "highlightsEn",
  "highlightsEl",
  "priceCents",
  "compareAtCents",
  "status",
  "translation",
  "stock",
  "role",
  "moderationReason",
  "killSwitch",
  "dailyBudgetEur",
  "bodyEn",
  "bodyEl",
  "topic",
  "sort",
]);

export async function generateMetadata({ params }: PageProps<"/[locale]/admin/audit">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "admin.audit" });
  return { title: t("title"), robots: { index: false, follow: false } };
}

export default async function AuditPage({ params, searchParams }: PageProps<"/[locale]/admin/audit">) {
  const locale = await requireLocale(params);
  await requirePermission(locale, `/${locale}/admin/audit`, "audit:read");
  const query = await searchParams;
  const entity: AuditEntity | null = AUDIT_ENTITIES.find((option) => option === query.entity) ?? null;
  const page = Math.max(1, Number.parseInt(typeof query.page === "string" ? query.page : "1", 10) || 1);
  const { entries, more } = await auditEntries({ entity, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE });

  const t = await getTranslations("admin.audit");
  const format = await getFormatter();
  const link = (next: { entity?: AuditEntity | null; page?: number }) => {
    const params = new URLSearchParams();
    const target = next.entity === undefined ? entity : next.entity;
    if (target !== null) params.set("entity", target);
    if ((next.page ?? 1) > 1) params.set("page", String(next.page));
    const encoded = params.toString();
    return `/admin/audit${encoded === "" ? "" : `?${encoded}`}`;
  };
  /** A value as a person reads it: money as money, lists joined, long text shortened, nothing as "empty". */
  const shown = (field: string, value: unknown): string => {
    if (value === null || value === undefined || value === "") return t("empty_value");
    if (MONEY_FIELDS.has(field) && typeof value === "number") return formatMoney(money(value), locale);
    const text = Array.isArray(value) ? value.join("; ") : typeof value === "object" ? JSON.stringify(value) : String(value);
    return text.length > 140 ? `${text.slice(0, 139)}…` : text;
  };

  return (
    <main className="mx-auto w-full max-w-[1440px] px-6 py-10 md:px-10 md:py-16" data-agent-id="admin:audit">
      <h1 className="font-display text-3xl">{t("title")}</h1>
      <p className="text-slate mt-3 max-w-[70ch]">{t("lede")}</p>

      <nav aria-label={t("filterLabel")} className="-mx-1 mt-8 overflow-x-auto">
        <ul className="flex gap-1 px-1">
          {([null, ...AUDIT_ENTITIES] as const).map((option) => (
            <li key={option ?? "all"}>
              <SmartLink
                href={link({ entity: option, page: 1 })}
                aria-current={option === entity ? "page" : undefined}
                className={cn("rounded-plinth flex h-11 items-center px-4 text-sm whitespace-nowrap no-underline transition-colors", option === entity ? "bg-dusk text-glass" : "text-dusk hover:bg-dusk/[0.05]")}
                data-agent-id={`audit:filter:${option ?? "all"}`}
              >
                {t(`entities.${option ?? "all"}`)}
              </SmartLink>
            </li>
          ))}
        </ul>
      </nav>

      {entries.length === 0 ? (
        <p className="text-slate mt-10">{t("empty")}</p>
      ) : (
        // A list rather than a table: each entry stacks on a phone and lines up in columns from medium screens.
        <ol className="border-hairline mt-8 border-t text-sm" data-agent-id="audit:entries">
          <li className="text-slate hidden gap-4 py-3 font-medium md:grid md:grid-cols-[10rem_12rem_minmax(0,1fr)_minmax(0,1.5fr)]" aria-hidden="true">
            <span>{t("columns.when")}</span>
            <span>{t("columns.who")}</span>
            <span>{t("columns.what")}</span>
            <span>{t("columns.changes")}</span>
          </li>
          {entries.map((entry) => {
            const productTitle = entry.product === null ? null : locale === "el" ? (entry.product.titleEl ?? entry.product.titleEn) : entry.product.titleEn;
            return (
              <li key={entry.id} className="border-hairline grid gap-1 border-t py-4 md:grid-cols-[10rem_12rem_minmax(0,1fr)_minmax(0,1.5fr)] md:gap-4" data-agent-id={`audit:entry:${entry.id}`}>
                <span className="tabular text-slate md:text-dusk">{format.dateTime(entry.createdAt, { dateStyle: "medium", timeStyle: "short" })}</span>
                <span className="text-slate md:text-dusk break-words">{entry.actorEmail ?? t("system")}</span>
                <span className="min-w-0">
                  <span className="block font-medium">{t(`actions.${entry.action.replace(".", "_")}`)}</span>
                  <span className="text-slate block break-words">
                    {entry.product !== null ? (
                      <SmartLink href={`/staff/products/${entry.product.id}`} className="underline underline-offset-4">
                        {productTitle}
                      </SmartLink>
                    ) : (
                      (entry.userEmail ?? entry.macroTitle ?? entry.entityId)
                    )}
                    {entry.sku === null ? null : <span className="tabular"> · {entry.sku}</span>}
                  </span>
                </span>
                <span className="mt-2 min-w-0 md:mt-0">
                  <ul className="flex flex-col gap-1">
                    {Object.entries(entry.changes).map(([field, change]) => (
                      <li key={field} className="break-words">
                        <span className="font-medium">{KNOWN_FIELDS.has(field) ? t(`fields.${field}`) : field}</span>
                        {": "}
                        <span className="text-slate line-through decoration-1">{shown(field, change.before)}</span>
                        {" → "}
                        <span>{shown(field, change.after)}</span>
                      </li>
                    ))}
                  </ul>
                  {entry.reason === null ? null : <span className="text-slate mt-1 block italic">{t("reason", { reason: entry.reason })}</span>}
                </span>
              </li>
            );
          })}
        </ol>
      )}

      <nav aria-label={t("title")} className="mt-6 flex gap-4 text-sm">
        {page > 1 ? (
          <SmartLink href={link({ page: page - 1 })} className="underline underline-offset-4">
            {t("previous")}
          </SmartLink>
        ) : null}
        {more ? (
          <SmartLink href={link({ page: page + 1 })} className="underline underline-offset-4">
            {t("next")}
          </SmartLink>
        ) : null}
      </nav>
    </main>
  );
}
