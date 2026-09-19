/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Sign-up page: name, email and password, then a confirmation link by email.
 */

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { SignUpForm } from "@/components/account/auth-forms";
import { AuthShell } from "@/components/account/auth-shell";
import { requireLocale } from "@/i18n/params";
import { currentUser } from "@/lib/auth/session";
import { outboxIsOpen } from "@/lib/email/server";

export async function generateMetadata({ params }: PageProps<"/[locale]/account/sign-up">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "auth" });
  return { title: t("signUpTitle"), robots: { index: false, follow: false } };
}

export default async function SignUpPage({ params }: PageProps<"/[locale]/account/sign-up">) {
  const locale = await requireLocale(params);
  if ((await currentUser()) !== null) redirect(`/${locale}/account`);

  const t = await getTranslations("auth");
  return (
    <AuthShell title={t("signUpTitle")} lede={t("signUpLede")}>
      <SignUpForm locale={locale} outboxOpen={outboxIsOpen()} />
    </AuthShell>
  );
}
