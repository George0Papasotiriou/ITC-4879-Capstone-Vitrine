"use client";

/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * WebMCP: registers the shop's tools with the browser's own assistant, when the browser has one.
 */

import { useLocale } from "next-intl";
import { useEffect } from "react";

import { announceCart, type CartSummary } from "@/components/commerce/cart-client";
import { useRouter } from "@/i18n/navigation";
import { modelContext } from "@/lib/ai/surfaces/webmcp";

/**
 * docs/adr/043. Feature-detected and otherwise inert: nothing is fetched on a
 * browser without `document.modelContext`. Each tool runs through
 * /api/concierge/tools as this shopper, exactly as a voice tool call does; a
 * page to open is opened with the shop's router, and a cart change updates
 * the cart count at once. Leaving the page's language unregisters the tools.
 */

export const WEBMCP_READY_EVENT = "vitrine:webmcp";

type ToolDescription = { name: string; title?: string; description: string; inputSchema: object; annotations: { readOnlyHint: boolean; untrustedContentHint: boolean; consequentialHint: boolean } };

export function WebMcp() {
  const locale = useLocale();
  const router = useRouter();

  useEffect(() => {
    const context = modelContext();
    if (context === null) return;
    const registration = new AbortController();

    const run = async (name: string, input: Record<string, unknown>, signal: AbortSignal): Promise<unknown> => {
      const response = await fetch("/api/concierge/tools", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, input, locale, surface: "webmcp" }),
        signal,
      });
      const body = (await response.json().catch(() => null)) as { ok: boolean; output?: Record<string, unknown>; reason?: string } | null;
      if (body?.ok !== true || body.output === undefined) return { ok: false, reason: body?.reason ?? "failed" };
      const { commands, ...output } = body.output as { commands?: { type: string; href?: string }[] } & Record<string, unknown>;
      // Pages to open are opened here, in the shopper's own tab.
      const opened = (commands ?? []).filter((command) => command.type === "navigate" && typeof command.href === "string").map((command) => command.href!);
      for (const href of opened.slice(0, 1)) router.push(href);
      if (["add_to_cart", "update_cart_item", "remove_from_cart"].includes(name) && output.ok === true) {
        const cart = await fetch(`/api/cart?locale=${locale}`, { cache: "no-store" }).catch(() => null);
        if (cart?.ok === true) announceCart((await cart.json()) as CartSummary);
      }
      return opened.length > 0 ? { ...output, opened } : output;
    };

    void (async () => {
      const response = await fetch(`/api/concierge/tools?surface=webmcp&locale=${locale}`, { signal: registration.signal }).catch(() => null);
      if (response?.ok !== true) return;
      const { tools } = (await response.json()) as { tools: ToolDescription[] };
      let registered = 0;
      for (const tool of tools) {
        if (registration.signal.aborted) return;
        try {
          await context.registerTool(
            { name: tool.name, title: tool.title, description: tool.description, inputSchema: tool.inputSchema, annotations: tool.annotations, execute: (input, { signal }) => run(tool.name, input ?? {}, signal) },
            { signal: registration.signal },
          );
          registered += 1;
        } catch {
          // A browser that refuses one tool (a name it already has) keeps the others.
        }
      }
      window.dispatchEvent(new CustomEvent(WEBMCP_READY_EVENT, { detail: { registered } }));
      (window as unknown as { vitrineWebMcp?: { registered: number } }).vitrineWebMcp = { registered };
    })();

    return () => registration.abort();
  }, [locale, router]);

  return null;
}
