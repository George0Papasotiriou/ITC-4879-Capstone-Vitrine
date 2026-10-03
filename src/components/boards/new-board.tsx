"use client";

/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Starting a room board: a name, and the new board opens.
 */

import { useTranslations } from "next-intl";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { useHydrated } from "@/components/ui/use-hydrated";
import type { BoardsResponse } from "@/app/api/boards/route";
import { useRouter } from "@/i18n/navigation";

export function NewBoard() {
  const t = useTranslations("boards");
  const router = useRouter();
  const hydrated = useHydrated();
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="border-hairline rounded-plinth flex flex-col gap-3 border p-4"
      onSubmit={async (event) => {
        event.preventDefault();
        if (title.trim() === "" || busy) return;
        setBusy(true);
        setError(null);
        const response = await fetch("/api/boards", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: title.trim() }) }).catch(() => null);
        const body = (await response?.json().catch(() => null)) as BoardsResponse | null;
        setBusy(false);
        if (body?.ok === true && "board" in body) router.push(`/b/${body.board.id}`);
        else setError(body?.ok === false && body.reason === "too_many" ? t("tooMany") : t("board.failed"));
      }}
      data-agent-id="boards:new"
    >
      <Field label={t("newTitle")} value={title} maxLength={80} placeholder={t("newPlaceholder")} onChange={(event) => setTitle(event.currentTarget.value)} error={error ?? undefined} data-agent-id="boards:new-title" />
      <Button type="submit" disabled={!hydrated} aria-disabled={busy || title.trim() === ""} data-agent-id="boards:create">
        {t("create")}
      </Button>
    </form>
  );
}
