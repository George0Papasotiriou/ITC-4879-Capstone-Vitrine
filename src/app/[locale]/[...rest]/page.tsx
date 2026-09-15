/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Catch-all route that shows a localised 404 page for unmatched paths inside a locale.
 */

import { notFound } from "next/navigation";

import { requireLocale } from "@/i18n/params";

/**
 * Catch-all for paths that match no route inside a locale.
 *
 * Without it, `/el/does-not-exist` never enters the `[locale]` layout: Next
 * renders its built-in 404 in English, with no `lang` attribute, no header and
 * no way back. Routing every unmatched path through here keeps a missing page
 * inside the storefront the visitor was using — Greek chrome, Greek message,
 * and a link home.
 */
export default async function CatchAll({
  params,
}: PageProps<"/[locale]/[...rest]">) {
  await requireLocale(params);
  notFound();
}
