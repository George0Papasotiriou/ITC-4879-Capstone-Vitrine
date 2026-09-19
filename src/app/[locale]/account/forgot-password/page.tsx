/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Forgotten password page: asks for the address and sends a reset link if it has an account.
 */

import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { ForgotPasswordForm } from "@/components/account/auth-forms";
import { AuthShell } from "@/components/account/auth-shell";
import { requireLocale } from "@/i18n/params";

export async function generateMetadata({ params }: PageProps<"/[locale]/account/forgot-password">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "auth" });
  return { title: t("forgotTitle"), robots: { index: false, follow: false } };
}

export default async function ForgotPasswordPage({ params }: PageProps<"/[locale]/account/forgot-password">) {
  const locale = await requireLocale(params);
  const t = await getTranslations("auth");
  return (
    <AuthShell title={t("forgotTitle")} lede={t("forgotLede")}>
      <ForgotPasswordForm locale={locale} />
    </AuthShell>
  );
}
