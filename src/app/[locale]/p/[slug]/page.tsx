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
import { ListenButton } from "@/components/comfort/listen-button";
import { RegionNote } from "@/components/commerce/region-control";
import { currentRegion } from "@/lib/commerce/region";
import { PriceWatch } from "@/components/commerce/price-watch";
import { SizePicker, type SizeOption } from "@/components/commerce/size-picker";
import { ModelView } from "@/components/commerce/model-view";
import { PictureStudio, type StudioPiece } from "@/components/pictures/picture-studio";
import { WayIn } from "@/components/fit/way-in";
import { AddToBoard } from "@/components/boards/add-to-board";
import { SpinView } from "@/components/commerce/spin-view";
import { ProductGallery } from "@/components/commerce/product-gallery";
import { ProductGrid } from "@/components/commerce/product-grid";
import { TrackInterest } from "@/components/reco/track-interest";
import { productTransitionName } from "@/components/commerce/product-tile";
import { ButtonLink } from "@/components/ui/button";
import { Price } from "@/components/ui/price";
import { ProductReviews } from "@/components/commerce/product-reviews";
import { AmazonReviews } from "@/components/commerce/amazon-reviews";
import { Rating } from "@/components/ui/rating";
import { SmartLink } from "@/components/ui/smart-link";
import { serverEnv } from "@/env";
import { requireLocale } from "@/i18n/params";
import { routing } from "@/i18n/routing";
import { getAlternatives, getCardsByIds, getFeatured, getProduct } from "@/lib/catalog/server";
import type { CatalogImage, ProductCard } from "@/lib/catalog/queries";
import { formatMoney, type Money } from "@/lib/commerce/money";
import { photoUrl } from "@/lib/photos/server";
import { canMakeModel } from "@/lib/catalog/model/family";
import { pairsWith } from "@/lib/reco/server";
import { productJsonLd, serializeJsonLd } from "@/lib/catalog/structured-data";
import { priceWatches, reviewsStore } from "@/lib/commerce/server";
import { currentUser } from "@/lib/auth/session";
import { knownActor } from "@/lib/ai/server";
import { sameOriginImage } from "@/lib/catalog/media-url";
import { roomTypeFor } from "@/lib/pictures/pictures";
import { pictureStore } from "@/lib/pictures/server";
import { showroomTiles } from "@/lib/pictures/showrooms";
import { pictureView, picturesOpen } from "@/lib/pictures/start";
import { storage } from "@/lib/storage";
import { roomPlacement } from "@/lib/catalog/taxonomy";
import { sizeChartFor } from "@/lib/catalog/capsule";
import { CAPSULE_SIZES } from "@/lib/catalog/taxonomy";
import { preferredSize, roomFits, sizeGroupOf } from "@/lib/prefs/preferences";
import { currentPreferences } from "@/lib/prefs/server";
import { externalReviewStore, productInsights } from "@/lib/reviews/server";
import { wearChart } from "@/lib/catalog/wear";
import { colorLabel, materialLabel } from "@/lib/search/vocabulary";

