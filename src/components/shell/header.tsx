/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Site header: wordmark, the categories menu, search, account, cart and a quick sign-in or sign-out.
 */

import { getLocale, getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { CartCount } from "@/components/commerce/cart-count";
import { AccountDrops } from "@/components/commerce/account-drops";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/ui/cn";
import { ComfortButton } from "@/components/comfort/comfort-button";
import { ConciergeToggle } from "@/components/concierge/concierge-toggle";
import { InstantSearchTrigger } from "@/components/search/instant-search-layer";
import { CategoriesMenu } from "@/components/shell/categories-menu";
import { SessionAction, SessionActionPlaceholder } from "@/components/shell/session-action";
import { shellUser } from "@/lib/auth/session";
import { MENU, type MenuLabel, type MenuLink, type ResolvedGroup, type ResolvedLink } from "@/lib/catalog/menu";
import { CATEGORIES, type CategorySlug } from "@/lib/catalog/taxonomy";

/**
 * The header (docs/PLAN.md 4.3, docs/adr/067)
 *
 * Wordmark and the categories menu on the left; the Concierge, comfort,
 * search, account, cart and a quick sign-in or sign-out on the right. The
 * first design kept categories out of the header (one pane of glass); George
 * asked for the menu large shops have, so every department, kind and brand is
 * one hover or tap from any page (ADR-067). The menu is fixed data
 * (src/lib/catalog/menu.ts), so the header still makes no catalogue query.
 *
 * Every control the Concierge can point at carries a `data-agent-id`, which is
 * what makes `highlight` possible without the model knowing anything about the
 * DOM (2.5).
 */
export async function Header({ className }: { className?: string }) {
  const t = await getTranslations("nav");
  const groups = await menuGroups();

  return (
    <header
      className={cn(
        "border-hairline bg-glass/90 sticky top-0 z-40 border-b backdrop-blur-sm",
        className,
      )}
    >
      <div className="mx-auto flex h-16 w-full max-w-[1440px] items-center gap-2 px-4 sm:px-6 md:gap-4 md:px-10">
        <Link
          href="/"
          data-agent-id="nav:home"
          className="font-display text-xl no-underline"
        >
          {t("wordmark")}
        </Link>
        <CategoriesMenu groups={groups} />

        <nav aria-label={t("menu")} className="ml-auto flex items-center md:gap-1">
          {/* On phones the Concierge opens from the bar at the bottom instead. */}
          <ConciergeToggle
            agentId="nav:concierge-panel"
            className="text-dusk rounded-plinth duration-quick ease-standard hover:bg-dusk/[0.05] relative hidden h-11 items-center gap-2 px-3 transition-colors md:inline-flex"
          >
            <span className="bg-lumen size-2.5 rounded-full" aria-hidden="true" />
            {/* From laptop width up; a tablet's row has room for the dot only. The toggle's own label names it either way. */}
            <span className="hidden text-sm lg:inline">{t("concierge")}</span>
          </ConciergeToggle>
          {/* Text size, contrast, motion and the rest: on every page, found before it is needed (docs/adr/032). */}
          <ComfortButton />
          {/* A link to /search that opens the instant search pop-up when JavaScript is there (docs/adr/034). */}
          <InstantSearchTrigger>
            <HeaderAction
              href="/search"
              agentId="nav:search"
              label={t("openSearch")}
              short={t("search")}
            >
              <SearchGlyph />
            </HeaderAction>
          </InstantSearchTrigger>

          <HeaderAction
            href="/account"
            agentId="nav:account"
            label={t("openAccount")}
            short={t("account")}
            after={
              <Suspense fallback={null}>
                <AccountDrops variant="header" />
              </Suspense>
            }
          >
            <AccountGlyph />
          </HeaderAction>

          <HeaderAction
            href="/cart"
            agentId="nav:cart"
            label={t("openCart")}
            short={t("cart")}
            after={<CartCount variant="header" />}
          >
            <CartGlyph />
          </HeaderAction>

          {/* Signed in or out is read per request; the placeholder keeps the row from shifting while it is. */}
          <Suspense fallback={<SessionActionPlaceholder />}>
            <HeaderSession />
          </Suspense>
        </nav>
      </div>
    </header>
  );
}

async function HeaderSession() {
  return <SessionAction signedIn={(await shellUser()) !== null} />;
}

/** The menu in the shopper's language: category names from the taxonomy, kinds and pages from messages, brands as they are. */
async function menuGroups(): Promise<ResolvedGroup[]> {
  const t = await getTranslations("menu");
  const locale = await getLocale();
  const categoryName = (slug: CategorySlug) => {
    const entry = CATEGORIES.find((category) => category.slug === slug);
    return entry === undefined ? slug : locale === "el" ? entry.nameEl : entry.nameEn;
  };
  const label = (value: MenuLabel): string =>
    "category" in value ? categoryName(value.category) : "kind" in value ? t(`kinds.${value.kind}`) : "brand" in value ? value.brand : t(`links.${value.message}`);
  const resolve = (link: MenuLink): ResolvedLink => ({ id: link.id, href: link.href, label: label(link.label) });
  return MENU.map((group) => ({
    id: group.id,
    title: t(`groups.${group.id}`),
    all: resolve(group.all),
    columns: group.columns.map((column) => ({
      heading: column.heading === null ? null : resolve(column.heading),
      headingLabel: column.headingMessage === undefined ? null : t(`links.${column.headingMessage}`),
      links: column.links.map(resolve),
    })),
  }));
}

function HeaderAction({
  href,
  agentId,
  label,
  short,
  after,
  children,
}: {
  href: string;
  agentId: string;
  label: string;
  short: string;
  /** Extra content read after the label, such as the cart count; the name then comes from the content. */
  after?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-label={after === undefined ? label : undefined}
      data-agent-id={agentId}
      className={cn(
        "text-dusk relative inline-flex h-11 items-center gap-2 rounded-plinth px-2.5 no-underline md:px-3",
        "transition-colors duration-quick ease-standard hover:bg-dusk/[0.05]",
      )}
    >
      {children}
      {/* The label is visible from laptop width up (a tablet's row also holds the
          categories menu, docs/adr/067) and always available to screen readers,
          so the icons never have to be guessed at. */}
      {after === undefined ? null : <span className="sr-only">{label}</span>}
      <span className="hidden text-sm lg:inline" aria-hidden={after === undefined ? undefined : true}>
        {short}
      </span>
      {after}
    </Link>
  );
}

/* Icons are inline SVG, never emoji (4.8). 1.5px strokes to match the hairline. */

function SearchGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="size-5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <circle cx="11" cy="11" r="6.5" />
      <path d="M16 16l4.5 4.5" strokeLinecap="round" />
    </svg>
  );
}

function AccountGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="size-5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <circle cx="12" cy="8.5" r="3.75" />
      <path d="M4.5 20a7.5 7.5 0 0 1 15 0" strokeLinecap="round" />
    </svg>
  );
}

function CartGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="size-5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <path d="M3 4h2l2.4 11.2a1 1 0 0 0 1 .8h8.2a1 1 0 0 0 1-.8L19 7H6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="9.5" cy="19.5" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="16.5" cy="19.5" r="1.2" fill="currentColor" stroke="none" />
    </svg>
  );
}
