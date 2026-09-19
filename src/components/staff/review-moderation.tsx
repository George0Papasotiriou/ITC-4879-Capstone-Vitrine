"use client";

/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Hide or restore one review, asking why before hiding.
 */

import { useTranslations } from "next-intl";
import { useId, useState, useTransition, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { useHydrated } from "@/components/ui/use-hydrated";
import { useRouter } from "@/i18n/navigation";

export function ReviewModeration({ reviewId, status }: { reviewId: string; status: "published" | "hidden" }) {
  const t = useTranslations("staff");
  const router = useRouter();
  const toast = useToast();
  const hydrated = useHydrated();
  const id = useId();
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const send = (next: "published" | "hidden", reason?: string) =>
    !pending &&
    startTransition(async () => {
      const response = await fetch(`/api/staff/reviews/${reviewId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(reason === undefined ? { status: next } : { status: next, reason }),
      }).catch(() => null);
      const result = (await response?.json().catch(() => null)) as { ok: boolean } | null;
      toast(result?.ok === true ? { title: next === "hidden" ? t("hidden") : t("restored") } : { title: t("failed"), tone: "danger" });
      setAsking(false);
      router.refresh();
    });

  const hide = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const reason = String(new FormData(event.currentTarget).get("reason") ?? "").trim();
    if (reason === "") {
      setError(t("reasonRequired"));
      return;
    }
    setError(null);
    send("hidden", reason);
  };

  if (status === "hidden") {
    return (
      <Button variant="secondary" size="sm" disabled={!hydrated} aria-disabled={pending} onClick={() => send("published")} data-agent-id={`staff:review-restore:${reviewId}`}>
        {t("restore")}
      </Button>
    );
  }
  if (!asking) {
    return (
      <Button variant="secondary" size="sm" disabled={!hydrated} onClick={() => setAsking(true)} data-agent-id={`staff:review-hide:${reviewId}`}>
        {t("hide")}
      </Button>
    );
  }
  return (
    <form onSubmit={hide} method="post" noValidate className="flex flex-col gap-3">
      <label htmlFor={`${id}-reason`} className="text-sm font-medium">
        {t("hideReason")}
      </label>
      <textarea
        id={`${id}-reason`}
        name="reason"
        rows={2}
        maxLength={500}
        aria-invalid={error !== null}
        aria-describedby={`${id}-hint${error === null ? "" : ` ${id}-error`}`}
        className="border-hairline text-dusk rounded-plinth hover:border-dusk/35 w-full border bg-white p-3"
        data-agent-id="staff:review-reason"
      />
      <p id={`${id}-hint`} className="text-slate text-sm">
        {t("hideReasonHint")}
      </p>
      {error !== null ? (
        <p id={`${id}-error`} className="text-danger text-sm">
          {error}
        </p>
      ) : null}
      <div className="flex gap-3">
        <Button type="submit" variant="danger" size="sm" disabled={!hydrated} aria-disabled={pending} data-agent-id={`staff:review-confirm-hide:${reviewId}`}>
          {t("hide")}
        </Button>
        <Button variant="tertiary" size="sm" onClick={() => setAsking(false)}>
          {t("keep")}
        </Button>
      </div>
    </form>
  );
}
