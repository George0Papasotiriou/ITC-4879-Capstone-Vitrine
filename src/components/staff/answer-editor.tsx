"use client";

/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Editing one of the desk's ready answers, in both languages, or writing a new one.
 */

import { useTranslations } from "next-intl";
import { useId, useState, type FormEvent } from "react";

import type { AnswersResponse } from "@/app/api/staff/support/answers/route";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { useHydrated } from "@/components/ui/use-hydrated";
import { useRouter } from "@/i18n/navigation";
import { ANSWER_PLACEHOLDERS } from "@/lib/support/answers";
import { TICKET_TOPICS } from "@/lib/support/tickets";
import { cn } from "@/lib/ui/cn";

/**
 * docs/adr/029. An answer is written in both languages at once, because the
 * desk replies in the customer's; the blanks a draft fills are listed next to
 * the text, and an unknown one is refused before it can reach a customer.
 */

export type AnswerValues = { topic: string; titleEn: string; titleEl: string; bodyEn: string; bodyEl: string; sort: number };

type FieldName = "topic" | "titleEn" | "titleEl" | "bodyEn" | "bodyEl" | "sort";
const KNOWN_ERRORS = ["too_short", "too_long", "unknown_placeholder"];

export function AnswerEditor({
  id,
  initial,
  shipped,
  edited,
  startOpen = false,
}: {
  /** Null for a new answer. */
  id: string | null;
  initial: AnswerValues;
  /** One of the shop's own answers: it can be restored, never removed. */
  shipped: boolean;
  edited: boolean;
  startOpen?: boolean;
}) {
  const t = useTranslations("staff.answers");
  const topics = useTranslations("staff.support.topics");
  const router = useRouter();
  const toast = useToast();
  const hydrated = useHydrated();
  const formId = useId();
  const [open, setOpen] = useState(startOpen);
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<FieldName | "form", string>>>({});
  const agentId = id === null ? "answer:new" : `answer:${id}`;

  const errorFor = (key: string | undefined) => (key === undefined ? undefined : t(`errors.${KNOWN_ERRORS.includes(key) ? key : "invalid"}`));

  const send = async (payload: Record<string, unknown>): Promise<AnswersResponse | null> => {
    setPending(true);
    const response = await fetch("/api/staff/support/answers", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) }).catch(() => null);
    const result = (await response?.json().catch(() => null)) as AnswersResponse | null;
    setPending(false);
    return result;
  };

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    const data = new FormData(event.currentTarget);
    const answer = {
      topic: String(data.get("topic") ?? "other"),
      titleEn: String(data.get("titleEn") ?? ""),
      titleEl: String(data.get("titleEl") ?? ""),
      bodyEn: String(data.get("bodyEn") ?? ""),
      bodyEl: String(data.get("bodyEl") ?? ""),
      sort: Number.parseInt(String(data.get("sort") ?? "0"), 10) || 0,
    };
    const result = await send({ action: "save", id, answer });
    if (result === null || !result.ok) {
      setErrors(result !== null && "fields" in result ? result.fields : { form: "failed" });
      return;
    }
    setErrors({});
    toast({ title: id === null ? t("created") : result.changed?.length === 0 ? t("unchanged") : t("saved"), tone: "success" });
    // Closed once saved: the list shows the answer as it now reads.
    setOpen(false);
    router.refresh();
  };

  const act = async (action: "restore" | "remove") => {
    if (id === null || pending) return;
    const result = await send({ action, id });
    if (result === null || !result.ok) {
      setErrors({ form: "failed" });
      return;
    }
    toast({ title: action === "restore" ? t("restored") : t("removed"), tone: "success" });
    router.refresh();
  };

  const textArea = (name: "bodyEn" | "bodyEl", label: string) => (
    <div className="flex flex-col gap-2">
      <label htmlFor={`${formId}-${name}`} className="text-sm font-medium">
        {label}
      </label>
      <textarea
        id={`${formId}-${name}`}
        name={name}
        rows={7}
        defaultValue={initial[name]}
        aria-invalid={errors[name] !== undefined}
        aria-describedby={errors[name] === undefined ? `${formId}-blanks` : `${formId}-${name}-error ${formId}-blanks`}
        className={cn("border-hairline text-dusk rounded-plinth hover:border-dusk/35 w-full border bg-white p-3 text-sm", errors[name] !== undefined && "border-danger")}
        data-agent-id={`${agentId}:${name}`}
      />
      {errors[name] === undefined ? null : (
        <p id={`${formId}-${name}-error`} className="text-danger text-sm">
          {errorFor(errors[name])}
        </p>
      )}
    </div>
  );

  if (!open) {
    return (
      <Button variant={id === null ? "secondary" : "tertiary"} size="sm" disabled={!hydrated} onClick={() => setOpen(true)} data-agent-id={`${agentId}:open`}>
        {id === null ? t("new") : t("edit")}
      </Button>
    );
  }

  return (
    <form onSubmit={save} className="border-hairline rounded-plinth mt-3 flex flex-col gap-4 border bg-white/60 p-4" data-agent-id={`${agentId}:form`}>
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_8rem]">
        <div className="flex flex-col gap-2">
          <label htmlFor={`${formId}-topic`} className="text-sm font-medium">
            {t("topic")}
          </label>
          <select id={`${formId}-topic`} name="topic" defaultValue={initial.topic} className="border-hairline text-dusk rounded-plinth h-11 border bg-white px-3 text-sm" data-agent-id={`${agentId}:topic`}>
            {TICKET_TOPICS.map((topic) => (
              <option key={topic} value={topic}>
                {topics(topic)}
              </option>
            ))}
          </select>
        </div>
        <Field label={t("sort")} name="sort" type="number" min={0} max={999} defaultValue={String(initial.sort)} hint={t("sortHint")} error={errorFor(errors.sort)} data-agent-id={`${agentId}:sort`} />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label={t("titleEn")} name="titleEn" defaultValue={initial.titleEn} maxLength={80} error={errorFor(errors.titleEn)} data-agent-id={`${agentId}:titleEn`} />
        <Field label={t("titleEl")} name="titleEl" defaultValue={initial.titleEl} maxLength={80} lang="el" error={errorFor(errors.titleEl)} data-agent-id={`${agentId}:titleEl`} />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {textArea("bodyEn", t("bodyEn"))}
        {textArea("bodyEl", t("bodyEl"))}
      </div>
      <p id={`${formId}-blanks`} className="text-slate text-sm">
        {t("blanks", { blanks: ANSWER_PLACEHOLDERS.map((name) => `{${name}}`).join(", ") })}
      </p>

      {errors.form === undefined ? null : (
        <p role="alert" className="text-danger text-sm" data-agent-id={`${agentId}:error`}>
          {t("errors.failed")}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" disabled={!hydrated} aria-disabled={pending} data-agent-id={`${agentId}:save`}>
          {pending ? t("saving") : t("save")}
        </Button>
        <Button type="button" variant="tertiary" size="sm" onClick={() => setOpen(false)} data-agent-id={`${agentId}:cancel`}>
          {t("cancel")}
        </Button>
        <span className="flex-1" />
        {id !== null && shipped && edited ? (
          <Button type="button" variant="secondary" size="sm" disabled={!hydrated} onClick={() => void act("restore")} data-agent-id={`${agentId}:restore`}>
            {t("restore")}
          </Button>
        ) : null}
        {id !== null && !shipped ? (
          <Button type="button" variant="secondary" size="sm" disabled={!hydrated} onClick={() => void act("remove")} data-agent-id={`${agentId}:remove`}>
            {t("remove")}
          </Button>
        ) : null}
      </div>
    </form>
  );
}
