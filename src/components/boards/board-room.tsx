"use client";

/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * A room board on its page: the pieces as a moodboard, what they come to, who is here, and — with the right link — changing it together.
 */

import Image from "next/image";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useId, useMemo, useState } from "react";

import { announceCart, type CartSummary } from "@/components/commerce/cart-client";
import { Button } from "@/components/ui/button";
import { SmartLink } from "@/components/ui/smart-link";
import { useToast } from "@/components/ui/toast";
import type { BoardResponse } from "@/app/api/boards/[id]/route";
import type { BoardCartResponse } from "@/app/api/boards/[id]/cart/route";
import type { BoardPiece, BoardView } from "@/lib/boards/server";
import { formatMoney, money } from "@/lib/commerce/money";
import { roomFits } from "@/lib/prefs/preferences";
import { useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/ui/cn";

/**
 * docs/adr/056. What everyone with the link sees, in step: a change anyone
 * makes is announced on the board's live stream (/api/boards/[id]/live) and
 * every open page reads the board again — with its own link's rights, so a
 * viewer never receives an editor's controls. Prices are read from the
 * catalogue on each read, in the visitor's own country, never stored on the
 * board. Editing is for the owner and the edit link; sharing, the room and
 * deleting are the owner's.
 */

type Props = { initial: BoardView; token: string | null; rooms: string[]; country: string };

export function BoardRoom({ initial, token, rooms, country }: Props) {
  const t = useTranslations("boards.board");
  const locale = useLocale();
  const router = useRouter();
  const toast = useToast();
  const [view, setView] = useState(initial);
  const [present, setPresent] = useState<number | null>(null);
  const [live, setLive] = useState(false);
  const [gone, setGone] = useState(false);
  const [removed, setRemoved] = useState<BoardPiece | null>(null);
  const [cartNote, setCartNote] = useState<string | null>(null);
  const editable = view.role === "owner" || view.role === "editor";
  const query = useMemo(() => `?${new URLSearchParams({ locale, ...(token === null ? {} : { k: token }) }).toString()}`, [locale, token]);
  const price = useCallback((cents: number) => formatMoney(money(cents, view.currency), locale), [locale, view.currency]);

  const reload = useCallback(async () => {
    const response = await fetch(`/api/boards/${view.id}${query}`, { cache: "no-store" }).catch(() => null);
    if (response?.status === 404) return setGone(true);
    const body = (await response?.json().catch(() => null)) as BoardResponse | null;
    if (body?.ok === true && "board" in body) setView(body.board);
  }, [view.id, query]);

  // Everyone's changes, and who is here, as they happen. EventSource reconnects by itself.
  useEffect(() => {
    const source = new EventSource(`/api/boards/${view.id}/live${query}`);
    source.addEventListener("ready", () => setLive(true));
    source.addEventListener("changed", () => void reload());
    source.addEventListener("presence", (event) => setPresent((JSON.parse((event as MessageEvent<string>).data) as { count: number }).count));
    source.onerror = () => setLive(false);
    return () => source.close();
  }, [view.id, query, reload]);

  const send = useCallback(
    async (path: string, init: RequestInit, extra: Record<string, string> = {}) => {
      const params = new URLSearchParams({ locale, ...(token === null ? {} : { k: token }), ...extra });
      const response = await fetch(`/api/boards/${view.id}${path}?${params.toString()}`, { ...init, headers: { "content-type": "application/json" } }).catch(() => null);
      if (response === null || !response.ok) {
        toast({ title: t("failed"), tone: "danger" });
        return null;
      }
      return response.json().catch(() => ({}));
    },
    [view.id, locale, token, toast, t],
  );

  const change = async (piece: BoardPiece, patch: { quantity?: number; note?: string | null; to?: number }) => {
    // Shown at once; the stream's "changed" brings everyone, this page included, the stored board.
    setView((current) => ({ ...current, pieces: current.pieces.map((entry) => (entry.id === piece.id ? { ...entry, ...("quantity" in patch ? { quantity: patch.quantity! } : {}), ...("note" in patch ? { note: patch.note ?? null } : {}) } : entry)) }));
    if ((await send("/items", { method: "PATCH", body: JSON.stringify({ itemId: piece.id, ...patch }) })) !== null) await reload();
  };

  const remove = async (piece: BoardPiece) => {
    setView((current) => ({ ...current, pieces: current.pieces.filter((entry) => entry.id !== piece.id) }));
    if ((await send("/items", { method: "DELETE" }, { item: piece.id })) !== null) setRemoved(piece);
    await reload();
  };

  const undoRemove = async () => {
    if (removed === null) return;
    const piece = removed;
    setRemoved(null);
    const added = (await send("/items", { method: "POST", body: JSON.stringify({ productId: piece.productId, quantity: piece.quantity }) })) as { item?: { id: string } } | null;
    if (added?.item !== undefined) await send("/items", { method: "PATCH", body: JSON.stringify({ itemId: added.item.id, to: piece.position, ...(piece.note === null ? {} : { note: piece.note }) }) });
    await reload();
  };

  const addAll = async () => {
    setCartNote(null);
    const body = (await send("/cart", { method: "POST" })) as BoardCartResponse | null;
    if (body?.ok !== true) return;
    setCartNote([t("addedAll", { added: body.added }), body.refused > 0 ? t("someRefused", { refused: body.refused }) : null].filter(Boolean).join(" "));
    // Every cart count on the page learns what the cart now holds.
    const cart = (await fetch(`/api/cart?locale=${locale}`, { cache: "no-store" })
      .then((response) => response.json())
      .catch(() => null)) as CartSummary | null;
    if (cart !== null) announceCart(cart);
  };

  if (gone) {
    return (
      <p role="alert" className="text-slate py-24 text-center text-lg" data-agent-id="board:gone">
        {t("gone")}
      </p>
    );
  }

  const fit = view.room === null ? null : view.pieces.filter((piece) => piece.dimsCm !== null).map((piece) => ({ piece, fit: roomFits(piece.dimsCm, [{ name: view.room!.name, wallCm: view.room!.wallCm }])[0] }));
  const judged = fit?.filter((entry) => entry.fit !== undefined) ?? [];

  return (
    <div className="flex flex-col gap-10" data-agent-id="board:room">
      <header className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-end">
        <div className="flex flex-col gap-3">
          <p className="text-slate text-xs tracking-[0.14em] uppercase">{t("kicker")}</p>
          <Title view={view} editable={editable} onRename={async (title) => void ((await send("", { method: "PATCH", body: JSON.stringify({ title }) })) !== null && (await reload()))} />
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="border-hairline inline-flex items-center gap-2 rounded-full border px-3 py-1" data-agent-id="board:presence" aria-live="polite">
              <span aria-hidden="true" className={cn("size-2 rounded-full", live ? "bg-success" : "bg-mist")} />
              {live ? t("live") : null}
              {present === null ? null : <span>{live ? " · " : null}{t("here", { count: present })}</span>}
            </span>
            {view.role === "viewer" ? <span className="text-slate">{t("viewer")}</span> : view.role === "editor" ? <span className="text-slate">{t("editor")}</span> : null}
          </div>
        </div>
        {view.role === "owner" ? <OwnerPanel view={view} rooms={rooms} onChange={async (patch) => void ((await send("", { method: "PATCH", body: JSON.stringify(patch) })) !== null && (await reload()))} /> : null}
      </header>

      {view.room === null || judged.length === 0 ? null : (
        <p className="text-slate text-sm" data-agent-id="board:room-fit">
          {t("fits", { fits: judged.filter((entry) => entry.fit!.fits).length, all: judged.length, room: view.room.name, wall: view.room.wallCm })}
        </p>
      )}

      {removed === null ? null : (
        <p role="status" className="bg-plinth rounded-plinth flex flex-wrap items-center gap-3 px-4 py-3 text-sm" data-agent-id="board:removed">
          {t("removed", { title: removed.title })}
          <Button size="sm" variant="secondary" onClick={() => void undoRemove()} data-agent-id="board:undo">
            {t("undo")}
          </Button>
        </p>
      )}

      {view.pieces.length === 0 ? (
        <p className="text-slate border-hairline rounded-plinth border border-dashed px-6 py-16 text-center" data-agent-id="board:empty">
          {t("emptyBoard")}
        </p>
      ) : (
        <ol className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3" data-agent-id="board:pieces">
          {view.pieces.map((piece, index) => (
            <li key={piece.id} className={cn("group flex flex-col gap-3", index === 0 && view.pieces.length > 2 && "lg:col-span-2 lg:row-span-2")} data-agent-id={`board:piece:${piece.slug}`}>
              <SmartLink href={`/p/${piece.slug}`} className="bg-plinth rounded-plinth relative block aspect-square overflow-hidden no-underline">
                {piece.image === null ? null : (
                  <Image src={piece.image.src} alt={piece.image.alt} fill sizes={index === 0 ? "(min-width: 1024px) 60vw, 100vw" : "(min-width: 1024px) 30vw, 50vw"} className="object-contain p-6 transition-transform duration-[var(--duration-stage)] group-hover:scale-[1.02]" />
                )}
              </SmartLink>
              <div className="flex items-start justify-between gap-3">
                <SmartLink href={`/p/${piece.slug}`} className="line-clamp-2 leading-snug">
                  {piece.title}
                </SmartLink>
                <span className="tabular shrink-0 text-sm font-medium">{price(piece.unitCents * piece.quantity)}</span>
              </div>
              {piece.quantity > 1 ? <p className="text-slate tabular -mt-2 text-xs">{`${piece.quantity} × ${price(piece.unitCents)}`}</p> : null}
              {fit === null ? null : (() => {
                const entry = fit.find((candidate) => candidate.piece.id === piece.id)?.fit;
                return entry === undefined ? null : <p className={cn("-mt-1 text-xs", entry.fits ? "text-success" : "text-danger")}>{entry.fits ? t("fitsOne", { room: entry.room }) : t("fitsNot", { room: entry.room })}</p>;
              })()}
              {editable ? (
                <PieceControls piece={piece} first={index === 0} last={index === view.pieces.length - 1} onChange={(patch) => void change(piece, patch)} onRemove={() => void remove(piece)} />
              ) : piece.note === null ? null : (
                <p className="text-slate text-sm italic">{piece.note}</p>
              )}
            </li>
          ))}
        </ol>
      )}

      <footer className="border-hairline bg-glass/95 sticky bottom-[calc(3.5rem+1px+env(safe-area-inset-bottom))] z-10 md:bottom-0 -mx-6 flex flex-wrap items-center gap-4 border-t px-6 py-4 backdrop-blur md:mx-0 md:rounded-[12px] md:border" data-agent-id="board:total">
        <div className="flex flex-col">
          <span className="text-slate text-xs">{t("total")}</span>
          <span className="font-display tabular text-2xl">{price(view.totalCents)}</span>
        </div>
        <span className="text-slate hidden text-xs sm:block">{t("totalNote", { country })}</span>
        <span className="flex-1" />
        {view.pieces.length === 0 ? null : (
          <Button onClick={() => void addAll()} data-agent-id="board:add-all">
            {t("addAll")}
          </Button>
        )}
        {cartNote === null ? null : (
          <p role="status" className="w-full text-sm" data-agent-id="board:cart-note">
            {cartNote}
          </p>
        )}
      </footer>

      {view.role === "owner" ? (
        <div>
          <Button
            variant="tertiary"
            className="text-danger"
            onClick={async () => {
              if (!window.confirm(t("deleteConfirm"))) return;
              if ((await send("", { method: "DELETE" })) !== null) router.push("/boards");
            }}
            data-agent-id="board:delete"
          >
            {t("delete")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/** The board's name, renamed in place by the owner or an editor. */
function Title({ view, editable, onRename }: { view: BoardView; editable: boolean; onRename: (title: string) => Promise<void> }) {
  const t = useTranslations("boards.board");
  const id = useId();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(view.title);
  if (!editing) {
    return (
      <div className="flex flex-wrap items-baseline gap-3">
        <h1 className="font-display text-4xl leading-tight text-balance md:text-5xl" data-agent-id="board:title">
          {view.title}
        </h1>
        {editable ? (
          <Button
            size="sm"
            variant="tertiary"
            onClick={() => {
              setDraft(view.title);
              setEditing(true);
            }}
            data-agent-id="board:rename"
          >
            {t("rename")}
          </Button>
        ) : null}
      </div>
    );
  }
  return (
    <form
      className="flex flex-col gap-2 sm:flex-row sm:items-end"
      onSubmit={async (event) => {
        event.preventDefault();
        const title = draft.trim();
        if (title === "" || title.length > 80) return;
        setEditing(false);
        await onRename(title);
      }}
    >
      <label htmlFor={id} className="sr-only">
        {t("renameLabel")}
      </label>
      {/* size={1}: no built-in width of twenty characters, which at this size would spill over the buttons on a phone. */}
      <input id={id} value={draft} maxLength={80} size={1} autoFocus onChange={(event) => setDraft(event.currentTarget.value)} className="font-display border-hairline focus:border-dusk w-full min-w-0 rounded-md border bg-white px-3 py-2 text-3xl outline-none sm:flex-1" data-agent-id="board:title-input" />
      <div className="flex gap-2">
        <Button type="submit" data-agent-id="board:title-save">
          {t("save")}
        </Button>
        <Button type="button" variant="secondary" onClick={() => setEditing(false)}>
          {t("cancel")}
        </Button>
      </div>
    </form>
  );
}

/** The owner's: the two links, new links, and the room the pieces are checked against. */
function OwnerPanel({ view, rooms, onChange }: { view: BoardView; rooms: string[]; onChange: (patch: { room?: string | null; newLinks?: true }) => Promise<void> }) {
  const t = useTranslations("boards.board");
  const roomId = useId();
  const [copied, setCopied] = useState<"view" | "edit" | null>(null);
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const locale = useLocale();
  const full = (href: string) => `${origin}/${locale}${href}`;
  const copy = async (which: "view" | "edit", href: string) => {
    await navigator.clipboard?.writeText(full(href)).catch(() => undefined);
    setCopied(which);
    setTimeout(() => setCopied(null), 2000);
  };
  return (
    <section aria-label={t("share")} className="border-hairline rounded-plinth flex flex-col gap-4 border p-4" data-agent-id="board:share">
      <h2 className="text-sm font-medium">{t("share")}</h2>
      {(["view", "edit"] as const).map((which) => (
        <div key={which} className="flex flex-col gap-1">
          <span className="text-slate text-xs">{which === "view" ? t("shareView") : t("shareEdit")}</span>
          <div className="flex gap-2">
            <input readOnly aria-label={which === "view" ? t("shareView") : t("shareEdit")} value={full(view.links![which])} onFocus={(event) => event.currentTarget.select()} className="border-hairline min-w-0 flex-1 truncate rounded-md border bg-white px-2 py-1.5 text-xs" data-agent-id={`board:link:${which}`} />
            <Button size="sm" variant="secondary" onClick={() => void copy(which, view.links![which])} data-agent-id={`board:copy:${which}`}>
              {copied === which ? t("copied") : t("copy")}
            </Button>
          </div>
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="secondary" onClick={() => void onChange({ newLinks: true })} data-agent-id="board:new-links">
          {t("newLinks")}
        </Button>
        <span className="text-slate text-xs">{t("newLinksNote")}</span>
      </div>
      {rooms.length === 0 ? null : (
        <div className="flex flex-col gap-1">
          <label htmlFor={roomId} className="text-slate text-xs">
            {t("room")}
          </label>
          <select id={roomId} value={view.room?.name ?? ""} onChange={(event) => void onChange({ room: event.currentTarget.value === "" ? null : event.currentTarget.value })} className="border-hairline rounded-md border bg-white px-2 py-1.5 text-sm" data-agent-id="board:room-select">
            <option value="">{t("noRoom")}</option>
            {rooms.map((room) => (
              <option key={room} value={room}>
                {room}
              </option>
            ))}
          </select>
        </div>
      )}
    </section>
  );
}

/** An editor's controls for one piece: quantity, a note, its place, and taking it off. */
function PieceControls({ piece, first, last, onChange, onRemove }: { piece: BoardPiece; first: boolean; last: boolean; onChange: (patch: { quantity?: number; note?: string | null; to?: number }) => void; onRemove: () => void }) {
  const t = useTranslations("boards.board");
  const noteId = useId();
  const [note, setNote] = useState(piece.note ?? "");
  // A note changed elsewhere (another person, live) shows here unless this person is typing in it.
  const [typing, setTyping] = useState(false);
  const [shown, setShown] = useState(piece.note);
  if (piece.note !== shown) {
    setShown(piece.note);
    if (!typing) setNote(piece.note ?? "");
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="border-hairline inline-flex items-center rounded-full border" role="group" aria-label={t("quantity")}>
          <button type="button" aria-label={t("less")} disabled={piece.quantity <= 1} onClick={() => onChange({ quantity: piece.quantity - 1 })} className="hover:bg-dusk/[0.05] grid size-9 place-items-center rounded-full disabled:opacity-40" data-agent-id={`board:less:${piece.slug}`}>
            −
          </button>
          <span className="tabular min-w-6 text-center text-sm" aria-live="polite">
            {piece.quantity}
          </span>
          <button type="button" aria-label={t("more")} disabled={piece.quantity >= 20} onClick={() => onChange({ quantity: piece.quantity + 1 })} className="hover:bg-dusk/[0.05] grid size-9 place-items-center rounded-full disabled:opacity-40" data-agent-id={`board:more:${piece.slug}`}>
            +
          </button>
        </div>
        <button type="button" aria-label={t("moveEarlier")} disabled={first} onClick={() => onChange({ to: piece.position - 1 })} className="border-hairline hover:bg-dusk/[0.05] grid size-9 place-items-center rounded-full border disabled:opacity-40" data-agent-id={`board:earlier:${piece.slug}`}>
          ←
        </button>
        <button type="button" aria-label={t("moveLater")} disabled={last} onClick={() => onChange({ to: piece.position + 1 })} className="border-hairline hover:bg-dusk/[0.05] grid size-9 place-items-center rounded-full border disabled:opacity-40" data-agent-id={`board:later:${piece.slug}`}>
          →
        </button>
        <span className="flex-1" />
        <Button size="sm" variant="tertiary" onClick={onRemove} data-agent-id={`board:remove:${piece.slug}`}>
          {t("remove")}
        </Button>
      </div>
      <label htmlFor={noteId} className="sr-only">
        {t("note")}
      </label>
      <input
        id={noteId}
        value={note}
        maxLength={200}
        placeholder={t("notePlaceholder")}
        onFocus={() => setTyping(true)}
        onChange={(event) => setNote(event.currentTarget.value)}
        onBlur={() => {
          setTyping(false);
          if (note.trim() !== (piece.note ?? "")) onChange({ note: note.trim() === "" ? null : note.trim() });
        }}
        className="border-hairline focus:border-dusk rounded-md border bg-transparent px-2 py-1.5 text-sm italic outline-none"
        data-agent-id={`board:note:${piece.slug}`}
      />
    </div>
  );
}
