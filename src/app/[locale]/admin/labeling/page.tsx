/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Evaluation E1 in the shop: staff grade search results, and see each version of the search scored.
 */

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

import type { Metadata } from "next";
import Image from "next/image";
import { getFormatter, getTranslations } from "next-intl/server";

import { JudgeCard } from "@/components/admin/judge-card";
import { Panel, ShareTable } from "@/components/admin/charts";
import { SmartLink } from "@/components/ui/smart-link";
import { requireLocale } from "@/i18n/params";
import { requirePermission } from "@/lib/auth/session";
import { getCardsByIds, rankForSystem } from "@/lib/catalog/server";
import { sql } from "@/lib/db/client";
import { E1_QUERIES, E1_SYSTEM_NAMES, type E1System } from "@/lib/search/evaluation";
import { createJudgmentStore, judgmentKey } from "@/lib/search/judgments-store";
import { judgingPool, scoreSystem, type Grade } from "@/lib/search/metrics";
import { cn } from "@/lib/ui/cn";

/**
 * docs/adr/036. Judging: for each query, every version of the search
 * (E1_SYSTEMS) runs, their top ten are pooled, and the products nobody has
 * graded yet come up one at a time. Results: each version scored on every
 * query judged so far — NDCG@10, MRR and recall@10 (src/lib/search/metrics.ts)
 * — by kind of query, so the effect of each stage can be read off the table.
 * For "reports:read".
 *
 * docs/adr/049. Checking the AI judge: where the blind sample exists (it is
 * drawn by `pnpm evals:search --check-set` on the local shop, beside the AI
 * judge's grades, which are not part of the source), a third view walks a
 * person through those pairs without showing the judge's grades. The grades
 * are saved like any other; `pnpm evals:search --agreement` compares them.
 */

export async function generateMetadata({ params }: PageProps<"/[locale]/admin/labeling">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "admin.labeling" });
  return { title: t("title"), robots: { index: false, follow: false } };
}

type CheckPair = { query: string; locale: "en" | "el"; slug: string };

/** The blind sample for checking the AI judge, when it has been drawn here; null elsewhere (production never has it). */
async function checkSet(): Promise<CheckPair[] | null> {
  const file = path.join(process.cwd(), "docs", "report", "e1", "check-set.json");
  if (!existsSync(file)) return null;
  try {
    return (JSON.parse(await readFile(file, "utf8")) as { pairs: CheckPair[] }).pairs;
  } catch {
    return null;
  }
}

async function rankings(query: string): Promise<Record<E1System, string[]>> {
  const lists = await Promise.all(E1_SYSTEM_NAMES.map((system) => rankForSystem(query, system, 10)));
  return Object.fromEntries(E1_SYSTEM_NAMES.map((system, index) => [system, lists[index]!])) as Record<E1System, string[]>;
}

