"use client";

/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * The customer's side of a ticket: the conversation, the reply box, and the one question asked at the end.
 */

import { useFormatter, useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";

import type { SupportResponse } from "@/app/api/support/route";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { useHydrated } from "@/components/ui/use-hydrated";
import { useRouter } from "@/i18n/navigation";
import { MAX_MESSAGE_LENGTH } from "@/lib/support/tickets";
import { cn } from "@/lib/ui/cn";

/**
 * Messages are shown as they were written, and never as HTML: whatever a
 * customer or an agent typed is text (docs/adr/021). Drafts and internal notes
 * never reach this component; the server does not send them.
 */

export type ConversationMessage = { id: string; author: "customer" | "agent" | "ai" | "system"; body: string; createdAt: string };

export function Conversation({
  ticketId,
  token,
  status,
  messages,
  csatScore,
}: {
  ticketId: string;
  token: string | null;
  status: "open" | "waiting_customer" | "resolved" | "closed";
  messages: readonly ConversationMessage[];
  csatScore: number | null;
}) {
  const t = useTranslations("support.ticket");
  const format = useFormatter();
  const router = useRouter();
  const toast = useToast();
  const hydrated = useHydrated();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rated, setRated] = useState<number | null>(csatScore);

  const send = async (payload: Record<string, unknown>): Promise<boolean> => {
    setPending(true);
    const response = await fetch("/api/support", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...payload, ticketId, token }) }).catch(
      () => null,
    );
    const result = (await response?.json().catch(() => null)) as SupportResponse | null;
    setPending(false);
    if (result === null || !result.ok) {
      setError(t(result !== null && "reason" in result && result.reason === "closed" ? "errors.closed" : "errors.failed"));
      return false;
    }
    setError(null);
    return true;
  };

  const reply = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    const form = event.currentTarget;
    const body = String(new FormData(form).get("body") ?? "").trim();
    if (body.length < 2) {
      setError(t("errors.too_short"));
      return;
    }
    if (await send({ action: "reply", body })) {
      form.reset();
      toast({ title: t("sent"), tone: "success" });
      router.refresh();
    }
  };

  const rate = async (score: number) => {
    if (pending) return;
    if (await send({ action: "rate", score })) {
      setRated(score);
      toast({ title: t("thanks"), tone: "success" });
    }
  };

  return (
    <div className="mt-8 flex flex-col gap-8">
      <ol className="flex flex-col gap-4" data-agent-id="support:messages">
        {messages.map((message) => (
          <li
            key={message.id}
            className={cn("rounded-plinth border-hairline border p-4", message.author === "customer" ? "bg-glass" : "bg-white")}
            data-agent-id={`support:message:${message.author}`}
          >
            <p className="text-slate text-xs">
              {t(`authors.${message.author === "ai" ? "agent" : message.author}`)} · {format.dateTime(new Date(message.createdAt), { dateStyle: "medium", timeStyle: "short" })}
            </p>
            <p className="mt-2 text-sm leading-relaxed whitespace-pre-line">{message.body}</p>
          </li>
        ))}
      </ol>

      {status === "closed" ? (
        <section aria-labelledby="csat" className="border-hairline border-t pt-6" data-agent-id="support:csat">
          <h2 id="csat" className="text-sm font-medium">
            {t("rateTitle")}
          </h2>
          {rated === null ? (
            <>
              <p className="text-slate mt-2 text-sm">{t("rateLede")}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {[1, 2, 3, 4, 5].map((score) => (
                  <Button key={score} variant="tertiary" disabled={!hydrated} aria-disabled={pending} onClick={() => void rate(score)} data-agent-id={`action:rate:${score}`}>
                    {score}
                  </Button>
                ))}
              </div>
            </>
          ) : (
            <p className="text-dusk mt-2 text-sm" data-agent-id="support:rated">
              {t("rated", { score: rated })}
            </p>
          )}
          <p className="text-slate mt-4 text-sm">{t("reopenHint")}</p>
        </section>
      ) : null}

      <form onSubmit={reply} className="border-hairline flex flex-col gap-3 border-t pt-6" data-agent-id="support:reply-form">
        <label htmlFor="support-reply" className="text-sm font-medium">
          {t("replyLabel")}
        </label>
        <textarea
          id="support-reply"
          name="body"
          rows={4}
          maxLength={MAX_MESSAGE_LENGTH}
          className="border-hairline rounded-plinth text-dusk min-w-0 border bg-white px-3 py-2"
          data-agent-id="support:reply"
        />
        {error === null ? null : (
          <p role="alert" className="text-danger text-sm">
            {error}
          </p>
        )}
        <div>
          <Button type="submit" disabled={!hydrated} aria-disabled={pending} data-agent-id="action:send-reply">
            {t("reply")}
          </Button>
        </div>
      </form>
    </div>
  );
}
