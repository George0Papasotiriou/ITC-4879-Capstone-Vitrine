/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * The page map: what the shopper is looking at, sent with each message, checked and kept small.
 */

import { z } from "zod";

import { agentIdSchema } from "@/lib/ai/ui-commands";

/**
 * With each message the browser sends where the shopper is and what the
 * Concierge could point at (docs/PLAN.md 2.5): the route, the targets on
 * screen (`data-agent-id`), the active filters and how many items are in the
 * cart. It comes from the browser, so it is validated strictly and capped at
 * about 500 tokens; anything malformed is dropped rather than trusted.
 */

export const pageMapSchema = z.object({
  route: z.string().max(200).regex(/^\/[^\s]*$/),
  title: z.string().max(120).optional(),
  targets: z.array(agentIdSchema).max(40).default([]),
  filters: z.record(z.string().max(24), z.array(z.string().max(48)).max(12)).optional(),
  cartCount: z.number().int().min(0).max(999).optional(),
});

export type PageMap = z.infer<typeof pageMapSchema>;

/** A valid page map, or none. */
export function parsePageMap(input: unknown): PageMap | null {
  const parsed = pageMapSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}

/** The page map as the model reads it: one compact line per fact. */
export function describePageMap(map: PageMap | null): string {
  if (map === null) return "Page: unknown.";
  const lines = [`Page: ${map.route}${map.title === undefined ? "" : ` (${map.title.replace(/[<>]/g, "")})`}`];
  if (map.targets.length > 0) lines.push(`Targets on screen: ${map.targets.join(", ")}`);
  if (map.filters !== undefined && Object.keys(map.filters).length > 0) {
    lines.push(`Active filters: ${Object.entries(map.filters).map(([facet, values]) => `${facet}=${values.join("|")}`).join("; ")}`);
  }
  if (map.cartCount !== undefined) lines.push(`Items in cart: ${map.cartCount}`);
  return lines.join("\n");
}
