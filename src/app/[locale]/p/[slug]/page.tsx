/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Product detail page: gallery, price, stock, add to cart, structured data and recommendations.
 */

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { AddToCart } from "@/components/commerce/add-to-cart";
import { RegionNote } from "@/components/commerce/region-control";
import { currentRegion } from "@/lib/commerce/region";
import { ProductGallery } from "@/components/commerce/product-gallery";
import { ProductGrid } from "@/components/commerce/product-grid";
import { TrackInterest } from "@/components/reco/track-interest";
import { productTransitionName } from "@/components/commerce/product-tile";
import { ButtonLink } from "@/components/ui/button";
import { Price } from "@/components/ui/price";
import { ProductReviews } from "@/components/commerce/product-reviews";
import { Rating } from "@/components/ui/rating";
import { SmartLink } from "@/components/ui/smart-link";
import { serverEnv } from "@/env";
import { requireLocale } from "@/i18n/params";
import { routing } from "@/i18n/routing";
import { getCardsByIds, getFeatured, getProduct } from "@/lib/catalog/server";
import { pairsWith } from "@/lib/reco/server";
import { productJsonLd, serializeJsonLd } from "@/lib/catalog/structured-data";
import { reviewsStore } from "@/lib/commerce/server";
import { roomPlacement } from "@/lib/catalog/taxonomy";
import { colorLabel, materialLabel } from "@/lib/search/vocabulary";

/**
 * Product page (docs/PLAN.md 4.3, Phase 3 step 6).
 *
 * The media stage on the left, the decision column on the right. Everything a
 * shopper decides on — price, stock, dimensions — is read from the database for
 * this request. The 360° spin, the 3D viewer and AR arrive with the full ABO
 * import, and the review summary in Phase 5. "See it in your room" is offered for
 * pieces with measured dimensions that stand or lie on a floor.
 */

/** Few enough left that it is worth saying. */
const LOW_STOCK = 5;

export async function generateMetadata({ params }: PageProps<"/[locale]/p/[slug]">): Promise<Metadata> {
  const { locale, slug } = await params;
  const product = await getProduct(slug, locale);
  if (product === null) return {};

  const description = product.highlights[0] ?? [product.kindLabel, product.brand].filter(Boolean).join(" · ");
  return {
    title: product.title,
    description,
    alternates: {
      canonical: `/${locale}/p/${slug}`,
      languages: Object.fromEntries(routing.locales.map((candidate) => [candidate, `/${candidate}/p/${slug}`])),
    },
    openGraph: {
      type: "website",
      title: product.title,
      description,
      images: product.image === null ? [] : [{ url: product.image.src, width: product.image.width, height: product.image.height, alt: product.image.alt }],
    },
  };
}

