"use client";

/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * The instant search pop-up: results while you type, recent searches kept on this device.
 */

import Image from "next/image";
import { useLocale, useTranslations } from "next-intl";
import { Fragment, useEffect, useId, useRef, useState } from "react";

import { forgetRecent, readRecent, rememberSearch } from "@/components/search/search-events";
import { DialogContent, DialogRoot } from "@/components/ui/dialog";
import { useRouter } from "@/i18n/navigation";
import { formatMoney, money } from "@/lib/commerce/money";
import { cn } from "@/lib/ui/cn";

/**
 * docs/adr/034. An ARIA 1.2 combobox inside a dialog: focus stays in the
 * field, the arrow keys move through the options (announced through
 * `aria-activedescendant`), Enter opens the chosen one or the full results,
 * and Escape closes and returns focus to what opened it. The header's search
 * is still a plain link to /search, so everything works before (and without)
 * JavaScript; this only takes over the click.
 *
 * The results come from the same endpoint and the same graded search as the
 * results page (`/api/search`, flagged `instant` so keystrokes are not counted
 * as searches). Only a submitted search, or an opened result, is remembered.
 */

type Result = {
  id: string;
  slug: string;
  title: string;
  brand: string | null;
  priceCents: number;
  currency: string;
  inStock: boolean;
  image: string | null;
};

type Status = "idle" | "loading" | "done" | "error";

/** A keystroke pause before asking, so a fast typist sends one request, not six. */
const DEBOUNCE_MS = 150;
/** Shown only for slower answers, so a quick one never flashes a "searching" line. */
const SLOW_MS = 300;
/** How many trending terms the empty pop-up offers. */
const TRENDING_SHOWN = 5;
const RESULT_LIMIT = 6;