/**
 * Product page (docs/PLAN.md 4.3, Phase 3 step 6).
 *
 * The media stage on the left, the decision column on the right. Everything a
 * shopper decides on — price, stock, dimensions — is read from the database for
 * this request. "See it in your room" and "See it in 3D" are offered for the same
 * pieces: those with measured dimensions that stand or lie on a floor. The 3D
 * shape is built from those dimensions (docs/adr/025); a 360° spin waits for the
 * full ABO import.
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

export default async function ProductPage({ params, searchParams }: PageProps<"/[locale]/p/[slug]">) {
  const locale = await requireLocale(params);
  const { slug } = await params;

  const product = await getProduct(slug, locale);
  if (product === null) notFound();

  const t = await getTranslations("product");
  const tf = await getTranslations("fit");
  const nav = await getTranslations("nav");
  // "Pairs well with": products browsed and bought together with this one
  // (Taste Graph behaviour); before there is behaviour, the most similar ones.
  const neighbours = await pairsWith(product.id, 4);
  const neighbourCards = neighbours.ids.length > 0 ? await getCardsByIds(neighbours.ids, locale) : [];
  const related = neighbourCards.length > 0 ? neighbourCards : await getFeatured({ locale, limit: 4, category: product.category, excludeIds: [product.id] });
  const relatedTitle = neighbours.source === "behavior" && neighbourCards.length > 0 ? t("pairsWith") : t("moreLikeThis");

  const reviews = await (await reviewsStore()).productReviews(product.id, { limit: 10 });
  // What buyers like and mention against, read from every published review (docs/adr/041).
  const insights = reviews.summary.count === 0 ? undefined : await productInsights(product.id);
  // Reviews Amazon.com customers wrote of this same product, for the ABO wearables: shown apart, never counted as ours (docs/adr/061).
  const amazon = await (await externalReviewStore()).forProduct(product.id);
  // A price watch belongs to an account, so the form only has a target to show for someone signed in.
  const user = await currentUser();
  const watch = user === null ? null : await (await priceWatches()).forProduct({ userId: user.id, productId: product.id });
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
  // A garment's label: who it is for, its fabric as the label gives it, and its care (docs/adr/062).
  if (product.attributes.department === "women" || product.attributes.department === "men") {
    specs.push({ label: t("for"), value: t(`forValue.${product.attributes.department}`) });
  }
  if (product.attributes.fabric !== undefined && locale === "en") specs.push({ label: t("fabric"), value: product.attributes.fabric });
  if (product.attributes.care !== undefined && locale === "en") specs.push({ label: t("care"), value: product.attributes.care });

  const stock =
    product.stock === 0
      ? { label: t("outOfStock"), tone: "text-danger" }
      : product.stock <= LOW_STOCK
        ? { label: t("lowStock", { count: product.stock }), tone: "text-dusk" }
        : { label: t("inStock"), tone: "text-success" };

  // A piece cut in sizes is added by size; everything else has one variant (docs/adr/022).
  const sizes: SizeOption[] = product.variants
    .filter((variant) => variant.size !== null)
    .map((variant) => ({ variantId: variant.id, size: variant.size!, stock: variant.stock }));
  const sizeChart = sizes.length > 0 ? sizeChartFor(product.kind) : null;
  // Shoes and hats chart their own measure: foot length by EU size, head circumference by S/M/L (docs/adr/061).
  const wearSizeChart = sizes.length > 0 && sizeChart === null ? wearChart(product.kind, sizes.map((entry) => entry.size)) : null;

  // What the shopper has told the shop (docs/adr/033): their size for this kind of garment, and their rooms.
  const { preferences } = await currentPreferences();
  const yourSize = sizes.length > 0 ? preferredSize(preferences, product.kind) : null;
  const sizeGroup = sizeGroupOf(product.kind);
  const finder = sizeChart === null || sizeGroup === null ? undefined : { chart: sizeChart, group: sizeGroup };
  const fits = roomFits(product.dimsCm, preferences.rooms);
  // "Will it get in?" (docs/adr/055): for pieces that go in a room, carried as their catalogue box.
  const wayInBox = product.dimsCm !== null && roomPlacement(product.kind, product.dimsCm) !== null ? product.dimsCm : null;

  // "Picture it" (docs/adr/053, docs/adr/060), for pieces that belong in a room: the showroom pictures already
  // made, whether new ones can be made now, this shopper's own from the last day and the room they last gave,
  // the style tiles, and pieces of the same kind to try in the same room. Reads only: no guest id is minted.
  const pictureable = sizes.length === 0 && roomPlacement(product.kind, product.dimsCm) !== null;
  const studioImage = product.media.find((entry) => entry.studio === true) ?? product.image;
  const pictureActor = pictureable ? await knownActor(user) : null;
  const pictures = pictureable ? await pictureStore() : null;
  const madeScenes = pictures === null ? [] : await pictures.scenesOf(product.id);
  const canMakePictures = pictureable && (await picturesOpen());
  const picturesLeft = pictures === null || pictureActor === null ? null : await pictures.left(pictureActor);
  const myPictures = pictures === null || pictureActor === null ? [] : await pictures.mineFor(pictureActor.key, product.id);
  const lastRoom = pictures === null || pictureActor === null || !canMakePictures ? null : await pictures.rememberedRoom(pictureActor.key);
  const showStudio = pictureable && (canMakePictures || madeScenes.length > 0 || myPictures.length > 0);
  const studioTiles = showStudio ? await showroomTiles(await storage(), roomTypeFor(product.kind, product.titleEn, product.dimsCm)) : {};
  const priceLabel = (card: { price: Money }) => formatMoney(card.price, locale);
  const studioPiece = (card: ProductCard, image: CatalogImage | null): StudioPiece => ({
    id: card.id,
    slug: card.slug,
    title: card.title,
    image: image === null ? null : sameOriginImage(image.src, 640),
    canPlace: true,
    price: priceLabel(card),
    inStock: card.inStock,
  });
  const studioAlternatives =
    showStudio && canMakePictures
      ? (await getAlternatives({ productId: product.id, kind: product.kind, priceCents: product.price.cents, locale, limit: 8 })).map((card) => studioPiece(card, card.image))
      : [];

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

          <div className="mt-4 flex flex-col gap-1">
            {/* The shop's own rating; where it has none yet but Amazon.com customers reviewed the same product, a labelled way to theirs (docs/adr/061). */}
            {product.ratingCount === 0 && amazon !== null && amazon.reviews.length > 0 ? null : (
              <Rating value={product.ratingCount === 0 ? 0 : product.ratingSum / product.ratingCount} count={product.ratingCount} locale={locale} />
            )}
            {amazon === null || amazon.reviews.length === 0 ? null : (
              <a href="#amazon-reviews-heading" className="text-slate text-sm underline-offset-4 hover:underline" data-agent-id="product:amazon-rating">
                {t("amazonRating", {
                  average: new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(amazon.summary.ratingSum / amazon.summary.count),
                  count: amazon.summary.count,
                })}
              </a>
            )}
          </div>

          {sizes.length === 0 ? null : <SizePicker productId={product.id} sizes={sizes} preferred={yourSize ?? undefined} finder={finder} agentId={`action:add-to-cart:${product.id}`} />}

          <div className="mt-8 flex flex-col gap-3">
            {sizes.length > 0 ? null : <AddToCart productId={product.id} inStock={product.inStock} agentId={`action:add-to-cart:${product.id}`} />}
            {/* The Concierge's open_viewer arrives as ?view=ar or ?view=model (docs/adr/025). */}
            {product.model == null && !canMakeModel(product.kind, product.dimsCm) ? null : (
              <ModelView
                slug={product.slug}
                productId={product.id}
                title={product.title}
                dims={product.dimsCm!}
                startOpen={["ar", "model"].includes(String((await searchParams).view ?? ""))}
                origin={product.model != null ? "scan" : product.aiModel != null ? "ai" : "made"}
                scan={product.model?.src}
                poster={posterOf(product.media)}
                dressed={product.model == null && product.aiModel == null && product.kind === "BED"}
              />
            )}
            {/* Turntable photographs, when the piece has them (docs/adr/035). */}
            {product.spin.length < 8 ? null : <SpinView frames={product.spin} title={product.title} productId={product.id} />}
            {roomPlacement(product.kind, product.dimsCm) === null ? null : (
              <ButtonLink href={`/${locale}/room?product=${product.slug}`} document variant="secondary" data-agent-id={`action:see-in-room:${product.id}`}>
                {t("seeInYourRoom")}
              </ButtonLink>
            )}
            {/* Room boards (docs/adr/056): pieces for a room, collected and shared. */}
            {sizes.length > 0 ? null : <AddToBoard productId={product.id} title={product.title} />}
            {/* The Fitting Room tries on the clothing capsule; shoes, bags and jewellery come with Try-On Max (docs/adr/061, slice W2). */}
            {sizes.length === 0 || product.category !== "wear" ? null : (
              <ButtonLink href="/fitting-room" variant="secondary" data-agent-id={`action:try-it-on:${product.id}`}>
                {t("tryItOn")}
              </ButtonLink>
            )}
          </div>

          <PriceWatch
            productId={product.id}
            slug={product.slug}
            priceCents={product.price.cents}
            currency={product.price.currency}
            targetCents={watch?.targetCents ?? null}
            signedIn={user !== null}
          />

          {product.translated ? null : <p className="text-slate mt-8 text-sm">{t("translationPending")}</p>}

          {product.highlights.length > 0 ? (
            <section className="mt-8">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-sm font-medium">{t("highlights")}</h2>
                {/* Read aloud: the highlights, then the description (docs/adr/032). */}
                <ListenButton targets={["product-highlights", "product-description"]} />
              </div>
              <ul id="product-highlights" className="text-slate mt-3 flex list-disc flex-col gap-2 pl-5 text-sm" lang={copyLang}>
                {product.highlights.map((highlight) => (
                  <li key={highlight}>{highlight}</li>
                ))}
              </ul>
            </section>
          ) : null}

          {sizeChart === null ? null : (
            <section className="mt-8" data-agent-id="product:size-chart">
              <h2 className="text-sm font-medium">{t("sizes.chartTitle")}</h2>
              <p className="text-slate mt-1 text-sm">{t("sizes.chartLede")}</p>
              <div className="-mx-1 mt-3 overflow-x-auto px-1">
                <table className="w-full text-sm">
                  <caption className="sr-only">{t("sizes.chartTitle")}</caption>
                  <thead>
                    <tr className="text-slate text-left">
                      <th scope="col" className="py-2 pr-4 font-medium">{t("sizes.measurement")}</th>
                      {CAPSULE_SIZES.map((size) => (
                        <th key={size} scope="col" className="tabular py-2 pr-4 text-right font-medium">
                          {size}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sizeChart.map((row) => (
                      <tr key={row.measure.en} className="border-hairline border-t">
                        <th scope="row" className="py-2 pr-4 text-left font-normal">
                          {locale === "el" ? row.measure.el : row.measure.en}
                        </th>
                        {CAPSULE_SIZES.map((size) => (
                          <td key={size} className="tabular py-2 pr-4 text-right">
                            {row.values[size]}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {wearSizeChart === null ? null : (
            <section className="mt-8" data-agent-id="product:size-chart">
              <h2 className="text-sm font-medium">{t("sizes.chartTitle")}</h2>
              <p className="text-slate mt-1 text-sm">{t("sizes.wearChartLede")}</p>
              <div className="-mx-1 mt-3 overflow-x-auto px-1">
                <table className="w-full text-sm">
                  <caption className="sr-only">{t("sizes.chartTitle")}</caption>
                  <thead>
                    <tr className="text-slate text-left">
                      <th scope="col" className="py-2 pr-4 font-medium">{t("sizes.measurement")}</th>
                      {sizes.map((entry) => (
                        <th key={entry.size} scope="col" className="tabular py-2 pr-3 text-right font-medium">
                          {entry.size}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {wearSizeChart.map((row) => (
                      <tr key={row.measure.en} className="border-hairline border-t">
                        <th scope="row" className="py-2 pr-4 text-left font-normal">
                          {locale === "el" ? row.measure.el : row.measure.en}
                        </th>
                        {sizes.map((entry) => (
                          <td key={entry.size} className="tabular py-2 pr-3 text-right">
                            {new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(row.values[entry.size] ?? 0)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

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
              {/* Against the rooms the shopper told the shop about, with room to walk past (docs/adr/033). */}
              {fits.length === 0 ? null : (
                <ul className="mt-3 flex flex-col gap-1 text-sm" data-agent-id="product:room-fit">
                  {fits.map((fit) => (
                    <li key={fit.room} className={fit.fits ? "text-success" : "text-slate"}>
                      {fit.fits ? t("fits.yes", { room: fit.room, wall: fit.wallCm, spare: fit.spareCm }) : t("fits.no", { room: fit.room, wall: fit.wallCm })}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ) : null}

          {wayInBox === null ? null : (
            <details className="border-hairline group mt-6 border-t pt-4" open={preferences.wayIn.length > 0} data-agent-id="product:way-in">
              <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-4 text-sm font-medium [&::-webkit-details-marker]:hidden">
                {tf("title")}
                <span aria-hidden="true" className="text-slate text-lg leading-none transition-transform duration-quick group-open:rotate-45">
                  +
                </span>
              </summary>
              <p className="text-slate mt-1 max-w-[60ch] text-sm">{tf("lede")}</p>
              <div className="mt-4">
                <WayIn box={wayInBox} saved={preferences.wayIn} />
              </div>
              <p className="text-slate mt-4 max-w-[60ch] text-xs">{tf("note")}</p>
            </details>
          )}

          {product.description === null ? null : (
            <p id="product-description" className="text-slate mt-8 max-w-[60ch] text-sm leading-relaxed whitespace-pre-line" lang={copyLang}>
              {product.description}
            </p>
          )}
        </div>
      </div>

      {!showStudio ? null : (
        <PictureStudio
          piece={{ ...studioPiece(product, studioImage), image: studioImage === null ? null : sameOriginImage(studioImage.src, 1080), inStock: product.stock > 0 }}
          scenes={await Promise.all(madeScenes.map(pictureView))}
          mine={await Promise.all(myPictures.map(pictureView))}
          tiles={studioTiles}
          canMake={canMakePictures}
          left={picturesLeft}
          signedIn={user !== null}
          room={lastRoom === null ? null : { uploadId: lastRoom.uploadId, url: await photoUrl(lastRoom.storageKey), expiresAt: lastRoom.expiresAt.toISOString() }}
          alternatives={studioAlternatives}
        />
      )}

      <ProductReviews summary={reviews.summary} reviews={reviews.reviews} locale={locale} insights={insights} />
      {amazon === null || amazon.reviews.length === 0 ? null : <AmazonReviews summary={amazon.summary} reviews={amazon.reviews} sized={sizes.length > 1} locale={locale} />}

      {related.length === 0 ? null : (
        <section className="border-hairline mt-20 border-t pt-10" data-shelf={neighbours.source === "behavior" && neighbourCards.length > 0 ? "pairs-with" : "more-like-this"}>
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

/** The piece's studio photograph through the shop's image optimizer, as the 3D view's poster while the model loads. */
function posterOf(media: readonly { src: string; studio?: boolean }[]): string | undefined {
  const photo = media.find((image) => image.studio !== false) ?? media[0];
  return photo === undefined ? undefined : `/_next/image?url=${encodeURIComponent(photo.src)}&w=640&q=75`;
}
