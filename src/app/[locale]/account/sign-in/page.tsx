/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Sign-in page: email and password, passkey, and Google when configured.
 */

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { SignInForm } from "@/components/account/auth-forms";
import { AuthShell } from "@/components/account/auth-shell";
import { requireLocale } from "@/i18n/params";
import { safeNext } from "@/lib/auth/paths";
import { googleEnabled } from "@/lib/auth/server";
import { currentUser } from "@/lib/auth/session";

export async function generateMetadata({ params }: PageProps<"/[locale]/account/sign-in">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "auth" });
  return { title: t("signInTitle"), robots: { index: false, follow: false } };
}

export default async function SignInPage({ params, searchParams }: PageProps<"/[locale]/account/sign-in">) {
  const locale = await requireLocale(params);
  const requested = (await searchParams).next;
  const next = safeNext(typeof requested === "string" ? requested : null, locale);
  // Already signed in: go where the sign-in was meant to lead.
  if ((await currentUser()) !== null) redirect(next);

  const t = await getTranslations("auth");
  return (
    <AuthShell title={t("signInTitle")} lede={t("signInLede")}>
      <SignInForm locale={locale} next={next} googleEnabled={googleEnabled()} />
    </AuthShell>
  );
}