export default async function LabelingPage({ params, searchParams }: PageProps<"/[locale]/admin/labeling">) {
  const locale = await requireLocale(params);
  await requirePermission(locale, `/${locale}/admin/labeling`, "reports:read");
  const search = await searchParams;
  const check = await checkSet();
  const view = search.view === "results" ? "results" : search.view === "check" && check !== null ? "check" : "judge";
  const views = check === null ? (["judge", "results"] as const) : (["judge", "results", "check"] as const);
  const t = await getTranslations("admin.labeling");
  const format = await getFormatter();
  const judgments = await createJudgmentStore(sql).all();
  const judgedPairs = [...judgments.values()].reduce((sum, grades) => sum + grades.size, 0);
  const gradesFor = (entry: { query: string; locale: string }) => judgments.get(`${judgmentKey(entry.query)}|${entry.locale}`) ?? new Map<string, Grade>();

  const header = (
    <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
      <div>
        <h1 className="font-display text-3xl">{t("title")}</h1>
        <p className="text-slate mt-3 max-w-[70ch]">{t("lede", { queries: E1_QUERIES.length, judged: judgedPairs })}</p>
      </div>
      <nav aria-label={t("viewsLabel")}>
        <ul className="flex gap-1">
          {views.map((option) => (
            <li key={option}>
              <SmartLink
                href={option === "judge" ? "/admin/labeling" : `/admin/labeling?view=${option}`}
                aria-current={option === view ? "page" : undefined}
                className={cn("rounded-plinth flex h-11 items-center px-4 text-sm no-underline transition-colors", option === view ? "bg-dusk text-glass" : "text-dusk hover:bg-dusk/[0.05]")}
                data-agent-id={`labeling:view:${option}`}
              >
                {t(`views.${option}`)}
              </SmartLink>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );

  if (view === "results") {
    const runs = await Promise.all(E1_QUERIES.map(async (entry) => ({ entry, lists: await rankings(entry.query), grades: gradesFor(entry) })));
    const scores = E1_SYSTEM_NAMES.map((system) => scoreSystem(system, runs.map((run) => ({ ranking: run.lists[system], judgements: run.grades }))));
    const kinds = [...new Set(E1_QUERIES.map((entry) => entry.kind))];
    const byKind = kinds.map((kind) => ({
      kind,
      scores: E1_SYSTEM_NAMES.map((system) => scoreSystem(system, runs.filter((run) => run.entry.kind === kind).map((run) => ({ ranking: run.lists[system], judgements: run.grades })))),
    }));
    const number = (value: number) => format.number(value, { maximumFractionDigits: 3, minimumFractionDigits: 3 });

    return (
      <main className="mx-auto w-full max-w-[1440px] px-6 py-10 md:px-10 md:py-16" data-agent-id="admin:labeling">
        {header}
        <Panel id="labeling-scores" title={t("results.title")} lede={t("results.lede")} className="mt-10">
          {scores.every((score) => score.queries === 0) ? (
            <p className="text-slate text-sm">{t("results.empty")}</p>
          ) : (
            <ShareTable
              caption={t("results.title")}
              columns={[t("results.system"), t("results.queries"), "NDCG@10", "MRR", t("results.recall")]}
              agentId="labeling:scores"
              rows={scores.map((score) => ({
                key: score.system,
                label: t(`systems.${score.system}`),
                value: score.ndcg10,
                cells: [format.number(score.queries), number(score.ndcg10), number(score.mrr), number(score.recall10)],
              }))}
            />
          )}
          <p className="text-slate mt-4 text-sm">{t("results.semantic")}</p>
        </Panel>
        <Panel id="labeling-kinds" title={t("results.byKind")} className="mt-12">
          <div className="-mx-1 overflow-x-auto px-1" tabIndex={0} role="region" aria-label={t("results.byKind")}>
            <table className="w-full text-sm" data-agent-id="labeling:by-kind">
              <caption className="sr-only">{t("results.byKind")}</caption>
              <thead>
                <tr className="text-slate text-left">
                  <th scope="col" className="py-2 pr-4 font-medium">{t("results.kind")}</th>
                  {E1_SYSTEM_NAMES.map((system) => (
                    <th key={system} scope="col" className="py-2 pr-4 text-right font-medium">
                      {t(`systems.${system}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {byKind.map((row) => (
                  <tr key={row.kind} className="border-hairline border-t">
                    <th scope="row" className="py-2 pr-4 text-left font-normal">{t(`kinds.${row.kind}`)}</th>
                    {row.scores.map((score) => (
                      <td key={score.system} className="py-2 pr-4 text-right tabular-nums">
                        {score.queries === 0 ? "—" : number(score.ndcg10)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </main>
    );
  }

  if (view === "check" && check !== null) {
    const rows = await sql<{ id: string; slug: string }[]>`SELECT id, slug FROM products WHERE slug = ANY(${check.map((pair) => pair.slug)}::text[])`;
    const idOf = new Map(rows.map((row) => [row.slug, row.id]));
    const gradeable = check.filter((pair) => idOf.has(pair.slug));
    const remaining = gradeable.filter((pair) => !gradesFor(pair).has(idOf.get(pair.slug)!));
    const next = remaining[0];
    const [card] = next === undefined ? [] : await getCardsByIds([idOf.get(next.slug)!], locale);
    const total = gradeable.length;
    return (
      <main className="mx-auto w-full max-w-[1100px] px-6 py-10 md:px-10 md:py-16" data-agent-id="admin:labeling">
        {header}
        <section className="mt-10 flex flex-col gap-6" aria-labelledby="labeling-check">
          <div>
            <h2 id="labeling-check" className="font-display text-2xl">
              {t("check.title")}
            </h2>
            <p className="text-slate mt-2 max-w-[70ch]">{t("check.lede", { total })}</p>
            <p className="text-slate mt-2 text-sm tabular-nums" data-agent-id="labeling:check-progress">
              {t("check.progress", { done: total - remaining.length, total })}
            </p>
          </div>
          {next === undefined || card === undefined ? (
            <p className="text-slate" data-agent-id="labeling:check-done">
              {t("check.done", { total })}
            </p>
          ) : (
            <div className="flex flex-col gap-4">
              <p className="font-display text-xl" lang={next.locale} data-agent-id="labeling:query">
                “{next.query}”
              </p>
              <ProductToJudge card={card} query={next.query} locale={next.locale} hints={([3, 2, 1, 0] as const).map((grade) => ({ grade, hint: t(`grades.${grade}.hint`) }))} />
            </div>
          )}
        </section>
      </main>
    );
  }

  // Judging: the query asked for, or the first with something left to grade.
  const requested = typeof search.q === "string" ? Number.parseInt(search.q, 10) : Number.NaN;
  const order = Number.isInteger(requested) && requested >= 0 && requested < E1_QUERIES.length ? [requested, ...E1_QUERIES.keys()] : [...E1_QUERIES.keys()];
  let current: { index: number; pool: string[]; judged: number } | null = null;
  for (const index of order) {
    const entry = E1_QUERIES[index]!;
    const grades = gradesFor(entry);
    const pool = judgingPool(Object.values(await rankings(entry.query)), new Set(grades.keys()), 10);
    if (pool.length > 0 || index === requested) {
      current = { index, pool, judged: grades.size };
      break;
    }
  }
  const entry = current === null ? null : E1_QUERIES[current.index]!;
  const [card] = current === null || current.pool.length === 0 ? [] : await getCardsByIds([current.pool[0]!], locale);

  return (
    <main className="mx-auto w-full max-w-[1100px] px-6 py-10 md:px-10 md:py-16" data-agent-id="admin:labeling">
      {header}
      {entry === null || current === null ? (
        <p className="text-slate mt-10" data-agent-id="labeling:done">
          {t("done")}
        </p>
      ) : (
        <section className="mt-10 flex flex-col gap-6" aria-labelledby="labeling-query">
          <div>
            <p className="text-slate text-sm">{t("queryOf", { index: current.index + 1, count: E1_QUERIES.length, kind: t(`kinds.${entry.kind}`) })}</p>
            <h2 id="labeling-query" className="font-display mt-1 text-2xl" lang={entry.locale} data-agent-id="labeling:query">
              “{entry.query}”
            </h2>
            <p className="text-slate mt-1 text-sm">{t("progress", { judged: current.judged, left: current.pool.length })}</p>
          </div>
          {card === undefined ? (
            <p className="text-slate">{t("queryDone")}</p>
          ) : (
            <ProductToJudge card={card} query={entry.query} locale={entry.locale} hints={([3, 2, 1, 0] as const).map((grade) => ({ grade, hint: t(`grades.${grade}.hint`) }))} />
          )}
          <nav aria-label={t("queriesLabel")}>
            <ul className="flex flex-wrap gap-2 text-sm">
              {E1_QUERIES.map((other, index) => (
                <li key={`${other.locale}:${other.query}`}>
                  <SmartLink
                    href={`/admin/labeling?q=${index}`}
                    aria-current={index === current!.index ? "page" : undefined}
                    className={cn("rounded-plinth border-hairline inline-flex min-h-9 items-center border px-3 no-underline", index === current!.index ? "bg-dusk text-glass" : "bg-white")}
                    lang={other.locale}
                  >
                    {other.query}
                    <span className={cn("ml-2 text-xs tabular-nums", index === current!.index ? "" : "text-slate")}>{gradesFor(other).size}</span>
                  </SmartLink>
                </li>
              ))}
            </ul>
          </nav>
        </section>
      )}
    </main>
  );
}

/** One product to grade for a query: its photograph, maker and title, the rubric, and the grade buttons. */
function ProductToJudge({
  card,
  query,
  locale,
  hints,
}: {
  card: Awaited<ReturnType<typeof getCardsByIds>>[number];
  query: string;
  locale: "en" | "el";
  hints: { grade: Grade; hint: string }[];
}) {
  return (
    <div className="border-hairline rounded-plinth grid gap-6 border bg-white p-5 md:grid-cols-[12rem_minmax(0,1fr)]" data-agent-id={`labeling:product:${card.id}`}>
      <div className="bg-plinth rounded-plinth relative aspect-square overflow-hidden">
        {card.image === null ? null : <Image src={card.image.src} alt={card.image.alt} fill sizes="192px" className="object-contain mix-blend-multiply" />}
      </div>
      <div className="flex min-w-0 flex-col gap-4">
        <div>
          <p className="text-slate text-sm">{[card.brand, card.kindLabel].filter(Boolean).join(" · ")}</p>
          <p className="text-lg">{card.title}</p>
        </div>
        <dl className="text-slate grid gap-1 text-xs">
          {hints.map(({ grade, hint }) => (
            <div key={grade} className="flex gap-2">
              <dt className="tabular-nums font-medium">{grade}</dt>
              <dd>{hint}</dd>
            </div>
          ))}
        </dl>
        <JudgeCard query={query} locale={locale} productId={card.id} />
      </div>
    </div>
  );
}
