"use client";

/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * The customer's return request on a delivered order: a reason, an optional note, and a confirmation.
 */

import { useTranslations } from "next-intl";
import { useId, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { useHydrated } from "@/components/ui/use-hydrated";
import { useRouter } from "@/i18n/navigation";
import { RETURN_REASONS, type ReturnReason } from "@/lib/commerce/returns";

/**
 * Shown only while the state machine allows the customer a return (14 days
 * from delivery); the server decides again when it is sent. The reason is a
 * fixed list and goes into the order's history for the order desk.
 */
export function ReturnRequest({ orderId, token, deadline }: { orderId: string; token: string | null; deadline: string }) {
  const t = useTranslations("returns");
  const router = useRouter();
  const toast = useToast();
  const hydrated = useHydrated();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [reasonError, setReasonError] = useState<string | null>(null);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    const form = new FormData(event.currentTarget);
    const returnReason = form.get("reason") as ReturnReason | null;
    if (returnReason === null) {
      setReasonError(t("chooseReason"));
      return;
    }
    setReasonError(null);
    setPending(true);
    const note = String(form.get("note") ?? "").trim();
    const response = await fetch(`/api/orders/${orderId}/events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...(token === null ? {} : { token }), action: "request_return", returnReason, ...(note === "" ? {} : { note }) }),
    }).catch(() => null);
    const result = (await response?.json().catch(() => null)) as { ok: boolean } | null;
    setPending(false);
    toast(result?.ok === true ? { title: t("requested"), tone: "success" } : { title: t("failed"), tone: "danger" });
    setOpen(false);
    router.refresh();
  };

  return (
    <section aria-labelledby={`${id}-title`} className="border-hairline rounded-plinth flex flex-col gap-4 border p-5" data-agent-id="order:return">
      <h2 id={`${id}-title`} className="font-display text-xl">
        {t("title")}
      </h2>
      <p className="text-slate max-w-[60ch] text-sm">{t("lede", { date: deadline })}</p>
      {open ? (
        <form onSubmit={submit} method="post" noValidate className="flex flex-col gap-4">
          <fieldset className="flex flex-col gap-2" aria-describedby={reasonError === null ? undefined : `${id}-error`}>
            <legend className="text-sm font-medium">{t("reason")}</legend>
            {RETURN_REASONS.map((reason) => (
              <label key={reason} className="flex cursor-pointer items-center gap-3 text-sm">
                <input type="radio" name="reason" value={reason} className="accent-dusk size-4" data-agent-id={`return:reason:${reason}`} />
                {t(`reasons.${reason}`)}
              </label>
            ))}
            {reasonError !== null ? (
              <p id={`${id}-error`} className="text-danger text-sm">
                {reasonError}
              </p>
            ) : null}
          </fieldset>
          <div className="flex flex-col gap-2">
            <label htmlFor={`${id}-note`} className="text-sm font-medium">
              {t("note")}
            </label>
            <textarea id={`${id}-note`} name="note" rows={3} maxLength={500} className="border-hairline text-dusk rounded-plinth hover:border-dusk/35 w-full border bg-white p-3" data-agent-id="return:note" />
          </div>
          <div className="flex flex-wrap gap-3">
            <Button type="submit" disabled={!hydrated} aria-disabled={pending} data-agent-id="action:request-return">
              {t("submit")}
            </Button>
            <Button variant="tertiary" onClick={() => setOpen(false)}>
              {t("keep")}
            </Button>
          </div>
        </form>
      ) : (
        <div>
          <Button variant="secondary" onClick={() => setOpen(true)} disabled={!hydrated} data-agent-id="action:open-return">
            {t("open")}
          </Button>
        </div>
      )}
    </section>
  );
}
