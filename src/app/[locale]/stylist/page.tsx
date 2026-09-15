/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Budget Stylist page: builds furniture bundles within a budget and offers swaps.
 */

import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { ProductImage } from "@/components/commerce/product-image";
import { Price } from "@/components/ui/price";
import { SmartLink } from "@/components/ui/smart-link";
import { EmptyState } from "@/components/ui/states";
import { requireLocale } from "@/i18n/params";
import { routing } from "@/i18n/routing";
import type { ProductCard } from "@/lib/catalog/queries";
import { getCardsByIds } from "@/lib/catalog/server";
import { formatMoney, money } from "@/lib/commerce/money";
import { TEMPLATE_IDS, type TemplateId } from "@/lib/optimize/templates";
import { bundleSwaps, buildBundles } from "@/lib/stylist/server";
import { stylistRequestSchema, type StylistResult } from "@/lib/stylist/stylist";
import { colorLabel, COLORS } from "@/lib/search/vocabulary";

/**
 * The Budget Stylist (graded algorithm A3, Phase 8 step 6).
 *
 * A GET form: the request is the URL, so a set can be shared and the Concierge
 * can open one. The page renders three sets from the optimiser, each with its
 * total, what is left of the budget, and the pairing that holds it together.
 * "Other options" for a piece is also a URL, so it works without JavaScript.
 */

export async function generateMetadata({ params }: PageProps<"/[locale]/stylist">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "stylist" });
  return {
    title: t("title"),
    description: t("intro"),
    alternates: {
      canonical: `/${locale}/stylist`,
      languages: Object.fromEntries(routing.locales.map((candidate) => [candidate, `/${candidate}/stylist`])),
    },
  };
}

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
const all = (value: string | string[] | undefined) => (value === undefined ? [] : Array.isArray(value) ? value : [value]);

