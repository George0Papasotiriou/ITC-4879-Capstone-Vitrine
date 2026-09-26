"use client";

/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * The Concierge dock: a side panel on wide screens and a bottom sheet on phones, with the conversation and its actions.
 */

import { usePathname } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent, type PointerEvent } from "react";

import { ActionTimeline } from "@/components/concierge/action-timeline";
import { AssistantPart } from "@/components/concierge/concierge-parts";
import { useConcierge } from "@/components/concierge/concierge-provider";
import { VoiceBar } from "@/components/concierge/voice-bar";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/ui/cn";
import { DURATION } from "@/lib/ui/motion";
import { usePresence } from "@/lib/ui/use-presence";
import { prefersReducedMotion } from "@/lib/ui/use-reduced-motion";

/**
 * docs/PLAN.md Phase 6 step 3. The dock stays open across pages because its
 * state lives in the layout. It is a complementary region, not a modal: the
 * shopper can keep using the page beside it on a wide screen. Escape closes it
 * and returns focus to where it was; the conversation is a live log for screen
 * readers; the input is always one tab away.
 *
 * Motion (docs/adr/031): it rises from the bottom on a phone and slides in
 * from the side above it, and leaves faster than it came. On a phone it can be
 * pulled down by its handle, and a pull let go past a quarter of its height
 * (or flicked) closes it from where the finger left it; the close button does
 * the same for anyone who does not drag. New messages rise into the
 * conversation, and the conversation follows them smoothly.
 */

/** A pull this far, or this fast, closes the sheet. */
const CLOSE_SHARE = 0.25;
const CLOSE_SPEED = 0.6; // px per ms

function suggestionSet(pathname: string, locale: string): "home" | "product" | "listing" | "cart" | "other" {
  const path = pathname.replace(new RegExp(`^/${locale}(?=/|$)`), "") || "/";
  if (path === "/") return "home";
  if (path.startsWith("/p/")) return "product";
  if (path.startsWith("/c") || path.startsWith("/search")) return "listing";
  if (path.startsWith("/cart")) return "cart";
  return "other";
}

