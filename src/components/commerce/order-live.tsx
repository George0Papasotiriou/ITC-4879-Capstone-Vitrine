"use client";

/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Keeps an open order page up to date: when the order changes anywhere, the page shows it.
 */

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { useRouter } from "@/i18n/navigation";

/**
 * docs/adr/039. Listens to `/api/orders/[id]/live` and refreshes the page on
 * each change — the bank confirming a payment, the desk packing the parcel —
 * and says so once in a polite live region, for screen readers. Nothing is
 * shown otherwise; if the browser has no EventSource the page is simply as
 * current as its last load.
 */
export function OrderLive({ orderId, token }: { orderId: string; token: string | null }) {
  const t = useTranslations("order");
  const router = useRouter();
  const [announcement, setAnnouncement] = useState("");

  useEffect(() => {
    if (typeof EventSource === "undefined") return;
    const source = new EventSource(`/api/orders/${orderId}/live${token === null ? "" : `?token=${encodeURIComponent(token)}`}`);
    source.addEventListener("order", (event) => {
      try {
        const { status } = JSON.parse((event as MessageEvent<string>).data) as { status: string };
        setAnnouncement(t("liveUpdated", { status: t(`status.${status}` as "status.paid") }));
      } catch {
        setAnnouncement(t("liveUpdatedPlain"));
      }
      router.refresh();
    });
    return () => source.close();
  }, [orderId, token, router, t]);

  return (
    <p className="sr-only" role="status" aria-live="polite" data-agent-id="order:live">
      {announcement}
    </p>
  );
}
