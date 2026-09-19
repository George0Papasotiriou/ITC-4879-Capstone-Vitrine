/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Two-step sign-in page: the authenticator code (or a backup code) after the password.
 */

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { TwoFactorForm } from "@/components/account/auth-forms";
import { AuthShell } from "@/components/account/auth-shell";
import { requireLocale } from "@/i18n/params";
import { safeNext } from "@/lib/auth/paths";
import { currentUser } from "@/lib/auth/session";

/**
 * Reached right after a correct password on an account with two-step sign-in.
 * Better Auth holds the half-finished sign-in in a short-lived cookie of its
 * own; there is no session until the code is right.
 */

export async function generateMetadata({ params }: PageProps<"/[locale]/account/two-factor">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "auth" });
  return { title: t("twoFactorTitle"), robots: { index: false, follow: false } };
}

export default async function TwoFactorPage({ params, searchParams }: PageProps<"/[locale]/account/two-factor">) {
  const locale = await requireLocale(params);
  const requested = (await searchParams).next;
  const next = safeNext(typeof requested === "string" ? requested : null, locale);
  if ((await currentUser()) !== null) redirect(next);

  const t = await getTranslations("auth");
  return (
    <AuthShell title={t("twoFactorTitle")}>
      <TwoFactorForm next={next} />
    </AuthShell>
  );
}
