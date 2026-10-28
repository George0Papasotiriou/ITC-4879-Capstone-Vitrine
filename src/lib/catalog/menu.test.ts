/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Unit tests for the categories menu: every link leads to products the shop sells, or to a page that exists.
 */

import { existsSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import en from "../../../messages/en.json";
import el from "../../../messages/el.json";
import { parseListing } from "@/lib/catalog/listing";
import { MENU, menuLinks } from "@/lib/catalog/menu";
import { CATEGORIES, productKindOf } from "@/lib/catalog/taxonomy";
import { brandSlug } from "@/lib/catalog/write";

/**
 * docs/adr/067. The production catalogue is what `pnpm db:setup` syncs on
 * every deploy: these committed fixtures. A link counts as good when at least
 * one product in them matches it, so the menu can never send a shopper to an
 * empty page on the live site.
 */

type Product = { kind: string; category: string; brand: string | null; priceCents: number; attributes?: Record<string, string> };
const FIXTURES = ["specimen.json", "collection.json", "abo.json", "abo-wear.json", "amazon-clothes.json"];
const products: Product[] = FIXTURES.flatMap((file) => (JSON.parse(readFileSync(`src/lib/catalog/fixtures/${file}`, "utf8")) as { products: Product[] }).products);

/** How many fixture products a listing link shows, by the same filters the listing applies. */
function matches(href: string): number {
  const url = new URL(href, "https://vitrine.invalid");
  const category = url.pathname === "/c" ? null : url.pathname.replace(/^\/c\//, "");
  const state = parseListing(Object.fromEntries([...new Set(url.searchParams.keys())].map((key) => [key, url.searchParams.getAll(key)])));
  return products.filter(
    (product) =>
      (category === null || product.category === category) &&
      (state.kinds.length === 0 || state.kinds.includes(product.kind)) &&
      (state.brands.length === 0 || (product.brand !== null && state.brands.includes(brandSlug(product.brand)))) &&
      (state.departments.length === 0 || state.departments.includes(product.attributes?.department ?? "")) &&
      (state.maxCents === null || product.priceCents <= state.maxCents),
  ).length;
}

const lookup = (messages: unknown, path: string): unknown => path.split(".").reduce<unknown>((value, key) => (value as Record<string, unknown> | undefined)?.[key], messages);

describe("the categories menu", () => {
  const links = menuLinks();

  it("leads every catalogue link to products the live shop sells", () => {
    const listings = links.filter((link) => link.href === "/c" || link.href.startsWith("/c/") || link.href.startsWith("/c?"));
    expect(listings.length).toBeGreaterThan(40);
    for (const link of listings) expect(matches(link.href), link.href).toBeGreaterThan(0);
  });

  it("names only categories and kinds the catalogue has, each kind under its own category", () => {
    for (const link of links) {
      const label = link.label;
      if ("category" in label) expect(CATEGORIES.some((category) => category.slug === label.category)).toBe(true);
      const url = new URL(link.href, "https://vitrine.invalid");
      for (const code of url.searchParams.getAll("kind")) {
        expect(productKindOf(code), code).toBeDefined();
        expect(productKindOf(code)!.category, code).toBe(url.pathname.replace(/^\/c\//, ""));
      }
      // The listing keeps every kind the link asks for: none is a code the parser would drop.
      expect(parseListing({ kind: url.searchParams.getAll("kind") }).kinds.length).toBe(url.searchParams.getAll("kind").length);
    }
  });

  it("links every other page to a route that exists", () => {
    for (const link of links.filter((entry) => !entry.href.startsWith("/c"))) {
      expect(existsSync(`src/app/[locale]${link.href}/page.tsx`), link.href).toBe(true);
    }
  });

  it("gives every link a target id the Concierge accepts, once", () => {
    const ids = links.map((link) => `menu:${link.id}`);
    for (const id of ids) expect(id).toMatch(/^[a-z]{1,24}:[A-Za-z0-9_-]{1,64}$/);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("has every word it needs in English and in Greek", () => {
    for (const messages of [en, el]) {
      for (const group of MENU) {
        expect(lookup(messages, `menu.groups.${group.id}`), group.id).toEqual(expect.any(String));
        for (const column of group.columns) if (column.headingMessage !== undefined) expect(lookup(messages, `menu.links.${column.headingMessage}`)).toEqual(expect.any(String));
      }
      for (const link of links) {
        if ("kind" in link.label) expect(lookup(messages, `menu.kinds.${link.label.kind}`), link.label.kind).toEqual(expect.any(String));
        if ("message" in link.label) expect(lookup(messages, `menu.links.${link.label.message}`), link.label.message).toEqual(expect.any(String));
      }
    }
  });
});
