/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Root localised layout: fonts, metadata, message provider, header, footer and mobile bar.
 */

import type { Metadata, Viewport } from "next";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Commissioner } from "next/font/google";
import { notFound } from "next/navigation";

import "../globals.css";

import { ConciergeDock } from "@/components/concierge/concierge-dock";
import { ConciergeProvider } from "@/components/concierge/concierge-provider";
import { Footer } from "@/components/shell/footer";
import { Header } from "@/components/shell/header";
import { MobileBar } from "@/components/shell/mobile-bar";
import { ServiceWorker } from "@/components/shell/service-worker";
import { Toaster } from "@/components/ui/toast";
import { publicOrigin } from "@/env";
import { routing } from "@/i18n/routing";

/**
 * Commissioner — a variable humanist sans with full Greek support, by Kostas
 * Bartsokas. One family carries both roles in the design system: the FLAR
 * (flare) axis gives display type its flared terminals, while text and UI stay
 * flat. See docs/PLAN.md 4.2.
 *
 * The Greek subset is loaded because Greek is a first-class locale here, not a
 * translation bolted on; a missing subset would fall back to a system font and
 * the Greek storefront would silently look like a different product.
 */
const commissioner = Commissioner({
  variable: "--font-commissioner",
  subsets: ["latin", "latin-ext", "greek"],
  axes: ["FLAR"],
  display: "swap",
});

/** Both locales are prerendered rather than resolved per request. */
export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: LayoutProps<"/[locale]">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "meta" });

  return {
    // Canonical and hreflang links must be absolute. Each page declares its own
    // alternates; a layout-wide default would point every page at the home page.
    metadataBase: publicOrigin(),
    title: { default: t("title"), template: t("titleTemplate", { page: "%s" }) },
    description: t("description"),
    manifest: "/manifest.webmanifest",
    appleWebApp: {
      capable: true,
      title: t("title"),
      statusBarStyle: "default",
    },
    icons: {
      icon: [{ url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
      apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
    },
  };
}

export const viewport: Viewport = {
  themeColor: "#f2f3f1",
};

export default async function LocaleLayout({
  children,
  params,
}: LayoutProps<"/[locale]">) {
  const { locale } = await params;

  // An unknown locale is a 404, not a silent fallback: /fr/cart should not
  // quietly serve English at a URL that claims to be French.
  if (!hasLocale(routing.locales, locale)) notFound();

  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "nav" });

  return (
    <html lang={locale} className={`${commissioner.variable} h-full`}>
      <body className="flex min-h-full flex-col">
        <NextIntlClientProvider>
          <Toaster>
          {/* The Concierge lives here so its conversation survives navigation between pages. */}
          <ConciergeProvider>
          {/* The first thing in the tab order, visible only once focused. */}
          <a
            href="#main"
            className="bg-dusk text-glass sr-only rounded-plinth focus-visible:not-sr-only focus-visible:absolute focus-visible:left-4 focus-visible:top-4 focus-visible:z-50 focus-visible:px-4 focus-visible:py-2"
          >
            {t("skipToContent")}
          </a>

          <Header />

          {/* Padding at the bottom clears the mobile bar. */}
          <div id="main" className="flex flex-1 flex-col pb-16 md:pb-0">
            {children}
          </div>

          <Footer />
          <MobileBar />
          <ConciergeDock />
          <ServiceWorker />
          </ConciergeProvider>
          </Toaster>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
