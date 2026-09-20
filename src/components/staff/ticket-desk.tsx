"use client";

/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * The agent's controls on a ticket: the reply, an AI draft to edit, ready answers, notes and the ticket's state.
 */

import { useTranslations } from "next-intl";
import { useRef, useState, type FormEvent } from "react";

import type { DeskResponse } from "@/app/api/staff/support/[id]/route";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { useHydrated } from "@/components/ui/use-hydrated";
import { useRouter } from "@/i18n/navigation";
import { MAX_MESSAGE_LENGTH, renderMacro, type TicketStatus } from "@/lib/support/tickets";

/**
 * A draft is a suggestion in the reply box, never a sent message
 * (docs/adr/021): the agent reads it, edits it and presses send, and the
 * message that goes out is theirs. The same box takes a ready answer, so
 * both start the same way: text an agent can change.
 */

export type DeskMacro = { key: string; title: string; body: string };

export function TicketDesk({
  ticketId,
  status,
  macros,
  customerName,
  ticketNumber,
  orderNumber,
  draft,
}: {
  ticketId: string;
  status: TicketStatus;
  macros: readonly DeskMacro[];
  customerName: string;
  ticketNumber: string;
  orderNumber: string | null;
  /** A draft written earlier and not yet sent. */
  draft: { id: string; body: string; source: string } | null;
}) {
  const t = useTranslations("staff.support");
  const router = useRouter();
  const toast = useToast();
  const hydrated = useHydrated();
  const reply = useRef<HTMLTextAreaElement>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draftId, setDraftId] = useState<string | null>(draft?.id ?? null);
  const [text, setText] = useState(draft?.body ?? "");

  const send = async (body: Record<string, unknown>, label: string): Promise<DeskResponse | null> => {
    if (pending !== null) return null;
    setPending(label);
    const response = await fetch(`/api/staff/support/${ticketId}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
    const result = (await response?.json().catch(() => null)) as DeskResponse | null;
    setPending(null);
    if (result === null || !result.ok) {
      const reason = result !== null && "reason" in result ? result.reason : "failed";
      // A reason the interface has no words for is still a failure the agent must see.
      setError(t.has(`errors.${reason}`) ? t(`errors.${reason}`) : t("errors.failed"));
      return null;
    }
    setError(null);
    return result;
  };

  const fill = (body: string) => {
    const values: Record<string, string> = { name: customerName.split(" ")[0] ?? customerName, number: ticketNumber };
    // With no order to name, {order} stays visible for the agent to fill in.
    if (orderNumber !== null) values.order = orderNumber;
    setText(renderMacro(body, values));
    reply.current?.focus();
  };

  const writeDraft = async () => {
    const result = await send({ action: "draft" }, "draft");
    if (result === null || !result.ok || result.draft === undefined) return;
    setDraftId(result.draft.id);
    setText(result.draft.body);
    toast({ title: t("draftReady", { source: result.draft.source === "macros" ? t("fromMacros") : result.draft.source }), tone: "success" });
    reply.current?.focus();
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const body = text.trim();
    if (body.length < 2) {
      setError(t("errors.too_short"));
      return;
    }
    // A draft that was edited is sent as the agent's message, replacing it.
    const result = draftId === null ? await send({ action: "reply", body }, "reply") : await send({ action: "send_draft", messageId: draftId, body }, "reply");
    if (result === null) return;
    setDraftId(null);
    setText("");
    toast({ title: t("sent"), tone: "success" });
    router.refresh();
  };

  const note = async () => {
    const body = text.trim();
    if (body.length < 2) {
      setError(t("errors.too_short"));
      return;
    }
    if ((await send({ action: "note", body }, "note")) === null) return;
    setText("");
    toast({ title: t("noteSaved"), tone: "success" });
    router.refresh();
  };

  const move = async (event: "resolve" | "close" | "reopen") => {
    if ((await send({ action: "move", event }, event)) === null) return;
    toast({ title: t(`moved.${event}`), tone: "success" });
    router.refresh();
  };

  const discard = async () => {
    if (draftId === null) return;
    if ((await send({ action: "discard_draft", messageId: draftId }, "discard")) === null) return;
    setDraftId(null);
    setText("");
    router.refresh();
  };

  return (
    <div className="mt-8 flex flex-col gap-4" data-agent-id="desk:ticket-actions">
      <form onSubmit={submit} className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <label htmlFor="desk-reply" className="text-sm font-medium">
            {t("replyLabel")}
          </label>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="tertiary" disabled={!hydrated} aria-disabled={pending !== null} onClick={() => void writeDraft()} data-agent-id="action:write-draft">
              {pending === "draft" ? t("writing") : t("writeDraft")}
            </Button>
            {draftId === null ? null : (
              <Button type="button" variant="tertiary" disabled={!hydrated} onClick={() => void discard()} data-agent-id="action:discard-draft">
                {t("discardDraft")}
              </Button>
            )}
          </div>
        </div>

        {draftId === null ? null : (
          <p className="text-slate text-sm" data-agent-id="desk:draft-note">
            {t("draftNote")}
          </p>
        )}

        <textarea
          id="desk-reply"
          ref={reply}
          value={text}
          onChange={(event) => setText(event.target.value)}
          rows={8}
          maxLength={MAX_MESSAGE_LENGTH}
          className="border-hairline rounded-plinth text-dusk min-w-0 border bg-white px-3 py-2"
          data-agent-id="desk:reply"
        />

        {macros.length === 0 ? null : (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-slate text-sm">{t("macros")}:</span>
            {macros.map((macro) => (
              <Button key={macro.key} type="button" variant="tertiary" disabled={!hydrated} onClick={() => fill(macro.body)} data-agent-id={`action:macro:${macro.key}`}>
                {macro.title}
              </Button>
            ))}
          </div>
        )}

        {error === null ? null : (
          <p role="alert" className="text-danger text-sm" data-agent-id="desk:error">
            {error}
          </p>
        )}

        <div className="flex flex-wrap gap-3">
          <Button type="submit" disabled={!hydrated} aria-disabled={pending !== null} data-agent-id="action:send-reply">
            {t("send")}
          </Button>
          <Button type="button" variant="secondary" disabled={!hydrated} onClick={() => void note()} data-agent-id="action:add-note">
            {t("note")}
          </Button>
          {status === "closed" ? (
            <Button type="button" variant="tertiary" disabled={!hydrated} onClick={() => void move("reopen")} data-agent-id="action:reopen-ticket">
              {t("reopen")}
            </Button>
          ) : (
            <>
              {status === "resolved" ? null : (
                <Button type="button" variant="tertiary" disabled={!hydrated} onClick={() => void move("resolve")} data-agent-id="action:resolve-ticket">
                  {t("resolve")}
                </Button>
              )}
              <Button type="button" variant="tertiary" disabled={!hydrated} onClick={() => void move("close")} data-agent-id="action:close-ticket">
                {t("close")}
              </Button>
            </>
          )}
        </div>
      </form>
    </div>
  );
}
