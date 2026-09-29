/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Showcase mode's themes: each one a Budget Stylist request, so a window display is a real, affordable set.
 */

import { z } from "zod";

import { TEMPLATE_IDS, type TemplateId } from "@/lib/optimize/templates";

/**
 * docs/adr/040. A window display is not decoration picked by hand: it is the
 * Budget Stylist's best set (A3) for a room, a budget and a few words. So every
 * display can be bought as shown, for the total it shows, and the pieces go
 * together by the Stylist's colour harmony. A theme is that request, named.
 *
 * Themes are curated here (a title in each language) or made on the spot —
 * by the Concierge or a shared link — from a template, a budget and words,
 * which are checked as strictly as the Stylist checks its own requests.
 */

export type DisplayRequest = {
  template: TemplateId;
  budgetCents: number;
  query?: string;
};

export type Theme = DisplayRequest & { id: string; title: { en: string; el: string }; line: { en: string; el: string } };

export const THEMES: readonly Theme[] = [
  {
    id: "reading-corner",
    template: "reading-corner",
    budgetCents: 60_000,
    query: "wood",
    title: { en: "A reading corner in warm wood", el: "Γωνιά ανάγνωσης σε ζεστό ξύλο" },
    line: { en: "A chair, a light to read by and a table for the cup, under €600.", el: "Μια πολυθρόνα, φως για διάβασμα κι ένα τραπεζάκι για το φλιτζάνι, κάτω από 600 €." },
  },
  {
    id: "calm-living",
    template: "living-room",
    budgetCents: 250_000,
    query: "grey",
    title: { en: "A calm living room in grey", el: "Ήρεμο σαλόνι σε γκρι" },
    line: { en: "Soft greys, low light and room to sit together, under €2,500.", el: "Απαλά γκρι, χαμηλό φως και χώρος να καθίσετε μαζί, κάτω από 2.500 €." },
  },
  {
    id: "oak-bedroom",
    template: "bedroom",
    budgetCents: 180_000,
    query: "oak",
    title: { en: "A bedroom in oak", el: "Υπνοδωμάτιο σε δρυ" },
    line: { en: "A bed, lamps either side and a rug underfoot, under €1,800.", el: "Ένα κρεβάτι, φωτιστικά δεξιά κι αριστερά κι ένα χαλί, κάτω από 1.800 €." },
  },
  {
    id: "black-dining",
    template: "dining",
    budgetCents: 200_000,
    query: "black",
    title: { en: "Dining in black", el: "Τραπεζαρία σε μαύρο" },
    line: { en: "A table for four and the chairs to go with it, under €2,000.", el: "Ένα τραπέζι για τέσσερις και οι καρέκλες του, κάτω από 2.000 €." },
  },
  {
    id: "leather-living",
    template: "living-room",
    budgetCents: 350_000,
    query: "leather",
    title: { en: "Leather and lamplight", el: "Δέρμα και φως λάμπας" },
    line: { en: "A leather sofa at the heart of it, under €3,500.", el: "Ένας δερμάτινος καναπές στο κέντρο, κάτω από 3.500 €." },
  },
  {
    id: "small-gifts",
    template: "gift-set",
    budgetCents: 15_000,
    title: { en: "Small gifts for a home", el: "Μικρά δώρα για ένα σπίτι" },
    line: { en: "Something for a shelf, a wall and a sofa, under €150.", el: "Κάτι για ένα ράφι, έναν τοίχο κι έναν καναπέ, κάτω από 150 €." },
  },
];

export const DEFAULT_THEME = THEMES[0]!;

/** A display made on the spot: the same limits as the Stylist's own requests. */
export const customDisplaySchema = z.object({
  template: z.enum(TEMPLATE_IDS as [TemplateId, ...TemplateId[]]),
  budgetCents: z.number().int().min(1_000).max(5_000_000),
  query: z.string().trim().min(1).max(60).optional(),
});

/**
 * The display a link asks for: `?theme=<id>`, or `?template=&budget=<euros>&words=`.
 * Anything unreadable falls back to the first theme, never to an error page.
 */
export function displayFromParams(params: Record<string, string | string[] | undefined>): { theme: Theme | null; request: DisplayRequest } {
  const one = (name: string) => (typeof params[name] === "string" ? (params[name] as string) : undefined);
  const named = THEMES.find((theme) => theme.id === one("theme"));
  if (named !== undefined) return { theme: named, request: named };
  const budget = Number(one("budget"));
  const custom = customDisplaySchema.safeParse({
    template: one("template"),
    budgetCents: Number.isFinite(budget) ? Math.round(budget * 100) : undefined,
    query: one("words") === "" ? undefined : one("words"),
  });
  if (custom.success) return { theme: null, request: custom.data };
  return { theme: DEFAULT_THEME, request: DEFAULT_THEME };
}

/** The link to a display, as the Concierge and the share button write it. */
export function displayHref(request: DisplayRequest, themeId?: string): string {
  if (themeId !== undefined) return `/showcase?${new URLSearchParams({ theme: themeId }).toString()}`;
  const params = new URLSearchParams({ template: request.template, budget: String(request.budgetCents / 100) });
  if (request.query !== undefined) params.set("words", request.query);
  return `/showcase?${params.toString()}`;
}
