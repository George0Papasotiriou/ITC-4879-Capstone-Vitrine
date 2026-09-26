"use client";

/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * The comfort settings in the browser: read from the cookie, changed in one place, applied to the page at once.
 */

import { useSyncExternalStore } from "react";

import { COMFORT_COOKIE, comfortAttributes, DEFAULT_COMFORT, parseComfort, patchComfort, serializeComfort, type Comfort } from "@/lib/comfort/settings";

/**
 * docs/adr/032. The cookie is the store: the head script reads it before the
 * first paint, and every change is written back to it, applied to <html> and
 * announced with an event, so every component showing a setting agrees.
 */

export const COMFORT_EVENT = "vitrine:comfort";
/** Asks the comfort panel to open, from anywhere (the footer link, a shortcut, the Concierge). */
export const COMFORT_OPEN_EVENT = "vitrine:comfort-open";

const ONE_YEAR = 60 * 60 * 24 * 365;

function readCookie(): string | null {
  const match = document.cookie.match(new RegExp(`(?:^|; )${COMFORT_COOKIE}=([^;]*)`));
  return match?.[1] ?? null;
}

// The last value read, kept while the cookie is unchanged: useSyncExternalStore
// needs the same object back for the same state.
let cache: { raw: string | null; value: Comfort } = { raw: null, value: DEFAULT_COMFORT };

export function currentComfort(): Comfort {
  if (typeof document === "undefined") return DEFAULT_COMFORT;
  const raw = readCookie();
  if (raw !== cache.raw) cache = { raw, value: parseComfort(raw) };
  return cache.value;
}

/** Writes the attributes the stylesheet answers. */
export function applyComfort(comfort: Comfort): void {
  const root = document.documentElement;
  for (const [name, value] of Object.entries(comfortAttributes(comfort))) {
    if (value === null) root.removeAttribute(name);
    else root.setAttribute(name, value);
  }
}

/** Changes some settings, keeps them for a year on this device, and applies them now. */
export function setComfort(patch: Partial<Record<string, unknown>>): Comfort {
  const next = patchComfort(currentComfort(), patch);
  const value = serializeComfort(next);
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = value === "" ? `${COMFORT_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax${secure}` : `${COMFORT_COOKIE}=${value}; Path=/; Max-Age=${ONE_YEAR}; SameSite=Lax${secure}`;
  applyComfort(next);
  window.dispatchEvent(new CustomEvent<Comfort>(COMFORT_EVENT, { detail: next }));
  // Signed in, the account keeps them too, so they follow the shopper to other devices (docs/adr/033).
  void syncComfort({ changed: true });
  return next;
}

/**
 * Brings this device and the account into step: after signing in, once per
 * browser session, and after every change. For a guest the server does
 * nothing. When the account has settings this device lacks, they arrive in
 * the answer and are applied at once.
 */
export async function syncComfort({ changed = false }: { changed?: boolean } = {}): Promise<void> {
  const response = await fetch("/api/preferences/sync", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ comfort: readCookie() ?? "", changed }),
  }).catch(() => null);
  const result = (await response?.json().catch(() => null)) as { comfort?: string | null } | null;
  if (typeof result?.comfort === "string" && result.comfort !== "") {
    const next = parseComfort(result.comfort);
    applyComfort(next);
    window.dispatchEvent(new CustomEvent<Comfort>(COMFORT_EVENT, { detail: next }));
  }
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(COMFORT_EVENT, onChange);
  return () => window.removeEventListener(COMFORT_EVENT, onChange);
}

/** The settings in force; the defaults on the server and in the first render. */
export function useComfort(): Comfort {
  return useSyncExternalStore(subscribe, currentComfort, () => DEFAULT_COMFORT);
}

/** The session key that says this browser session has already met the account. */
export const SYNCED_KEY = "vt_synced";

/**
 * Asks the next page to bring the device and the account into step. Used when
 * signing in or up: the navigation that follows must not wait for it, and the
 * next page's comfort layer does it once it loads (docs/adr/033).
 */
export function syncOnNextPage(): void {
  try {
    window.sessionStorage.removeItem(SYNCED_KEY);
  } catch {
    // Without session storage the device and the account meet at the next change instead.
  }
}

export function openComfortPanel(): void {
  window.dispatchEvent(new Event(COMFORT_OPEN_EVENT));
}
