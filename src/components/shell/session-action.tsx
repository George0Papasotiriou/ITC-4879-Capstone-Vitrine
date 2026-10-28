"use client";

/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * The header's quick sign-in or sign-out icon, at the top right of every page.
 */

import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";

import { Tooltip } from "@/components/ui/tooltip";
import { Link, usePathname, useRouter } from "@/i18n/navigation";
import { authClient } from "@/lib/auth/client";
import { cn } from "@/lib/ui/cn";

/**
 * docs/adr/067. Signed out, a link to sign in that brings the shopper back to
 * the page they were on (the sign-in page cleans the return address with
 * safeNext, src/lib/auth/paths.ts). Signed in, a button that signs out at once
 * and loads the home page in full, as the account page's button does, so no
 * client cache keeps the account's data. Its own ids (nav:sign-in,
 * nav:sign-out), so it never doubles the account page's controls.
 */

const iconClass = cn(
  "text-dusk rounded-plinth press relative inline-flex h-11 w-10 items-center justify-center md:w-11",
  "duration-quick ease-standard hover:bg-dusk/[0.05] transition-colors",
);

/** Pages a return address should not point back to: the sign-in pages themselves. */
const AUTH_PAGES = /^\/account\/(sign-in|sign-up|two-factor|forgot-password|reset-password)(\/|$)/;

export function SessionAction({ signedIn }: { signedIn: boolean }) {
  return signedIn ? <SignOutIcon /> : <SignInIcon />;
}

function SignInIcon() {
  const t = useTranslations("nav");
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const signInHref = (search: string) => {
    if (AUTH_PAGES.test(pathname)) return "/account/sign-in";
    return `/account/sign-in?next=${encodeURIComponent(`/${locale}${pathname === "/" ? "" : pathname}${search}`)}`;
  };
  return (
    <Tooltip content={t("signInHint")}>
      <Link
        href={signInHref("")}
        data-agent-id="nav:sign-in"
        aria-label={t("signIn")}
        className={cn(iconClass, "no-underline")}
        onClick={(event) => {
          // The query string is read at the click, so a filtered listing or a search comes back whole.
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0 || window.location.search === "") return;
          event.preventDefault();
          router.push(signInHref(window.location.search));
        }}
      >
        <SignInGlyph />
      </Link>
    </Tooltip>
  );
}

function SignOutIcon() {
  const t = useTranslations("nav");
  const locale = useLocale();
  const [pending, setPending] = useState(false);
  return (
    <Tooltip content={t("signOutHint")}>
      <button
        type="button"
        data-agent-id="nav:sign-out"
        aria-label={pending ? t("signingOut") : t("signOut")}
        aria-disabled={pending}
        className={cn(iconClass, pending && "opacity-60")}
        onClick={async () => {
          if (pending) return;
          setPending(true);
          await authClient.signOut();
          // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- a full load after signing out, so no client cache keeps the account's data
          window.location.assign(`/${locale}`);
        }}
      >
        <SignOutGlyph />
      </button>
    </Tooltip>
  );
}

/** Keeps the header's width while the session is read, so nothing shifts when the icon arrives. */
export function SessionActionPlaceholder() {
  return <span aria-hidden="true" className="inline-block h-11 w-10 md:w-11" />;
}

/* A door with an arrow going in, and one coming out: 1.5px strokes like the header's other icons. */

function SignInGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="size-5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <path d="M14 4h3.5A1.5 1.5 0 0 1 19 5.5v13a1.5 1.5 0 0 1-1.5 1.5H14" strokeLinecap="round" />
      <path d="M4 12h10M10.5 8.5 14 12l-3.5 3.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SignOutGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="size-5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <path d="M10 4H6.5A1.5 1.5 0 0 0 5 5.5v13A1.5 1.5 0 0 0 6.5 20H10" strokeLinecap="round" />
      <path d="M10 12h10M16.5 8.5 20 12l-3.5 3.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