export function InstantSearch({ initialQuery = "", onClose }: { initialQuery?: string; onClose: () => void }) {
  const t = useTranslations("instantSearch");
  const locale = useLocale();
  const router = useRouter();
  const ids = useId();
  const listId = `${ids}-list`;

  const [query, setQuery] = useState(initialQuery);
  // The answer and the query it answers: a stale answer is simply not this query's (no reset needed).
  const [answer, setAnswer] = useState<{ query: string; results: Result[]; failed: boolean } | null>(null);
  const [slowFor, setSlowFor] = useState<string | null>(null);
  // The chosen option, with the list it was chosen in: a new list starts with nothing chosen, so Enter means "search for this".
  const [chosen, setChosen] = useState<{ list: string; index: number }>({ list: "", index: -1 });
  // The pop-up only ever renders in the browser (it is loaded on demand), so the device's list is there to read.
  const [recent, setRecent] = useState<string[]>(() => readRecent());
  // "Trending now" (docs/adr/039): what several people searched for lately, the same list for everyone.
  const [trending, setTrending] = useState<string[]>([]);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/search/trending", { signal: controller.signal })
      .then((response) => (response.ok ? (response.json() as Promise<{ terms: string[] }>) : { terms: [] }))
      .then((body) => setTrending(body.terms.slice(0, TRENDING_SHOWN)))
      .catch(() => {});
    return () => controller.abort();
  }, []);

  const trimmed = query.trim();
  const current = answer !== null && answer.query === trimmed ? answer : null;
  const results = current?.results ?? [];
  const status: Status = trimmed === "" ? "idle" : current === null ? "loading" : current.failed ? "error" : "done";
  const slow = slowFor === trimmed;

  useEffect(() => {
    if (trimmed === "") return;
    const controller = new AbortController();
    const slowTimer = window.setTimeout(() => setSlowFor(trimmed), SLOW_MS);
    const timer = window.setTimeout(async () => {
      try {
        const params = new URLSearchParams({ q: trimmed.slice(0, 200), locale, limit: String(RESULT_LIMIT), instant: "1" });
        const response = await fetch(`/api/search?${params.toString()}`, { signal: controller.signal });
        if (!response.ok) throw new Error(`search ${response.status}`);
        const body = (await response.json()) as { results: Result[] };
        setAnswer({ query: trimmed, results: body.results, failed: false });
      } catch (error) {
        if (controller.signal.aborted) return;
        console.warn("instant search failed", error);
        setAnswer({ query: trimmed, results: [], failed: true });
      } finally {
        window.clearTimeout(slowTimer);
      }
    }, DEBOUNCE_MS);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
      window.clearTimeout(slowTimer);
    };
  }, [trimmed, locale]);

  // The options, in the order the arrow keys walk them.
  type Option = { key: string; kind: "recent"; text: string } | { key: string; kind: "trending"; text: string } | { key: string; kind: "result"; result: Result } | { key: string; kind: "all" };
  const recentWords = new Set(recent.map((text) => text.toLocaleLowerCase()));
  const options: Option[] =
    trimmed === ""
      ? [
          ...recent.map((text, index) => ({ key: `recent-${index}`, kind: "recent" as const, text })),
          ...trending.filter((text) => !recentWords.has(text)).map((text, index) => ({ key: `trending-${index}`, kind: "trending" as const, text })),
        ]
      : [
          ...results.map((result) => ({ key: result.id, kind: "result" as const, result })),
          ...(status === "done" ? [{ key: "all", kind: "all" as const }] : []),
        ];
  const listKey = `${trimmed}|${status}|${recent.length}|${trending.length}`;
  const active = chosen.list === listKey ? chosen.index : -1;
  const setActive = (index: number) => setChosen({ list: listKey, index });

  const searchAll = (text: string) => {
    const value = text.trim();
    if (value === "") return;
    rememberSearch(value);
    onClose();
    router.push(`/search?${new URLSearchParams({ q: value }).toString()}`);
  };

  const choose = (option: Option) => {
    if (option.kind === "recent" || option.kind === "trending") {
      setQuery(option.text);
      input.current?.focus();
      return;
    }
    if (option.kind === "all") {
      searchAll(trimmed);
      return;
    }
    rememberSearch(trimmed);
    onClose();
    router.push(`/p/${option.result.slug}`);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (options.length === 0) return;
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      // Walk -1 (the field itself), 0 … n-1, and wrap round.
      const next = active + step;
      setActive(next < -1 ? options.length - 1 : next >= options.length ? -1 : next);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const option = active >= 0 ? options[active] : undefined;
      if (option !== undefined) choose(option);
      else searchAll(trimmed);
    }
  };

  const euro = (result: Result) => formatMoney(money(result.priceCents, result.currency), locale, { hideDecimalsWhenWhole: true });
  const activeId = active >= 0 && options[active] !== undefined ? `${ids}-${options[active].key}` : undefined;

  // One sentence for screen readers when the results change (never on every keystroke).
  const announcement =
    trimmed === "" || status === "loading" || status === "idle"
      ? ""
      : status === "error"
        ? t("error")
        : t("count", { count: results.length });

  return (
    <DialogRoot open onOpenChange={(open) => !open && onClose()}>
      <DialogContent title={t("title")} hideTitle className="top-[12vh] max-w-2xl translate-y-0 p-4 md:top-[14vh]">
        <div className="flex flex-col gap-3" data-agent-id="search:instant">
          <form
            role="search"
            onSubmit={(event) => {
              event.preventDefault();
              searchAll(trimmed);
            }}
            className="pr-12"
          >
            <label htmlFor={`${ids}-field`} className="sr-only">
              {t("label")}
            </label>
            <input
              ref={input}
              id={`${ids}-field`}
              type="search"
              role="combobox"
              aria-expanded={options.length > 0}
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={activeId}
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={onKeyDown}
              placeholder={t("placeholder")}
              maxLength={200}
              autoComplete="off"
              enterKeyHint="search"
              data-agent-id="input:instant-search"
              className="border-hairline text-dusk placeholder:text-slate/70 rounded-plinth h-12 w-full border bg-white px-4 text-base"
            />
          </form>

          <p className="sr-only" role="status" aria-live="polite">
            {announcement}
          </p>

          {trimmed === "" && recent.length > 0 ? (
            <div className="flex items-baseline justify-between">
              <p className="text-slate text-xs tracking-[0.08em] uppercase" id={`${ids}-recent`}>
                {t("recent")}
              </p>
              <button
                type="button"
                onClick={() => {
                  forgetRecent();
                  setRecent([]);
                  input.current?.focus();
                }}
                className="text-slate hover:text-dusk min-h-6 cursor-pointer text-xs underline underline-offset-4"
                data-agent-id="search:forget-recent"
              >
                {t("forgetRecent")}
              </button>
            </div>
          ) : null}

          <ul id={listId} role="listbox" aria-label={trimmed === "" ? t("suggestions") : t("results")} className="flex flex-col">
            {options.map((option, index) => (
              <Fragment key={option.key}>
              {option.kind === "trending" && options[index - 1]?.kind !== "trending" ? (
                <li aria-hidden="true" className="text-slate mt-3 mb-1 px-3 text-xs tracking-[0.08em] uppercase">
                  {t("trending")}
                </li>
              ) : null}
              <OptionRow
                key={option.key}
                id={`${ids}-${option.key}`}
                selected={index === active}
                onChoose={() => choose(option)}
                onHover={() => setActive(index)}
                agentId={option.kind === "recent" ? `search:recent-${index}` : option.kind === "trending" ? `search:trending-${index}` : option.kind === "all" ? "search:see-all" : `product:${option.result.id}`}
                className={option.kind === "all" ? "border-hairline mt-1 border-t pt-3" : undefined}
              >
                {option.kind === "recent" ? (
                  <>
                    <ClockGlyph />
                    <span className="truncate">{option.text}</span>
                  </>
                ) : option.kind === "trending" ? (
                  <>
                    <TrendGlyph />
                    <span className="truncate">
                      <span className="sr-only">{t("trendingPrefix")} </span>
                      {option.text}
                    </span>
                  </>
                ) : option.kind === "all" ? (
                  <>
                    <SearchGlyph />
                    <span>{t("seeAll", { query: trimmed })}</span>
                  </>
                ) : (
                  <>
                    <span className="bg-plinth rounded-plinth relative size-12 shrink-0 overflow-hidden" aria-hidden="true">
                      {option.result.image === null ? null : <Image src={option.result.image} alt="" fill sizes="48px" className="object-contain mix-blend-multiply" />}
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate">{option.result.title}</span>
                      {option.result.brand === null ? null : <span className="text-slate truncate text-xs">{option.result.brand}</span>}
                    </span>
                    <span className="shrink-0 text-sm tabular-nums">{euro(option.result)}</span>
                    {option.result.inStock ? null : <span className="text-slate shrink-0 text-xs">{t("soldOut")}</span>}
                  </>
                )}
              </OptionRow>
              </Fragment>
            ))}
          </ul>

          {trimmed !== "" && status === "done" && results.length === 0 ? (
            <p className="text-slate px-3 text-sm">{t("nothing", { query: trimmed })}</p>
          ) : null}
          {trimmed !== "" && slow && status !== "done" && status !== "error" ? <p className="text-slate px-3 text-sm">{t("searching")}</p> : null}
          {status === "error" ? <p className="text-slate px-3 text-sm">{t("error")}</p> : null}
          {trimmed === "" && recent.length === 0 ? <p className="text-slate px-3 text-sm">{t("hint")}</p> : null}
        </div>
      </DialogContent>
    </DialogRoot>
  );
}

/** One option of the list. The mouse never takes focus from the field (mouse down is cancelled), so typing carries on. */
function OptionRow({ id, selected, onChoose, onHover, agentId, className, children }: { id: string; selected: boolean; onChoose: () => void; onHover: () => void; agentId: string; className?: string; children: React.ReactNode }) {
  return (
    <li
      id={id}
      role="option"
      aria-selected={selected}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onChoose}
      onMouseEnter={onHover}
      data-agent-id={agentId}
      className={cn("rounded-plinth flex min-h-11 cursor-pointer items-center gap-3 px-3 py-2", selected ? "bg-dusk/[0.06]" : "hover:bg-dusk/[0.04]", className)}
    >
      {children}
    </li>
  );
}

function SearchGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="text-slate size-5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <circle cx="11" cy="11" r="6.5" />
      <path d="M16 16l4.5 4.5" strokeLinecap="round" />
    </svg>
  );
}

function ClockGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="text-slate size-5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8v4.5l3 1.5" strokeLinecap="round" />
    </svg>
  );
}

function TrendGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="text-slate size-5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <path d="M4 16l5-5 3.5 3.5L20 7" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M15 7h5v5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
