"use client";

/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Order page actions: local test payment and cancellation.
 */

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { DialogClose, DialogContent, DialogRoot, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { useRouter } from "@/i18n/navigation";

/**
 * What a guest can do on their order page: the local test payment (while the
 * order waits for payment) and cancelling (while the state machine allows it).
 * The buttons shown are the ones the server said are available; the server
 * checks again when one is pressed. Cancelling is irreversible, so it asks
 * first.
 */
export function OrderActions({
  orderId,
  token,
  amount,
  canTestPay,
  canCancel,
  paid,
}: {
  orderId: string;
  /** The guest link's token; null when the signed-in owner is looking (the server checks the session instead). */
  token: string | null;
  /** The total, already formatted. */
  amount: string;
  canTestPay: boolean;
  canCancel: boolean;
  paid: boolean;
}) {
  const t = useTranslations("order");
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);

  const act = (action: "test_pay" | "test_decline" | "cancel") =>
    startTransition(async () => {
      const response = await fetch(`/api/orders/${orderId}/events`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(token === null ? { action } : { token, action }),
      }).catch(() => null);
      const result = (await response?.json().catch(() => null)) as { ok: boolean } | null;
      setConfirming(false);
      if (result?.ok !== true) {
        toast({ title: t("actionFailed"), tone: "danger" });
      } else {
        toast({
          title: action === "test_pay" ? t("paid") : action === "test_decline" ? t("declined") : t("cancelled"),
          tone: action === "test_pay" ? "success" : "neutral",
        });
      }
      router.refresh();
    });

  if (!canTestPay && !canCancel) return null;

  return (
    <div className="flex flex-col gap-6">
      {canTestPay ? (
        <section aria-labelledby="test-payment" className="border-lumen/60 rounded-plinth flex flex-col gap-4 border border-dashed p-5" data-agent-id="order:test-payment">
          <h2 id="test-payment" className="font-display text-xl">
            {t("testPaymentTitle")}
          </h2>
          <p className="text-slate max-w-[60ch] text-sm">{t("testPaymentBody")}</p>
          <div className="flex flex-wrap gap-3">
            <Button onClick={() => act("test_pay")} aria-disabled={pending || undefined} data-agent-id="action:test-pay">
              {t("payTest", { amount })}
            </Button>
            <Button variant="secondary" onClick={() => act("test_decline")} aria-disabled={pending || undefined} data-agent-id="action:test-decline">
              {t("declineTest")}
            </Button>
          </div>
        </section>
      ) : null}

      {canCancel ? (
        <DialogRoot open={confirming} onOpenChange={setConfirming}>
          <DialogTrigger asChild>
            <Button variant="tertiary" className="self-start" data-agent-id="action:cancel-order">
              {t("cancel")}
            </Button>
          </DialogTrigger>
          <DialogContent title={t("cancelTitle")} description={paid ? t("cancelPaidBody") : t("cancelBody")}>
            <div className="flex flex-wrap justify-end gap-3">
              <DialogClose asChild>
                <Button variant="secondary">{t("keepOrder")}</Button>
              </DialogClose>
              <Button variant="danger" onClick={() => act("cancel")} aria-disabled={pending || undefined}>
                {t("cancel")}
              </Button>
            </div>
          </DialogContent>
        </DialogRoot>
      ) : null}
    </div>
  );
}
