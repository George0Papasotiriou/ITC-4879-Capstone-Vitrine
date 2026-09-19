"use client";

/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Collects the page map sent with each Concierge message: the route, what is on screen to point at, and active filters.
 */

import type { PageMap } from "@/lib/ai/guardrails/page-map";

const AGENT_ID = /^[a-z]{1,24}:[A-Za-z0-9_-]{1,64}$/;
const FILTER_KEYS = ["color", "material", "brand", "min", "max", "stock", "sort", "q"];

/**
 * Only targets currently in view are listed (at most 40), nearest the top
 * first, so the map stays around 500 tokens and names things the shopper can
 * actually see. The server validates it again (src/lib/ai/guardrails/page-map.ts).
 */
export function collectPageMap(locale: string): PageMap {
  const url = new URL(window.location.href);
  const route = url.pathname.replace(new RegExp(`^/${locale}(?=/|$)`), "") || "/";
  const seen = new Set<string>();
  const targets: { id: string; top: number }[] = [];
  for (const element of document.querySelectorAll<HTMLElement>("[data-agent-id]")) {
    const id = element.dataset.agentId ?? "";
    if (!AGENT_ID.test(id) || seen.has(id) || element.closest("[data-concierge-dock]") !== null) continue;
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 || rect.bottom < 0 || rect.top > window.innerHeight) continue;
    seen.add(id);
    targets.push({ id, top: rect.top });
  }
  const filters: Record<string, string[]> = {};
  for (const key of FILTER_KEYS) {
    const values = url.searchParams.getAll(key).slice(0, 12).map((value) => value.slice(0, 48));
    if (values.length > 0) filters[key] = values;
  }
  return {
    route: `${route}`.slice(0, 200),
    title: document.title.slice(0, 120),
    targets: targets
      .sort((a, b) => a.top - b.top)
      .slice(0, 40)
      .map((target) => target.id),
    filters,
  };
}
