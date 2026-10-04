"use client";

/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * "Add to a board" on a piece's page: one of the shopper's boards, or a new one, in two clicks.
 */

import { useLocale, useTranslations } from "next-intl";
import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { SmartLink } from "@/components/ui/smart-link";
import { useHydrated } from "@/components/ui/use-hydrated";
import type { BoardCard, BoardsResponse } from "@/app/api/boards/route";
import type { BoardItemResponse } from "@/app/api/boards/[id]/items/route";

/**
 * docs/adr/056. The boards are read when the list opens, not with the page:
 * most visits never open it. A new board is named in place and the piece goes
 * straight onto it. Escape closes the list and gives focus back to its button.
 */
/**
 * `place` names a second copy on the same page (the picture studio's, docs/adr/060), so its agent ids
 * stay unique; the buy box's copy has none.
 */
export function AddToBoard({ productId, title, place, tone = "light" }: { productId: string; title: string; place?: string; tone?: "light" | "dark" }) {
  const t = useTranslations("boards.add");
  const tb = useTranslations("boards");
  const locale = useLocale();
  const panelId = useId();
  // Inert until the page wakes up: a tap before then would open nothing.
  const hydrated = useHydrated();
  const nameId = useId();
  const [open, setOpen] = useState(false);
  const [boards, setBoards] = useState<BoardCard[] | null>(null);
  const [name, setName] = useState("");
  const [result, setResult] = useState<{ kind: "added"; id: string; title: string } | { kind: "error"; text: string } | null>(null);

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    setResult(null);
    if (next && boards === null) {
      const body = (await fetch(`/api/boards?locale=${locale}`, { cache: "no-store" })
        .then((response) => response.json())
        .catch(() => null)) as BoardsResponse | null;
      setBoards(body?.ok === true && "boards" in body ? body.boards : []);
    }
  };

  const addTo = async (board: { id: string; title: string }) => {
    const response = await fetch(`/api/boards/${board.id}/items`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ productId }) }).catch(() => null);
    const body = (await response?.json().catch(() => null)) as BoardItemResponse | null;
    if (body?.ok === true) {
      setResult({ kind: "added", id: board.id, title: board.title });
      setBoards((current) => current?.map((entry) => (entry.id === board.id ? { ...entry, items: entry.items + ("created" in body && body.created ? 1 : 0) } : entry)) ?? current);
    } else setResult({ kind: "error", text: body?.ok === false && body.reason === "full" ? t("full") : t("failed") });
  };

  const create = async () => {
    const title = name.trim();
    if (title === "") return;
    const response = await fetch("/api/boards", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title }) }).catch(() => null);
    const body = (await response?.json().catch(() => null)) as BoardsResponse | null;
    if (body?.ok === true && "board" in body) {
      setName("");
      setBoards((current) => [{ id: body.board.id, title, items: 0, updatedAt: new Date().toISOString(), covers: [] }, ...(current ?? [])]);
      await addTo({ id: body.board.id, title });
    } else setResult({ kind: "error", text: body?.ok === false && body.reason === "too_many" ? tb("tooMany") : t("failed") });
  };

  return (
    <div
      className="relative"
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          setOpen(false);
          event.currentTarget.querySelector<HTMLButtonElement>(`[aria-controls="${panelId}"]`)?.focus();
        }
      }}
      data-agent-id={place === undefined ? "board:add" : `board:add:${place}`}
    >
      <Button
        variant="secondary"
        disabled={!hydrated}
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={t("label", { title })}
        onClick={() => void toggle()}
        className={tone === "dark" ? "border-white/30 bg-transparent text-white hover:bg-white/10" : undefined}
        data-agent-id={place === undefined ? `action:add-to-board:${productId}` : `action:add-to-board:${place}:${productId}`}
      >
        {t("button")}
      </Button>
      {!open ? null : (
        <div id={panelId} className="border-hairline bg-glass absolute top-full left-0 z-30 mt-2 flex w-72 flex-col gap-3 rounded-[12px] border p-3 shadow-[0_18px_40px_-20px_color-mix(in_oklab,var(--color-dusk)_45%,transparent)]" data-agent-id="board:add-panel">
          {boards === null ? (
            <p className="text-slate text-sm">…</p>
          ) : (
            <ul className="flex max-h-56 flex-col gap-1 overflow-y-auto">
              {boards.map((board) => (
                <li key={board.id}>
                  <button type="button" onClick={() => void addTo(board)} className="hover:bg-dusk/[0.05] flex w-full items-center justify-between gap-3 rounded-md px-2 py-2 text-left text-sm" data-agent-id={`board:add-to:${board.id}`}>
                    <span className="truncate">{board.title}</span>
                    <span className="text-slate shrink-0 text-xs">{tb("pieces", { count: board.items })}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void create();
            }}
          >
            <label htmlFor={nameId} className="sr-only">
              {t("newBoard")}
            </label>
            <input id={nameId} value={name} maxLength={80} placeholder={t("newBoard")} onChange={(event) => setName(event.currentTarget.value)} className="border-hairline focus:border-dusk min-w-0 flex-1 rounded-md border bg-white px-2 py-1.5 text-sm outline-none" data-agent-id="board:add-new-name" />
            <Button type="submit" size="sm" aria-disabled={name.trim() === ""} data-agent-id="board:add-new">
              +
            </Button>
          </form>
          {result === null ? null : result.kind === "added" ? (
            <p role="status" className="text-sm" data-agent-id="board:add-result">
              {t("added", { title: result.title })} ·{" "}
              <SmartLink href={`/b/${result.id}`} className="underline underline-offset-4">
                {t("openBoard")}
              </SmartLink>
            </p>
          ) : (
            <p role="alert" className="text-danger text-sm">
              {result.text}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