export default async function StylistPage({ params, searchParams }: PageProps<"/[locale]/stylist">) {
  const locale = await requireLocale(params);
  const t = await getTranslations("stylist");
  const search = await searchParams;

  const template = (first(search.template) ?? "reading-corner") as TemplateId;
  const budgetEuros = Number.parseInt(first(search.budget) ?? "", 10);
  const width = Number.parseInt(first(search.width) ?? "", 10);
  const look = (first(search.look) ?? "").trim();
  const submitted = first(search.budget) !== undefined;

  const parsed = stylistRequestSchema.safeParse({
    template,
    budgetCents: Number.isFinite(budgetEuros) ? budgetEuros * 100 : undefined,
    avoidColors: all(search.avoid).filter((id) => id in COLORS),
    maxWidthCm: Number.isFinite(width) ? width : undefined,
    query: look === "" ? undefined : look,
  });

  const result: StylistResult | null = submitted && parsed.success ? await buildBundles(parsed.data) : null;

  // "Other options": ?swap=<set index>:<slot id>
  const swapParam = first(search.swap);
  const swapMatch = swapParam === undefined ? null : /^(\d):([a-z-]{1,40})$/.exec(swapParam);
  const swap =
    result !== null && swapMatch !== null
      ? { bundle: Number(swapMatch[1]), slot: swapMatch[2]!, options: await bundleSwaps(parsed.data, Number(swapMatch[1]), swapMatch[2]!) }
      : null;

  const productIds = [
    ...new Set([
      ...(result?.bundles.flatMap((bundle) => bundle.picks.map((pick) => pick.productId)) ?? []),
      ...(swap?.options.map((option) => option.productId) ?? []),
    ]),
  ];
  const cards = new Map((await getCardsByIds(productIds, locale)).map((card) => [card.id, card] as const));

  const euros = (cents: number) => formatMoney(money(cents), locale, { hideDecimalsWhenWhole: true });
  const slotName = (slot: string) => t(`slots.${slot}` as "slots.chair");
  const baseQuery = new URLSearchParams();
  for (const [key, value] of Object.entries(search)) {
    if (key === "swap") continue;
    for (const entry of all(value)) baseQuery.append(key, entry);
  }
  const hrefWith = (extra: Record<string, string>) => {
    const query = new URLSearchParams(baseQuery);
    for (const [key, value] of Object.entries(extra)) query.set(key, value);
    return `/stylist?${query.toString()}`;
  };

  /** Only what is true of the strongest pair: style when the style vectors agree, and what their colours do. */
  const whyLines = (bundle: StylistResult["bundles"][number]) => {
    const highlight = bundle.highlight;
    if (highlight === null) return [];
    const slotOf = (productId: string) => bundle.picks.find((pick) => pick.productId === productId)?.slotId ?? "";
    const values = { first: slotName(slotOf(highlight.first)), second: slotName(slotOf(highlight.second)) };
    const lines: string[] = [];
    if (highlight.style >= 0.45) lines.push(t("whyStyle", values));
    if (highlight.harmony >= 0.75) lines.push(t("whyHarmony", values));
    else if (highlight.harmony >= 0) lines.push(t("whyNeutral", values));
    else lines.push(t("whyContrast", values));
    return lines;
  };

  const fieldClass = "border-hairline text-dusk hover:border-dusk/35 rounded-plinth h-11 w-full border bg-white px-3 transition-colors";

  return (
    <main className="mx-auto w-full max-w-[1440px] px-6 py-10 md:px-10 md:py-16">
      <h1 className="font-display text-3xl">{t("title")}</h1>
      <p className="text-slate mt-3 max-w-[62ch]">{t("intro")}</p>

      <form action={`/${locale}/stylist`} method="get" className="border-hairline mt-8 grid gap-6 border-y py-8 md:grid-cols-2 lg:grid-cols-4" data-agent-id="form:stylist">
        <div className="flex flex-col gap-2">
          <label htmlFor="stylist-template" className="text-sm font-medium">{t("template")}</label>
          <select id="stylist-template" name="template" defaultValue={parsed.success ? parsed.data.template : "reading-corner"} className={`${fieldClass} cursor-pointer`}>
            {TEMPLATE_IDS.map((id) => (
              <option key={id} value={id}>{t(`templates.${id}` as "templates.dining")}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-2">
          <label htmlFor="stylist-budget" className="text-sm font-medium">{t("budget")}</label>
          <input id="stylist-budget" name="budget" type="number" inputMode="numeric" min={10} max={50000} step={10} required defaultValue={Number.isFinite(budgetEuros) ? budgetEuros : 1500} className={`${fieldClass} tabular`} />
        </div>
        <div className="flex flex-col gap-2">
          <label htmlFor="stylist-look" className="text-sm font-medium">{t("look")}</label>
          <input id="stylist-look" name="look" type="text" maxLength={120} defaultValue={look} placeholder={t("lookPlaceholder")} aria-describedby="stylist-look-hint" className={fieldClass} />
          <p id="stylist-look-hint" className="text-slate text-xs">{t("lookHint")}</p>
        </div>
        <div className="flex flex-col gap-2">
          <label htmlFor="stylist-width" className="text-sm font-medium">{t("maxWidth")}</label>
          <input id="stylist-width" name="width" type="number" inputMode="numeric" min={10} max={1000} defaultValue={Number.isFinite(width) ? width : undefined} aria-describedby="stylist-width-hint" className={`${fieldClass} tabular`} />
          <p id="stylist-width-hint" className="text-slate text-xs">{t("maxWidthHint")}</p>
        </div>
        <fieldset className="md:col-span-2 lg:col-span-3">
          <legend className="mb-3 text-sm font-medium">{t("avoid")}</legend>
          <div className="flex flex-wrap gap-2">
            {Object.keys(COLORS).map((id) => (
              <label key={id} className="border-hairline has-[:checked]:bg-dusk has-[:checked]:text-glass inline-flex h-9 cursor-pointer items-center gap-2 rounded-full border px-4 text-sm has-[:focus-visible]:outline-2">
                <input type="checkbox" name="avoid" value={id} defaultChecked={all(search.avoid).includes(id)} className="sr-only" />
                {colorLabel(id, locale)}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="flex items-end">
          <button type="submit" className="bg-dusk text-glass rounded-plinth hover:bg-dusk/90 h-11 w-full cursor-pointer px-6 text-sm font-medium transition-colors">
            {t("submit")}
          </button>
        </div>
      </form>

      {result === null ? (
        <section className="mt-10 max-w-[62ch]">
          <h2 className="font-display text-xl">{t("howItWorks")}</h2>
          <p className="text-slate mt-3">{t("howItWorksBody")}</p>
        </section>
      ) : result.bundles.length === 0 ? (
        <EmptyState
          title={t("emptyTitle")}
          description={t("emptyDescription")}
          action={
            result.missingRequired.length > 0 ? (
              <ul className="text-slate text-sm">
                {result.missingRequired.map((slot) => (
                  <li key={slot}>{t("missingSlot", { slot: slotName(slot) })}</li>
                ))}
              </ul>
            ) : undefined
          }
        />
      ) : (
        <>
          <p className="text-slate mt-6 text-sm" aria-live="polite">
            {result.stats.exact ? t("exactNote", { ms: Math.max(1, Math.round(result.stats.elapsedMs)) }) : t("approximateNote")}
          </p>
          <div className="mt-6 grid gap-6 lg:grid-cols-3">
            {result.bundles.map((bundle, bundleIndex) => (
              <section key={bundleIndex} className="bg-plinth/60 rounded-sheet flex flex-col gap-5 p-5" data-agent-id={`bundle:${bundleIndex}`} aria-labelledby={`bundle-${bundleIndex}-title`}>
                <div className="flex items-baseline justify-between gap-4">
                  <h2 id={`bundle-${bundleIndex}-title`} className="font-display text-xl">{t("setTitle", { number: bundleIndex + 1 })}</h2>
                  <p className="tabular text-lg">{euros(bundle.totalCents)}</p>
                </div>
                <p className="text-slate -mt-4 text-sm">{t("remaining", { amount: euros(bundle.remainingCents) })}</p>

                <ul className="flex flex-col gap-4">
                  {bundle.picks.map((pick) => {
                    const card: ProductCard | undefined = cards.get(pick.productId);
                    if (card === undefined) return null;
                    const open = swap?.bundle === bundleIndex && swap.slot === pick.slotId;
                    return (
                      <li key={pick.slotId} className="flex flex-col gap-2">
                        <div className="grid grid-cols-[4.5rem_1fr_auto] items-start gap-3">
                          <div className="bg-plinth rounded-plinth relative aspect-square overflow-hidden">
                            {card.image === null ? null : (
                              <div className="on-plinth absolute inset-1">
                                <ProductImage image={card.image} sizes="4.5rem" />
                              </div>
                            )}
                          </div>
                          <div className="min-w-0">
                            <p className="text-slate text-xs first-letter:uppercase">{slotName(pick.slotId)}</p>
                            <SmartLink href={`/p/${card.slug}`} className="line-clamp-2 text-sm no-underline hover:underline underline-offset-4">
                              {pick.quantity > 1 ? `${t("quantity", { count: pick.quantity })} ` : ""}
                              {card.title}
                            </SmartLink>
                            <SmartLink href={open ? hrefWith({}) : hrefWith({ swap: `${bundleIndex}:${pick.slotId}` })} scroll={false} className="text-slate mt-1 inline-block text-xs underline-offset-4">
                              {open ? t("hideOptions") : t("otherOptions")}
                            </SmartLink>
                          </div>
                          <Price amount={money(pick.lineTotalCents)} locale={locale} size="sm" />
                        </div>

                        {open ? (
                          <div className="border-hairline ml-[5.25rem] border-l pl-3">
                            <p className="text-slate text-xs">{t("optionsFor", { slot: slotName(pick.slotId) })}</p>
                            {swap.options.length === 0 ? (
                              <p className="text-slate mt-2 text-sm">{t("noOptions")}</p>
                            ) : (
                              <ul className="mt-2 flex flex-col gap-2">
                                {swap.options.map((option) => {
                                  const optionCard = cards.get(option.productId);
                                  if (optionCard === undefined) return null;
                                  return (
                                    <li key={option.productId} className="flex items-baseline justify-between gap-3 text-sm">
                                      <SmartLink href={`/p/${optionCard.slug}`} className="line-clamp-1 no-underline hover:underline underline-offset-4">
                                        {optionCard.title}
                                      </SmartLink>
                                      <span className="text-slate tabular shrink-0 text-xs">{t("setWithThis", { amount: euros(option.bundleTotalCents) })}</span>
                                    </li>
                                  );
                                })}
                              </ul>
                            )}
                          </div>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>

                {whyLines(bundle).length === 0 ? null : (
                  <div className="border-hairline mt-auto border-t pt-4">
                    <h3 className="text-sm font-medium">{t("why")}</h3>
                    {whyLines(bundle).map((line) => (
                      <p key={line} className="text-slate mt-1 text-sm">{line}</p>
                    ))}
                  </div>
                )}
              </section>
            ))}
          </div>
        </>
      )}
    </main>
  );
}

