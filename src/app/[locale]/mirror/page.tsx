/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * The AR Mirror: hats, earrings and necklaces tried on live through the front camera, on the shopper's own device.
 */

import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { ArMirror, type MirrorPiece } from "@/components/mirror/ar-mirror";
import { requireLocale } from "@/i18n/params";
import { routing } from "@/i18n/routing";
import { sameOriginImage } from "@/lib/catalog/media-url";
import { getFeatured, getProduct } from "@/lib/catalog/server";
import { isMirrorKind, MIRROR_KINDS } from "@/lib/vision/mirror/pieces";

/**
 * docs/adr/065. The pieces come from the catalogue: every hat, pair of
 * earrings and necklace on sale, the most popular first, and the one the
 * shopper came from (`?piece=<slug>`) first of all. Their photographs come
 * through the shop's own image server, so the page can read their pixels to
 * cut them out (a picture from another host could not be read).
 */

const PIECES = 60;

export async function generateMetadata({ params }: PageProps<"/[locale]/mirror">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "mirror" });
  return {
    title: t("title"),
    description: t("lede"),
    alternates: {
      canonical: `/${locale}/mirror`,
      languages: Object.fromEntries(routing.locales.map((candidate) => [candidate, `/${candidate}/mirror`])),
    },
  };
}

export default async function MirrorPage({ params, searchParams }: PageProps<"/[locale]/mirror">) {
  const locale = await requireLocale(params);
  const t = await getTranslations("mirror");
  const asked = (await searchParams).piece;
  const wanted = typeof asked === "string" && asked.length <= 200 ? await getProduct(asked, locale) : null;
  const focus = wanted !== null && isMirrorKind(wanted.kind) ? wanted : null;

  const featured = await getFeatured({ locale, limit: PIECES, kinds: MIRROR_KINDS, excludeIds: focus === null ? [] : [focus.id] });
  const pieces: MirrorPiece[] = [];
  if (focus !== null && isMirrorKind(focus.kind)) {
    const image = focus.media[0] ?? null;
    pieces.push({ slug: focus.slug, title: focus.title, kind: focus.kind, image: image === null ? null : sameOriginImage(image.src, 640) });
  }
  for (const product of featured) {
    if (!isMirrorKind(product.kind)) continue;
    pieces.push({ slug: product.slug, title: product.title, kind: product.kind, image: product.image === null ? null : sameOriginImage(product.image.src, 640) });
  }

  return (
    <main className="mx-auto w-full max-w-[1100px] px-6 py-10 md:px-10 md:py-16" data-agent-id="mirror:page">
      <h1 className="font-display text-3xl">{t("title")}</h1>
      <p className="text-slate mt-3 max-w-[70ch]">{t("lede")}</p>
      <ArMirror pieces={pieces} focus={focus?.slug ?? null} />
    </main>
  );
}
