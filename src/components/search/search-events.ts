/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Opening the instant search from anywhere: the header, a shortcut or the Concierge.
 */

/** Dispatched on `window`; the layer listens and loads the pop-up the first time. */
export const SEARCH_OPEN_EVENT = "vitrine:open-search";

export type SearchOpenDetail = { query?: string };

export function openInstantSearch(detail: SearchOpenDetail = {}): void {
  window.dispatchEvent(new CustomEvent<SearchOpenDetail>(SEARCH_OPEN_EVENT, { detail }));
}

/**
 * Recent searches, kept on this device only (never sent anywhere): the five
 * latest, newest first, without repeats. Storage can be missing or refuse
 * (private windows, blocked site data), so every access is guarded and the
 * pop-up simply shows no recent searches then.
 */
const RECENT_KEY = "vt_recent_searches";
export const RECENT_LIMIT = 5;

export function readRecent(): string[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === "string").slice(0, RECENT_LIMIT) : [];
  } catch {
    return [];
  }
}

/** The list after remembering `query`: pure, so it is tested without a browser. */
export function withRecent(list: readonly string[], query: string): string[] {
  const trimmed = query.trim().replace(/\s+/g, " ");
  if (trimmed === "") return [...list];
  const key = trimmed.toLocaleLowerCase();
  return [trimmed, ...list.filter((entry) => entry.toLocaleLowerCase() !== key)].slice(0, RECENT_LIMIT);
}

export function rememberSearch(query: string): void {
  try {
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(withRecent(readRecent(), query)));
  } catch {
    // Nothing kept; the search itself still works.
  }
}

export function forgetRecent(): void {
  try {
    window.localStorage.removeItem(RECENT_KEY);
  } catch {
    // Nothing to forget.
  }
}