export default async function ProductPage({ params }: PageProps<"/[locale]/p/[slug]">) {
  const locale = await requireLocale(params);
  const { slug } = await params;

  const product = await getProduct(slug, locale);
  if (product === null) notFound();

  const t = await getTranslations("product");
  const nav = await getTranslations("nav");
  // "Pairs well with": products browsed and bought together with this one
  // (Taste Graph behaviour); before there is behaviour, the most similar ones.
  const neighbours = await pairsWith(product.id, 4);
  const neighbourCards = neighbours.ids.length > 0 ? await getCardsByIds(neighbours.ids, locale) : [];
  const related = neighbourCards.length > 0 ? neighbourCards : await getFeatured({ locale, limit: 4, category: product.category, excludeIds: [product.id] });
  const relatedTitle = neighbours.source === "behavior" && neighbourCards.length > 0 ? t("pairsWith") : t("moreLikeThis");

  const reviews = await (await reviewsStore()).productReviews(product.id, { limit: 10 });
  const origin = serverEnv().APP_URL;
  const jsonLd = productJsonLd(product, {
    reviews,
    origin,
    url: new URL(`/${locale}/p/${product.slug}`, origin).toString(),
    categoryUrl: new URL(`/${locale}/c/${product.category}`, origin).toString(),
  });

  const specs: { label: string; value: string; hint?: string }[] = [];
  if (product.dimsCm !== null) {
    specs.push({ label: t("dimensions"), value: t("dimensionsValue", product.dimsCm), hint: t("dimensionsHint") });
  }
  if (product.weightGrams !== null) {
    const kg = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(product.weightGrams / 1000);
    specs.push({ label: t("weight"), value: t("weightValue", { kg }) });
  }
  if (product.materials.length > 0) {
    specs.push({ label: t("materials"), value: product.materials.map((id) => materialLabel(id, locale)).join(", ") });
  }
  if (product.colors.length > 0 || product.colorLabel !== null) {
    const value = locale === "el" || product.colorLabel === null
      ? product.colors.map((id) => colorLabel(id, locale)).join(", ")
      : product.colorLabel;
    if (value !== "") specs.push({ label: t("colour"), value });
  }
  if (product.attributes.style !== undefined && locale === "en") {
    specs.push({ label: t("style"), value: product.attributes.style });
  }

  const stock =
    product.stock === 0
      ? { label: t("outOfStock"), tone: "text-danger" }
      : product.stock <= LOW_STOCK
        ? { label: t("lowStock", { count: product.stock }), tone: "text-dusk" }
        : { label: t("inStock"), tone: "text-success" };

  const imageLabels = product.media.map((_, index) => t("showImage", { index: index + 1, count: product.media.length }));
  // English copy on a Greek page is marked as English, for screen readers and translation tools.
  const copyLang = product.translated ? undefined : "en";

  return (
    <main className="mx-auto w-full max-w-[1440px] px-6 py-10 md:px-10">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }} />
      <TrackInterest productId={product.id} />

      <nav aria-label={t("breadcrumb")} className="text-slate mb-6 text-sm">
        <ol className="flex flex-wrap items-center gap-2">
          <li>
            <SmartLink href="/" className="no-underline hover:underline underline-offset-4">
              {nav("home")}
            </SmartLink>
          </li>
          <li aria-hidden="true">/</li>
          <li>
            <SmartLink href={`/c/${product.category}`} className="no-underline hover:underline underline-offset-4">
              {product.categoryName}
            </SmartLink>
          </li>
          <li aria-hidden="true">/</li>
          <li aria-current="page" className="text-dusk line-clamp-1" lang={copyLang}>
            {product.title}
          </li>
        </ol>
      </nav>

      <div className="grid gap-10 lg:grid-cols-[1.2fr_1fr] lg:gap-16">
        <ProductGallery
          images={product.media}
          transitionName={productTransitionName(product.id)}
          label={t("gallery")}
          showImageLabel={imageLabels}
        />

        <div className="lg:sticky lg:top-24 lg:self-start" data-agent-id={`product-detail:${product.id}`}>
          <p className="text-slate text-sm">
            {[product.brand, product.kindLabel].filter(Boolean).join(" · ")}
          </p>
          <h1 className="font-display mt-2 text-3xl leading-tight" lang={copyLang}>
            {product.title}
          </h1>

          <div className="mt-5 flex flex-wrap items-baseline gap-3">
            <Price amount={product.price} compareAt={product.compareAt ?? undefined} locale={locale} size="lg" />
          </div>

          <RegionNote country={(await currentRegion()).country} className="text-slate mt-2 text-xs" />

          <p className={`mt-3 text-sm ${stock.tone}`} data-agent-id={`stock:${product.id}`}>
            {stock.label}
          </p>

          <div className="mt-4">
            <Rating value={product.ratingCount === 0 ? 0 : product.ratingSum / product.ratingCount} count={product.ratingCount} locale={locale} />
          </div>

          <div className="mt-8 flex flex-col gap-3">
            <AddToCart productId={product.id} inStock={product.inStock} agentId={`action:add-to-cart:${product.id}`} />
            {roomPlacement(product.kind, product.dimsCm) === null ? null : (
              <ButtonLink href={`/${locale}/room?product=${product.slug}`} document variant="secondary" data-agent-id={`action:see-in-room:${product.id}`}>
                {t("seeInYourRoom")}
              </ButtonLink>
            )}
          </div>

          {product.translated ? null : <p className="text-slate mt-8 text-sm">{t("translationPending")}</p>}

          {product.highlights.length > 0 ? (
            <section className="mt-8">
              <h2 className="text-sm font-medium">{t("highlights")}</h2>
              <ul className="text-slate mt-3 flex list-disc flex-col gap-2 pl-5 text-sm" lang={copyLang}>
                {product.highlights.map((highlight) => (
                  <li key={highlight}>{highlight}</li>
                ))}
              </ul>
            </section>
          ) : null}

          {specs.length > 0 ? (
            <section className="mt-8">
              <h2 className="text-sm font-medium">{t("details")}</h2>
              <dl className="border-hairline mt-3 divide-hairline divide-y border-y text-sm">
                {specs.map((spec) => (
                  <div key={spec.label} className="grid grid-cols-[9rem_1fr] gap-4 py-3">
                    <dt className="text-slate">{spec.label}</dt>
                    <dd className="tabular">
                      {spec.value}
                      {spec.hint === undefined ? null : <span className="text-slate block text-xs">{spec.hint}</span>}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ) : null}

          {product.description === null ? null : (
            <p className="text-slate mt-8 max-w-[60ch] text-sm leading-relaxed whitespace-pre-line" lang={copyLang}>
              {product.description}
            </p>
          )}
        </div>
      </div>

      <ProductReviews summary={reviews.summary} reviews={reviews.reviews} locale={locale} />

      {related.length === 0 ? null : (
        <section className="border-hairline mt-20 border-t pt-10">
          <h2 className="font-display text-2xl">{relatedTitle}</h2>
          <ProductGrid products={related} locale={locale} className="mt-8" priorityCount={0} />
        </section>
      )}

      <p className="mt-16">
        <ButtonLink href={`/c/${product.category}`} variant="tertiary">
          {t("backToCollection")}
        </ButtonLink>
      </p>
    </main>
  );
}
