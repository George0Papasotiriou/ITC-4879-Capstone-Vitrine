/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * WebMCP: the tools the shop registers in the page for an assistant built into the shopper's own browser.
 */

/**
 * docs/adr/043. WebMCP (W3C Web Machine Learning Community Group draft,
 * 28 September 2026) lets a page register tools with `document.modelContext`
 * for the browser's own assistant. The assistant then acts in this page, as
 * this shopper, with their cookies: the same tools as the Concierge, run by
 * the same route, so no key is needed.
 *
 * Offered: the catalogue, the cart and opening pages. Not offered: anything
 * that asks the shopper first in the Concierge (checkout, returns, try-on,
 * the desk, remembering preferences), because a browser assistant's own
 * confirmation is not the shop's approval card.
 */

export const WEBMCP_TOOLS: readonly string[] = [
  "search_products",
  "get_products",
  "compare_products",
  "recommend",
  "build_bundle",
  "summarize_reviews",
  "compose_showcase",
  "navigate",
  "get_cart",
  "add_to_cart",
  "update_cart_item",
  "remove_from_cart",
];

/** Tools whose answers carry other people's words (reviews), marked so the assistant treats them as data. */
export const UNTRUSTED_CONTENT_TOOLS: readonly string[] = ["summarize_reviews", "get_products", "compare_products"];

/** The part of the WebMCP draft this shop uses, feature-detected; no polyfill. */
export type ModelContextLike = {
  registerTool(
    tool: {
      name: string;
      title?: string;
      description: string;
      inputSchema?: object;
      execute: (input: Record<string, unknown>, options: { signal: AbortSignal }) => Promise<unknown>;
      annotations?: { readOnlyHint?: boolean; untrustedContentHint?: boolean; consequentialHint?: boolean };
    },
    options?: { signal?: AbortSignal },
  ): Promise<void>;
};

/**
 * The page's model context when the browser has one. The draft puts it on
 * `document`; early previews put it on `navigator`, so both are looked at.
 */
export function modelContext(): ModelContextLike | null {
  if (typeof document === "undefined") return null;
  const candidates = [(document as unknown as { modelContext?: unknown }).modelContext, (navigator as unknown as { modelContext?: unknown }).modelContext];
  for (const candidate of candidates) {
    if (typeof candidate === "object" && candidate !== null && typeof (candidate as ModelContextLike).registerTool === "function") return candidate as ModelContextLike;
  }
  return null;
}
