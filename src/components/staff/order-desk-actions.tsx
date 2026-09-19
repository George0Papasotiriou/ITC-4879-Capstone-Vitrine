"use client";

/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * The order desk's buttons for one order: the next steps the state machine allows staff.
 */

import { useTranslations } from "next-intl";
import { useId, useState, useTransition, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { useHydrated } from "@/components/ui/use-hydrated";
import { useRouter } from "@/i18n/navigation";
import { needsReason } from "@/lib/commerce/desk";
import type { OrderEventType, OrderStatus } from "@/lib/commerce/order-state";

/**
 * One button per action the server said is available. The forward steps act
 * at once; cancelling and refunding ask again and need a reason, which goes
 * into the order's history. Whatever happens, the page is refreshed from the
 * server, so it always shows the order as it now is.
 */
export function OrderDeskActions({ orderId, number, actions }: { orderId: string; number: string; actions: OrderEventType[] }) {
  const t = useTranslations("staff");
  const o = useTranslations("order");
  const router = useRouter();
  const toast = useToast();
  const hydrated = useHydrated();
  const reasonId = useId();
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState<OrderEventType | null>(null);
  const [reasonError, setReasonError] = useState<string | null>(null);

  const act = (event: OrderEventType, reason?: string) =>
    !pending &&
    startTransition(async () => {
      const response = await fetch(`/api/staff/orders/${orderId}/events`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(reason === undefined ? { event } : { event, reason }),
      }).catch(() => null);
      const result = (await response?.json().catch(() => null)) as { ok: boolean; status?: OrderStatus } | null;
      if (result?.ok === true && result.status !== undefined) {
        toast({ title: t("moved", { number, status: o(`status.${result.status}`) }), tone: "success" });
        setConfirming(null);
      } else {
        toast({ title: t("failed"), tone: "danger" });
      }
      router.refresh();
    });

  const confirm = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (confirming === null) return;
    const reason = String(new FormData(event.currentTarget).get("reason") ?? "").trim();
    if (reason === "") {
      setReasonError(t("reasonRequired"));
      return;
    }
    setReasonError(null);
    act(confirming, reason);
  };

  if (confirming !== null) {
    return (
      <form onSubmit={confirm} method="post" noValidate className="flex flex-col gap-4" data-agent-id="staff:confirm">
        <div className="flex flex-col gap-2">
          <label htmlFor={reasonId} className="text-sm font-medium">
            {t("reason")}
          </label>
          <textarea
            id={reasonId}
            name="reason"
            rows={3}
            maxLength={500}
            required
            aria-invalid={reasonError !== null}
            aria-describedby={`${reasonId}-hint${reasonError === null ? "" : ` ${reasonId}-error`}`}
            className="border-hairline text-dusk rounded-plinth hover:border-dusk/35 w-full border bg-white p-3"
            data-agent-id="staff:reason"
          />
          <p id={`${reasonId}-hint`} className="text-slate text-sm">
            {t("reasonHint")}
          </p>
          {reasonError !== null ? (
            <p id={`${reasonId}-error`} className="text-danger text-sm">
              {reasonError}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-3">
          <Button type="submit" variant="danger" disabled={!hydrated} aria-disabled={pending} data-agent-id={`staff:confirm:${confirming}`}>
            {t("confirmAction", { action: t(`actions.${confirming}`), number })}
          </Button>
          <Button variant="tertiary" onClick={() => setConfirming(null)}>
            {t("keep")}
          </Button>
        </div>
      </form>
    );
  }

  return (
    <div className="flex flex-wrap gap-3" data-agent-id="staff:actions">
      {actions.map((event, index) => (
        <Button
          key={event}
          variant={needsReason(event) ? "secondary" : index === 0 ? "primary" : "secondary"}
          disabled={!hydrated}
          aria-disabled={pending}
          onClick={() => (needsReason(event) ? setConfirming(event) : act(event))}
          data-agent-id={`staff:action:${event}`}
        >
          {t(`actions.${event}`)}
        </Button>
      ))}
    </div>
  );
}
