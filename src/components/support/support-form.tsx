"use client";

/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * "Write to us": the form that opens a support ticket, for a guest or a signed-in customer.
 */

import { useLocale, useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";

import type { SupportResponse } from "@/app/api/support/route";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { useHydrated } from "@/components/ui/use-hydrated";
import { useRouter } from "@/i18n/navigation";
import { MAX_MESSAGE_LENGTH } from "@/lib/support/tickets";

/**
 * One form for everyone (docs/adr/021). A signed-in customer writes as
 * themselves and the shop fills in their name and address; a guest gives both,
 * and the answer arrives by email with a private link to the conversation.
 */
export function SupportForm({ signedIn, name, email }: { signedIn: boolean; name: string | null; email: string | null }) {
  const t = useTranslations("support.form");
  const locale = useLocale();
  const router = useRouter();
  const hydrated = useHydrated();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    const form = new FormData(event.currentTarget);
    const body = String(form.get("body") ?? "").trim();
    if (body.length < 2) {
      setError(t("errors.too_short"));
      return;
    }

    setPending(true);
    const response = await fetch("/api/support", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "open",
        name: signedIn ? (name ?? "") : String(form.get("name") ?? "").trim(),
        email: signedIn ? (email ?? "") : String(form.get("email") ?? "").trim(),
        subject: String(form.get("subject") ?? "").trim(),
        orderNumber: String(form.get("orderNumber") ?? "").trim(),
        body,
        locale,
      }),
    }).catch(() => null);
    const result = (await response?.json().catch(() => null)) as SupportResponse | null;
    setPending(false);

    if (result === null || !("ok" in result) || !result.ok) {
      setError(t(result !== null && "reason" in result && result.reason === "slow_down" ? "errors.slow_down" : "errors.failed"));
      return;
    }
    setError(null);
    // The ticket page is where the conversation continues; a guest reaches it
    // through the link in their email, and through this one now. The router is
    // next-intl's, so the path carries no locale: it adds the one in use.
    if ("url" in result) router.push(`/support/${result.ticketId}${new URL(result.url).search}`);
  };

  return (
    <form onSubmit={submit} className="mt-8 flex max-w-[40rem] flex-col gap-5" data-agent-id="support:form">
      {signedIn ? (
        <p className="text-slate text-sm">{t("signedInAs", { email: email ?? "" })}</p>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label={t("name")} name="name" autoComplete="name" required maxLength={120} data-agent-id="support:name" />
          <Field label={t("email")} name="email" type="email" autoComplete="email" required maxLength={200} hint={t("emailHint")} data-agent-id="support:email" />
        </div>
      )}

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label={t("subject")} name="subject" maxLength={120} hint={t("subjectHint")} data-agent-id="support:subject" />
        <Field label={t("orderNumber")} name="orderNumber" maxLength={20} hint={t("orderNumberHint")} data-agent-id="support:order" />
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="support-body" className="text-sm font-medium">
          {t("message")}
        </label>
        <textarea
          id="support-body"
          name="body"
          required
          rows={6}
          maxLength={MAX_MESSAGE_LENGTH}
          className="border-hairline rounded-plinth text-dusk min-w-0 border bg-white px-3 py-2"
          data-agent-id="support:body"
        />
        <p className="text-slate text-sm">{t("messageHint")}</p>
      </div>

      {error === null ? null : (
        <p role="alert" className="text-danger text-sm" data-agent-id="support:error">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-4">
        <Button type="submit" disabled={!hydrated} aria-disabled={pending} data-agent-id="action:send-support">
          {pending ? t("sending") : t("send")}
        </Button>
        <p className="text-slate text-sm">{t("promise")}</p>
      </div>
    </form>
  );
}
