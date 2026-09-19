/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Reset password page: where the emailed link lands, with its one-time token.
 */

import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { FormMessage, ResetPasswordForm } from "@/components/account/auth-forms";
import { AuthShell } from "@/components/account/auth-shell";
import { ButtonLink } from "@/components/ui/button";
import { requireLocale } from "@/i18n/params";

/**
 * Better Auth checks the link's token and sends the person here with it
 * (`?token=`), or with `?error=INVALID_TOKEN` when it has expired or been used.
 * The token is only ever sent back to Better Auth with the new password.
 */

export async function generateMetadata({ params }: PageProps<"/[locale]/account/reset-password">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "auth" });
  // No referrer: the address carries a one-time token.
  return { title: t("resetTitle"), robots: { index: false, follow: false }, referrer: "no-referrer" };
}

export default async function ResetPasswordPage({ params, searchParams }: PageProps<"/[locale]/account/reset-password">) {
  await requireLocale(params);
  const query = await searchParams;
  const token = typeof query.token === "string" && query.error === undefined && query.token.length >= 8 ? query.token : null;
  const t = await getTranslations("auth");

  return (
    <AuthShell title={t("resetTitle")}>
      {token === null ? (
        <div className="flex flex-col gap-5">
          <FormMessage tone="error">{t("resetMissing")}</FormMessage>
          <div>
            <ButtonLink href="/account/forgot-password" variant="secondary">
              {t("askAgain")}
            </ButtonLink>
          </div>
        </div>
      ) : (
        <ResetPasswordForm token={token} />
      )}
    </AuthShell>
  );
}
