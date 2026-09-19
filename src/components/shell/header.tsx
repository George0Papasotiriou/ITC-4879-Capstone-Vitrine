/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Site header: wordmark, search, account and cart.
 */

import { getTranslations } from "next-intl/server";

import { CartCount } from "@/components/commerce/cart-count";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/ui/cn";
import { ConciergeToggle } from "@/components/concierge/concierge-toggle";

/**
 * The header (docs/PLAN.md 4.3)
 *
 * Wordmark, search, account, cart — and nothing else. A shop window has one
 * pane of glass, not a mega-menu: category navigation lives in the page, where
 * it can be shown as products rather than as a list of words.
 *
 * Every control the Concierge can point at carries a `data-agent-id`, which is
 * what makes `highlight` possible without the model knowing anything about the
 * DOM (2.5).
 */
export async function Header({ className }: { className?: string }) {
  const t = await getTranslations("nav");

  return (
    <header
      className={cn(
        "border-hairline bg-glass/90 sticky top-0 z-40 border-b backdrop-blur-sm",
        className,
      )}
    >
      <div className="mx-auto flex h-16 w-full max-w-[1440px] items-center gap-4 px-6 md:px-10">
        <Link
          href="/"
          data-agent-id="nav:home"
          className="font-display text-xl no-underline"
        >
          {t("wordmark")}
        </Link>

        <nav aria-label={t("menu")} className="ml-auto flex items-center gap-1">
          {/* On phones the Concierge opens from the bar at the bottom instead. */}
          <ConciergeToggle
            agentId="nav:concierge-panel"
            className="text-dusk rounded-plinth duration-quick ease-standard hover:bg-dusk/[0.05] relative hidden h-11 items-center gap-2 px-3 transition-colors md:inline-flex"
          >
            <span className="bg-lumen size-2.5 rounded-full" aria-hidden="true" />
            <span className="text-sm">{t("concierge")}</span>
          </ConciergeToggle>
          <HeaderAction
            href="/search"
            agentId="nav:search"
            label={t("openSearch")}
            short={t("search")}
          >
            <SearchGlyph />
          </HeaderAction>

          <HeaderAction
            href="/account"
            agentId="nav:account"
            label={t("openAccount")}
            short={t("account")}
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
        </nav>
      </div>
    </header>
  );
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
        "text-dusk relative inline-flex h-11 items-center gap-2 rounded-plinth px-3 no-underline",
        "transition-colors duration-quick ease-standard hover:bg-dusk/[0.05]",
      )}
    >
      {children}
      {/* The label is visible from tablet up and always available to screen
          readers, so the icons never have to be guessed at. */}
      {after === undefined ? null : <span className="sr-only">{label}</span>}
      <span className="hidden text-sm md:inline" aria-hidden={after === undefined ? undefined : true}>
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
