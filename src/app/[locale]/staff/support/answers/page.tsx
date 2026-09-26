/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * The desk's ready answers: every one, by topic, to read, edit, restore or add to.
 */

import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";

import { AnswerEditor } from "@/components/staff/answer-editor";
import { SmartLink } from "@/components/ui/smart-link";
import { requireLocale } from "@/i18n/params";
import { requirePermission } from "@/lib/auth/session";
import { DEFAULT_MACROS } from "@/lib/support/macros";
import { supportStore } from "@/lib/support/server";
import { TICKET_TOPICS } from "@/lib/support/tickets";

/**
 * docs/adr/029. The answers a draft starts from, grouped by the queue they
 * serve. Each says whether it is still the shop's own words or the desk's
 * edit — an edit the next deploy leaves alone — and the shop's own can always
 * be put back.
 */

export async function generateMetadata({ params }: PageProps<"/[locale]/staff/support/answers">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "staff.answers" });
  return { title: t("title"), robots: { index: false, follow: false } };
}

export default async function AnswersPage({ params }: PageProps<"/[locale]/staff/support/answers">) {
  const locale = await requireLocale(params);
  await requirePermission(locale, `/${locale}/staff/support/answers`, "support:work");

  const desk = await supportStore();
  const answers = await desk.macros();
  const shipped = new Set(DEFAULT_MACROS.map((macro) => macro.key));
  const t = await getTranslations("staff.answers");
  const topics = await getTranslations("staff.support.topics");
  const format = await getFormatter();

  return (
    <main className="mx-auto w-full max-w-[1100px] px-6 py-10 md:px-10 md:py-16" data-agent-id="desk:answers">
      <SmartLink href="/staff/support" className="text-slate text-sm underline underline-offset-4">
        {t("back")}
      </SmartLink>
      <h1 className="font-display mt-4 text-3xl">{t("title")}</h1>
      <p className="text-slate mt-3 max-w-[70ch]">{t("lede")}</p>

      <section className="mt-8" aria-label={t("new")}>
        <AnswerEditor id={null} initial={{ topic: "other", titleEn: "", titleEl: "", bodyEn: "", bodyEl: "", sort: 100 }} shipped={false} edited={false} />
      </section>

      {TICKET_TOPICS.map((topic) => {
        const inTopic = answers.filter((answer) => answer.topic === topic);
        if (inTopic.length === 0) return null;
        return (
          <section key={topic} aria-labelledby={`topic-${topic}`} className="mt-10">
            <h2 id={`topic-${topic}`} className="font-display text-xl">
              {topics(topic)}
            </h2>
            <ul className="border-hairline mt-4 border-t">
              {inTopic.map((answer) => {
                const title = locale === "el" ? answer.titleEl : answer.titleEn;
                const body = locale === "el" ? answer.bodyEl : answer.bodyEn;
                const edited = answer.staffEditedAt !== null && answer.staffEditedAt !== undefined;
                return (
                  <li key={answer.id} className="border-hairline border-b py-5" data-agent-id={`answer:${answer.key}`}>
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                      <h3 className="font-medium">{title}</h3>
                      <span className="text-slate text-xs" data-agent-id={`answer:${answer.key}:source`}>
                        {!shipped.has(answer.key)
                          ? t("sourceDesk")
                          : edited
                            ? t("sourceEdited", { when: format.dateTime(answer.staffEditedAt!, { dateStyle: "medium" }) })
                            : t("sourceShop")}
                      </span>
                    </div>
                    <p className="text-slate mt-2 line-clamp-3 max-w-[80ch] text-sm whitespace-pre-line">{body}</p>
                    <div className="mt-3">
                      <AnswerEditor
                        id={answer.id}
                        initial={{ topic: answer.topic, titleEn: answer.titleEn, titleEl: answer.titleEl, bodyEn: answer.bodyEn, bodyEl: answer.bodyEl, sort: answer.sort }}
                        shipped={shipped.has(answer.key)}
                        edited={edited}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </main>
  );
}