export function ConciergeDock() {
  const t = useTranslations("concierge");
  const locale = useLocale();
  const pathname = usePathname();
  const { open, setOpen, chat, ask, refusal, reset, approve } = useConcierge();
  const [text, setText] = useState("");
  const input = useRef<HTMLTextAreaElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const log = useRef<HTMLDivElement>(null);
  const id = useId();
  const busy = chat.status === "submitted" || chat.status === "streaming";
  const demo = chat.messages.some((message) => (message.metadata as { demo?: boolean } | undefined)?.demo === true);
  const presence = usePresence(open, DURATION.quick);
  const sheet = useRef<HTMLElement>(null);
  const drag = useRef<{ startY: number; startedAt: number; dy: number } | null>(null);
  // Messages already there when the dock opened do not rise again; only new ones do.
  const [seen, setSeen] = useState(0);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setSeen(chat.messages.length);
  }

  useEffect(() => {
    if (!open) return;
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    input.current?.focus();
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      returnFocus.current?.focus();
    };
  }, [open, setOpen]);

  // Follow the conversation as it grows.
  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight, behavior: prefersReducedMotion() ? "auto" : "smooth" });
  }, [chat.messages]);

  const startPull = (event: PointerEvent<HTMLDivElement>) => {
    if (sheet.current === null) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { startY: event.clientY, startedAt: performance.now(), dy: 0 };
    sheet.current.style.transition = "none";
  };
  const pull = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current === null || sheet.current === null) return;
    // Only downwards: the sheet follows the finger.
    drag.current.dy = Math.max(0, event.clientY - drag.current.startY);
    sheet.current.style.transform = `translateY(${drag.current.dy}px)`;
  };
  const letGo = () => {
    const pulled = drag.current;
    const element = sheet.current;
    drag.current = null;
    if (pulled === null || element === null) return;
    const speed = pulled.dy / Math.max(1, performance.now() - pulled.startedAt);
    if (pulled.dy > element.offsetHeight * CLOSE_SHARE || speed > CLOSE_SPEED) {
      // It leaves from where the finger let go (`--sheet-drag` in globals.css).
      element.style.setProperty("--sheet-drag", `${pulled.dy}px`);
      element.style.transform = "";
      element.style.transition = "";
      setOpen(false);
      return;
    }
    // Not far enough: it settles back on the spring.
    element.style.transition = "transform var(--duration-calm) var(--ease-spring)";
    element.style.transform = "";
  };

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    if (busy || text.trim() === "") return;
    ask(text);
    setText("");
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) submit(event);
  };
  const suggestions = Object.values(t.raw(`suggestions.${suggestionSet(pathname, locale)}`) as Record<string, string>);

  if (!presence.mounted) return null;
  return (
    <>
      {/* On phones the sheet covers most of the page, so a tap outside closes it. */}
      <button type="button" aria-label={t("close")} tabIndex={-1} data-state={presence.state} className="bg-dusk/30 animate-overlay fixed inset-0 z-40 md:hidden" onClick={() => setOpen(false)} />
      <section
        ref={sheet}
        aria-labelledby={`${id}-title`}
        data-concierge-dock=""
        data-state={presence.state}
        data-agent-id="concierge:dock"
        // Leaving, it is already gone for assistive technology and the keyboard.
        inert={!open}
        className={cn(
          "bg-glass border-hairline animate-dock fixed z-50 flex flex-col shadow-[0_24px_48px_-12px_color-mix(in_oklab,var(--color-dusk)_22%,transparent)]",
          "inset-x-0 bottom-0 h-[85dvh] rounded-t-[12px] border-t",
          "md:inset-x-auto md:top-0 md:right-0 md:bottom-0 md:h-dvh md:w-[420px] md:rounded-none md:border-t-0 md:border-l",
        )}
      >
        {/* The handle a thumb pulls the sheet down by; phones only. The close button is its keyboard equivalent. */}
        <div
          aria-hidden="true"
          className="flex h-5 shrink-0 cursor-grab touch-none items-center justify-center md:hidden"
          onPointerDown={startPull}
          onPointerMove={pull}
          onPointerUp={letGo}
          onPointerCancel={letGo}
          data-agent-id="concierge:handle"
        >
          <span className="bg-dusk/25 h-1 w-10 rounded-full" />
        </div>
        <header className="border-hairline flex items-center gap-3 border-b px-5 py-3 max-md:pt-1">
          <span className="bg-lumen size-2.5 rounded-full" aria-hidden="true" />
          <h2 id={`${id}-title`} className="font-display text-lg">
            {t("panelLabel")}
          </h2>
          {demo ? (
            <span className="bg-plinth text-dusk rounded-full px-2 py-0.5 text-xs font-medium" title={t("demoExplain")} data-agent-id="concierge:demo">
              {t("demoBadge")}
            </span>
          ) : null}
          <span className="flex-1" />
          {chat.messages.length > 0 ? (
            <Button variant="tertiary" size="sm" onClick={reset} data-agent-id="concierge:new">
              {t("newChat")}
            </Button>
          ) : null}
          <Button variant="tertiary" size="sm" onClick={() => setOpen(false)} aria-label={t("close")} data-agent-id="concierge:close">
            <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" strokeLinecap="round" />
            </svg>
          </Button>
        </header>

        {/* Speaking sits between the title and the conversation: it is a way in, not another Concierge (docs/adr/026). */}
        <VoiceBar />

        <div ref={log} role="log" aria-live="polite" aria-relevant="additions" className="flex-1 overflow-y-auto px-5 py-4" data-agent-id="concierge:log">
          {chat.messages.length === 0 ? (
            <div className="flex flex-col gap-4">
              <p className="text-slate">{t("intro")}</p>
              <p className="text-slate text-xs">{t("demoExplain")}</p>
              <div>
                <p className="text-slate mb-2 text-sm">{t("suggestionsLabel")}</p>
                <ul className="flex flex-wrap gap-2">
                  {suggestions.map((suggestion) => (
                    <li key={suggestion}>
                      <button type="button" className="border-hairline hover:border-dusk/40 rounded-full border px-3 py-1.5 text-sm transition-colors" onClick={() => ask(suggestion)}>
                        {suggestion}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ) : (
            <ol className="flex flex-col gap-5">
              {chat.messages.map((message, position) => {
                const fresh = position >= seen;
                const words = message.parts.map((part) => (part.type === "text" ? part.text : "")).join("");
                return (
                  <li key={message.id} className={cn("flex flex-col gap-3", message.role === "user" && "items-end", fresh && "animate-rise")} data-agent-id={`concierge:message:${message.role}`}>
                    {message.role === "user" ? (
                      // A spoken turn whose words are still arriving shows an ellipsis until they do.
                      <p className="bg-dusk text-glass rounded-plinth max-w-[85%] px-3 py-2 whitespace-pre-line">{words === "" ? "…" : words}</p>
                    ) : (
                      message.parts.map((part, index) => (
                        // Keyed by state as well, so a card that becomes its result rises in again, in place.
                        <div key={`${index}-${part.type !== "text" && "state" in part ? part.state : part.type}`} className={fresh ? "animate-rise" : undefined}>
                          <AssistantPart part={part} onApprove={approve} />
                        </div>
                      ))
                    )}
                  </li>
                );
              })}
            </ol>
          )}
          {refusal === null ? null : (
            <p role="alert" className="text-danger mt-4 text-sm" data-agent-id="concierge:refusal">
              {t.has(`errors.${refusal}`) ? t(`errors.${refusal}`) : t("errors.generic")}
            </p>
          )}
          <ActionTimeline className="mt-6" />
        </div>

        <form onSubmit={submit} className="border-hairline flex items-end gap-2 border-t p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <label htmlFor={`${id}-input`} className="sr-only">
            {t("placeholder")}
          </label>
          <textarea
            ref={input}
            id={`${id}-input`}
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={onKeyDown}
            rows={1}
            maxLength={2000}
            placeholder={t("placeholder")}
            className="border-hairline text-dusk rounded-plinth hover:border-dusk/35 max-h-32 min-h-11 flex-1 resize-none border bg-white px-3 py-2.5"
            data-agent-id="concierge:input"
          />
          {busy ? (
            <Button type="button" variant="secondary" onClick={() => void chat.stop()} data-agent-id="concierge:stop">
              {t("stop")}
            </Button>
          ) : (
            <Button type="submit" disabled={text.trim() === ""} data-agent-id="concierge:send">
              {t("send")}
            </Button>
          )}
        </form>
      </section>
    </>
  );
}
