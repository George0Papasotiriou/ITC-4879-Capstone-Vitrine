"use client";

/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Counts, anonymously, the recommendation shelves seen, the pieces opened from them and then added to the cart.
 */

import { usePathname } from "next/navigation";
import { useEffect } from "react";

import { ADDED_EVENT } from "@/components/commerce/cart-client";

/**
 * docs/adr/034. Any section marked `data-shelf` is a shelf. It is counted as
 * seen once per visit to the page when a quarter of it is on screen; a piece
 * on it is counted as opened when its link is followed; and if that piece is
 * then put in the cart within half an hour, the shelf gets the credit. Nothing
 * here says who: no id, no cookie — the batch carries the shelf, what
 * happened and the piece, and is sent when the page is hidden or every few
 * seconds, whichever comes first.
 */

type Event = { shelf: string; kind: "impression" | "click" | "add_to_cart"; productId: string | null };

const CLICKS_KEY = "vt_shelf_clicks";
const CREDIT_MS = 30 * 60 * 1000;
const FLUSH_MS = 5_000;

const pending: Event[] = [];
let timer: number | undefined;

function flush(): void {
  if (timer !== undefined) window.clearTimeout(timer);
  timer = undefined;
  if (pending.length === 0) return;
  const body = JSON.stringify({ events: pending.splice(0, pending.length) });
  // A beacon survives the page going away; a fetch is the fallback where beacons are off.
  if (!(typeof navigator.sendBeacon === "function" && navigator.sendBeacon("/api/reco-events", new Blob([body], { type: "application/json" })))) {
    void fetch("/api/reco-events", { method: "POST", headers: { "content-type": "application/json" }, body, keepalive: true }).catch(() => undefined);
  }
}

function queue(event: Event): void {
  pending.push(event);
  if (pending.length >= 25) flush();
  else timer ??= window.setTimeout(flush, FLUSH_MS);
}

/** Opened pieces waiting for an add to cart: product id → shelf and when. Per tab, and never sent anywhere. */
function readClicks(): Record<string, { shelf: string; at: number }> {
  try {
    const parsed: unknown = JSON.parse(window.sessionStorage.getItem(CLICKS_KEY) ?? "{}");
    return parsed !== null && typeof parsed === "object" ? (parsed as Record<string, { shelf: string; at: number }>) : {};
  } catch {
    return {};
  }
}

function writeClicks(clicks: Record<string, { shelf: string; at: number }>): void {
  try {
    const recent = Object.entries(clicks)
      .filter(([, click]) => Date.now() - click.at < CREDIT_MS)
      .slice(-20);
    window.sessionStorage.setItem(CLICKS_KEY, JSON.stringify(Object.fromEntries(recent)));
  } catch {
    // Without storage an add simply is not credited to a shelf.
  }
}

const productOf = (element: Element | null) => {
  const id = element?.closest("[data-agent-id^='product:']")?.getAttribute("data-agent-id")?.slice("product:".length) ?? null;
  return id !== null && /^[0-9a-f-]{36}$/.test(id) ? id : null;
};

export function ShelfTracker() {
  const pathname = usePathname();

  // Shelves seen, counted afresh on every page.
  useEffect(() => {
    const seen = new WeakSet<Element>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting || seen.has(entry.target)) continue;
          seen.add(entry.target);
          observer.unobserve(entry.target);
          const shelf = (entry.target as HTMLElement).dataset.shelf;
          if (shelf !== undefined) queue({ shelf, kind: "impression", productId: null });
        }
      },
      { threshold: 0.25 },
    );
    const watch = () => document.querySelectorAll("[data-shelf]").forEach((element) => !seen.has(element) && observer.observe(element));
    watch();
    // Shelves that stream in after the first paint.
    const mutations = new MutationObserver(watch);
    mutations.observe(document.body, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      mutations.disconnect();
    };
  }, [pathname]);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
      const shelf = link?.closest<HTMLElement>("[data-shelf]")?.dataset.shelf;
      if (link === null || link === undefined || shelf === undefined) return;
      const productId = productOf(link);
      queue({ shelf, kind: "click", productId });
      if (productId !== null) writeClicks({ ...readClicks(), [productId]: { shelf, at: Date.now() } });
    };
    const onAdded = (event: globalThis.Event) => {
      const productId = (event as CustomEvent<{ productId?: string }>).detail?.productId;
      if (productId === undefined) return;
      const clicks = readClicks();
      const click = clicks[productId];
      if (click === undefined || Date.now() - click.at > CREDIT_MS) return;
      queue({ shelf: click.shelf, kind: "add_to_cart", productId });
      // Credited once, however many more are added.
      delete clicks[productId];
      writeClicks(clicks);
    };
    const onHide = () => document.visibilityState === "hidden" && flush();
    document.addEventListener("click", onClick, { capture: true });
    window.addEventListener(ADDED_EVENT, onAdded);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      document.removeEventListener("click", onClick, { capture: true });
      window.removeEventListener(ADDED_EVENT, onAdded);
      document.removeEventListener("visibilitychange", onHide);
      flush();
    };
  }, []);

  return null;
}
