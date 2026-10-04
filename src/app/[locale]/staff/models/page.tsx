/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Staff: the 3D models an AI made from photographs, worst fit first, each to look at and hide or show.
 */

import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";

import { AiModelToggle } from "@/components/staff/ai-model-toggle";
import { SmartLink } from "@/components/ui/smart-link";
import { requireLocale } from "@/i18n/params";
import { requirePermission } from "@/lib/auth/session";
import { AI_MODEL_VIEWS, createAiModelStore } from "@/lib/catalog/model/ai-store";
import { sql } from "@/lib/db/client";
import { cn } from "@/lib/ui/cn";

export async function generateMetadata({ params }: PageProps<"/[locale]/staff/models">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "staff.models" });
  return { title: t("title"), robots: { index: false, follow: false } };
}

export default async function AiModelsPage({ params, searchParams }: PageProps<"/[locale]/staff/models">) {
  const locale = await requireLocale(params);
  await requirePermission(locale, `/${locale}/staff/models`, "catalog:edit");
  const requested = (await searchParams).view;
  const view = AI_MODEL_VIEWS.find((option) => option === requested) ?? "ready";
  const t = await getTranslations("staff.models");
  const format = await getFormatter();
  const models = await createAiModelStore(sql).list(view);

  return (
    <main className="mx-auto w-full max-w-[1100px] px-6 py-10 md:px-10 md:py-16" data-agent-id="staff:models">
      <h1 className="font-display text-3xl">{t("title")}</h1>
      <p className="text-slate mt-3 max-w-[70ch]">{t("lede")}</p>
      <nav aria-label={t("viewsLabel")} className="mt-8">
        <ul className="flex flex-wrap gap-1">
          {AI_MODEL_VIEWS.map((option) => (
            <li key={option}>
              <SmartLink
                href={`/staff/models?view=${option}`}
                aria-current={option === view ? "page" : undefined}
                className={cn("rounded-plinth flex h-11 items-center px-4 text-sm no-underline transition-colors", option === view ? "bg-dusk text-glass" : "text-dusk hover:bg-dusk/[0.05]")}
              >
                {t(`views.${option}`)}
              </SmartLink>
            </li>
          ))}
        </ul>
      </nav>
      {models.length === 0 ? (
        <p className="text-slate mt-10">{t("empty")}</p>
      ) : (
        <ol className="divide-hairline border-hairline mt-8 divide-y border-y">
          {models.map((model) => (
            <li key={model.id} className="grid gap-3 py-5 md:grid-cols-[minmax(0,1fr)_auto]" data-agent-id={`staff:model:${model.id}`}>
              <div className="flex min-w-0 flex-col gap-1">
                <SmartLink href={`/p/${model.slug}`} className="font-medium underline underline-offset-4">
                  {model.title}
                </SmartLink>
                <p className="text-slate text-sm tabular-nums">
                  {t(`status.${model.status}`)} · {model.fit === null ? t("noFit") : t("fit", { fit: format.number(model.fit, { maximumFractionDigits: 2, minimumFractionDigits: 2 }) })}
                  {model.bytes === null || model.triangles === null ? null : ` · ${t("size", { size: `${format.number(model.bytes / 1_048_576, { maximumFractionDigits: 1 })} MB`, triangles: format.number(model.triangles) })}`}
                  {model.costMicros === null ? null : ` · ${t("cost", { cost: format.number(model.costMicros / 1_000_000, { style: "currency", currency: "USD" }) })}`}
                </p>
                <p className="text-slate text-xs">
                  {model.model} · {format.dateTime(model.updatedAt, { dateStyle: "medium", timeStyle: "short" })}
                  {model.failureReason === null ? null : ` · ${model.failureReason}`}
                </p>
                {model.hasScan ? <p className="text-slate text-xs">{t("scanned")}</p> : null}
              </div>
              <div className="flex items-start gap-2">
                {model.storageKey === null ? null : (
                  <SmartLink href={`/media/${model.storageKey}`} className="text-dusk flex h-9 items-center text-sm underline underline-offset-4" data-agent-id={`staff:model-file:${model.id}`}>
                    {t("look")}
                  </SmartLink>
                )}
                {model.storageKey === null || model.status === "failed" ? null : <AiModelToggle id={model.id} shown={model.status === "ready"} />}
              </div>
            </li>
          ))}
        </ol>
      )}
    </main>
  );
}
