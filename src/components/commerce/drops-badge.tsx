"use client";

/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * The quiet mark on the account icon when a watched price has dropped, and marking drops seen.
 */

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

/**
 * docs/adr/034. A dot on the account icon, said to screen readers as part of
 * the link's name ("Account, 1 price drop"), never a pop-up: the email has
 * already told them, and the shop only reminds. The header lives in the
 * layout, which stays mounted between pages, so the dot listens for the
 * account page saying the drops were seen instead of waiting for a reload.
 */

export const DROPS_SEEN_EVENT = "vitrine:drops-seen";

export function DropsBadge({ count, variant }: { count: number; variant: "header" | "bar" }) {
  const t = useTranslations("account.drops");
  // The count the account page said were seen; a new, different count shows again.
  const [seenCount, setSeenCount] = useState<number | null>(null);

  useEffect(() => {
    const onSeen = () => setSeenCount(count);
    window.addEventListener(DROPS_SEEN_EVENT, onSeen);
    return () => window.removeEventListener(DROPS_SEEN_EVENT, onSeen);
  }, [count]);

  if (count === 0 || seenCount === count) return null;
  return (
    <>
      <span className="sr-only">{`, ${t("badge", { count })}`}</span>
      <span
        aria-hidden="true"
        data-agent-id="nav:price-drops"
        className={variant === "header" ? "bg-dusk ring-glass absolute top-2 left-[1.45rem] size-2 rounded-full ring-2" : "bg-dusk ring-glass absolute top-2 left-1/2 ml-2 size-2 rounded-full ring-2"}
      />
    </>
  );
}

/** On the account page: tells the shop these drops were seen, then the dot goes. */
export function MarkDropsSeen({ ids }: { ids: readonly string[] }) {
  const key = ids.join(",");
  useEffect(() => {
    if (key === "") return;
    const controller = new AbortController();
    void fetch("/api/watch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "seen", ids: key.split(",") }),
      signal: controller.signal,
    })
      .then((response) => {
        if (response.ok) window.dispatchEvent(new Event(DROPS_SEEN_EVENT));
      })
      .catch(() => {
        // Seen or not, the notice was shown; the next visit will try again.
      });
    return () => controller.abort();
  }, [key]);
  return null;
}
