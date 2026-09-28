"use client";

/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * The moderator's form: a participant code, and the session begins on the home page.
 */

import { useLocale, useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { PARTICIPANT_CODE, STUDY_COOKIE } from "@/lib/study/tasks";

/** docs/adr/037. The code lives in a cookie on this device for three hours at most, and nowhere else. */
export function StudyStart() {
  const t = useTranslations("study");
  const locale = useLocale();
  const [error, setError] = useState<string | null>(null);

  const start = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const code = String(new FormData(event.currentTarget).get("code") ?? "").trim().toUpperCase();
    if (!PARTICIPANT_CODE.test(code)) {
      setError(t("codeInvalid"));
      return;
    }
    document.cookie = `${STUDY_COOKIE}=${code}; path=/; max-age=${3 * 60 * 60}; samesite=lax`;
    try {
      window.sessionStorage.removeItem("vt_study_task");
    } catch {
      // Nothing kept from an earlier session.
    }
    // A full load (not a client navigation), so the panel reads the new cookie on a fresh page.
    window.location.assign(new URL(`/${locale}`, window.location.origin).href);
  };

  return (
    <form onSubmit={start} className="mt-8 flex flex-col gap-4" noValidate data-agent-id="study:form">
      <Field label={t("code")} name="code" hint={t("codeHint")} error={error ?? undefined} autoComplete="off" className="max-w-xs" data-agent-id="study:code" />
      <Button type="submit" className="self-start" data-agent-id="study:begin">
        {t("begin")}
      </Button>
    </form>
  );
}
