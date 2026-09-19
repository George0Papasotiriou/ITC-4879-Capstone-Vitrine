/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * The staff hub: every desk the signed-in person's roles allow, and nothing else.
 */

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { DeskLinks } from "@/components/staff/desk-links";
import { requireLocale } from "@/i18n/params";
import { isStaff } from "@/lib/auth/roles";
import { requireUser } from "@/lib/auth/session";

export async function generateMetadata({ params }: PageProps<"/[locale]/staff">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "admin.desks" });
  return { title: t("title"), robots: { index: false, follow: false } };
}

export default async function StaffHubPage({ params }: PageProps<"/[locale]/staff">) {
  const locale = await requireLocale(params);
  const user = await requireUser(locale, `/${locale}/staff`);
  // Customers get the same answer as for a page that does not exist.
  if (!isStaff(user.roles)) notFound();
  const t = await getTranslations("admin.desks");

  return (
    <main className="mx-auto w-full max-w-[1100px] px-6 py-10 md:px-10 md:py-16" data-agent-id="staff:hub">
      <h1 className="font-display text-3xl">{t("title")}</h1>
      <p className="text-slate mt-3 max-w-[70ch]">{t("lede")}</p>
      <DeskLinks roles={user.roles} className="mt-8" />
    </main>
  );
}
