/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Mobile bottom navigation bar.
 */

import { getTranslations } from "next-intl/server";

import { CartCount } from "@/components/commerce/cart-count";
import { ConciergeToggle } from "@/components/concierge/concierge-toggle";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/ui/cn";

/**
 * Mobile bottom bar (docs/PLAN.md 4.3).
 *
 * Thumb-reachable navigation, with the Concierge in the middle where the most
 * important control belongs on a phone. It is the only item marked in Lumen,
 * because Lumen means "the AI is here" and nothing else (4.2).
 *
 * Hidden from tablet up, where the header already carries these.
 */
export async function MobileBar() {
  const t = await getTranslations("nav");

  return (
    <nav
      aria-label={t("menu")}
      className={cn(
        "border-hairline bg-glass/95 fixed inset-x-0 bottom-0 z-40 border-t backdrop-blur-sm md:hidden",
        // Keep clear of the iOS home indicator.
        "pb-[env(safe-area-inset-bottom)]",
      )}
    >
      <ul className="mx-auto flex max-w-md items-stretch justify-around">
        <BarItem href="/" agentId="nav:home" label={t("home")}>
          <HomeGlyph />
        </BarItem>
        <BarItem href="/search" agentId="nav:search" label={t("search")}>
          <SearchGlyph />
        </BarItem>
        <li className="flex-1">
          {/* Opens the Concierge as a sheet over the page; the conversation survives navigation. */}
          <ConciergeToggle className="text-dusk relative flex h-14 w-full flex-col items-center justify-center gap-1">
            <span className="bg-lumen block size-3 rounded-full" aria-hidden="true" />
            <span className="text-[0.6875rem] leading-none">{t("concierge")}</span>
          </ConciergeToggle>
        </li>
        <BarItem href="/cart" agentId="nav:cart" label={t("cart")} after={<CartCount variant="bar" />}>
          <CartGlyph />
        </BarItem>
        <BarItem href="/account" agentId="nav:account" label={t("account")}>
          <AccountGlyph />
        </BarItem>
      </ul>
    </nav>
  );
}

function BarItem({
  href,
  agentId,
  label,
  children,
  after,
  accent = false,
}: {
  href: string;
  agentId: string;
  label: string;
  children: React.ReactNode;
  after?: React.ReactNode;
  accent?: boolean;
}) {
  return (
    <li className="flex-1">
      <Link
        href={href}
        data-agent-id={agentId}
        className={cn(
          // 56px tall: comfortably past the 44px touch target minimum.
          "relative flex h-14 flex-col items-center justify-center gap-1 no-underline",
          accent ? "text-dusk" : "text-slate",
        )}
      >
        {children}
        <span className="text-[0.6875rem] leading-none">{label}</span>
        {after}
      </Link>
    </li>
  );
}

function HomeGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z" strokeLinejoin="round" />
    </svg>
  );
}

function SearchGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <circle cx="11" cy="11" r="6.5" />
      <path d="M16 16l4.5 4.5" strokeLinecap="round" />
    </svg>
  );
}

function CartGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <path d="M3 4h2l2.4 11.2a1 1 0 0 0 1 .8h8.2a1 1 0 0 0 1-.8L19 7H6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="9.5" cy="19.5" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="16.5" cy="19.5" r="1.2" fill="currentColor" stroke="none" />
    </svg>
  );
}

function AccountGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <circle cx="12" cy="8.5" r="3.75" />
      <path d="M4.5 20a7.5 7.5 0 0 1 15 0" strokeLinecap="round" />
    </svg>
  );
}
