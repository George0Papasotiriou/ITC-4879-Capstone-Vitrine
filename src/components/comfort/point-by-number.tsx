"use client";

/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Point by number: every control on screen gets a number, and typing or saying the number presses it.
 */

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * docs/adr/032. For someone who cannot use a mouse, or can only speak, the
 * long way to a control is tabbing through everything before it. Numbers make
 * every visible control one step away: press "n" (or say "show numbers"),
 * then type (or say) the number. It works on every page, because it reads the
 * page as it is rather than a list kept by hand.
 *
 * The badges are hidden from screen readers, which have their own ways to
 * reach controls; what is happening is announced in a status line instead.
 */

/** Tells the numbers to show, hide or press one: `{ show: true }`, `{ show: "toggle" }`, `{ pick: 12 }`. */
export const NUMBERS_EVENT = "vitrine:numbers";
export type NumbersRequest = { show?: boolean | "toggle"; pick?: number };

export function requestNumbers(request: NumbersRequest): void {
  window.dispatchEvent(new CustomEvent<NumbersRequest>(NUMBERS_EVENT, { detail: request }));
}

const CONTROLS = [
  "a[href]",
  "button:not([disabled])",
  "input:not([type='hidden']):not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "summary",
  "[role='button']",
  "[role='tab']",
  "[role='radio']",
  "[role='checkbox']",
  "[role='switch']",
].join(", ");

/** Waiting this long after the last digit presses the control, unless a longer number could still follow. */
const SETTLE_MS = 900;
const MOST = 99;

type Target = { number: number; element: HTMLElement; x: number; y: number };

function isField(element: HTMLElement): boolean {
  return element.matches("input:not([type='checkbox'], [type='radio'], [type='button'], [type='submit']), select, textarea, [contenteditable='true']");
}

/** The controls a person can see and reach right now, top to bottom, left to right. */
function visibleControls(): HTMLElement[] {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const seen: { element: HTMLElement; box: DOMRect }[] = [];
  for (const element of document.querySelectorAll<HTMLElement>(CONTROLS)) {
    // Behind an open dialog, or leaving: not reachable.
    if (element.closest("[aria-hidden='true'], [inert], [data-point-number]") !== null) continue;
    const box = element.getBoundingClientRect();
    if (box.width < 4 || box.height < 4 || box.bottom < 0 || box.right < 0 || box.top > height || box.left > width) continue;
    const style = getComputedStyle(element);
    if (style.visibility === "hidden" || style.display === "none" || Number(style.opacity) === 0) continue;
    // A stretched link covering a tile and the heading link inside it are one control: keep the first.
    if (seen.some((other) => Math.abs(other.box.left - box.left) < 2 && Math.abs(other.box.top - box.top) < 2)) continue;
    seen.push({ element, box });
  }
  return seen
    // Rows by their middle, not their top: a tall button and the words beside it are one row to the eye.
    .sort((a, b) => Math.round((a.box.top + a.box.height / 2) / 16) - Math.round((b.box.top + b.box.height / 2) / 16) || a.box.left - b.box.left)
    .slice(0, MOST)
    .map((entry) => entry.element);
}

export function PointByNumber() {
  const t = useTranslations("comfort.numbers");
  const [shown, setShown] = useState(false);
  const [targets, setTargets] = useState<Target[]>([]);
  const [typed, setTyped] = useState("");
  const [status, setStatus] = useState("");
  const settle = useRef<number | undefined>(undefined);

  const measure = useCallback((): Target[] => {
    const found = visibleControls().map((element, index) => {
      const box = element.getBoundingClientRect();
      return { number: index + 1, element, x: Math.max(2, Math.min(window.innerWidth - 28, box.left - 6)), y: Math.max(2, Math.min(window.innerHeight - 20, box.top - 8)) };
    });
    setTargets(found);
    return found;
  }, []);

  const hide = useCallback(() => {
    window.clearTimeout(settle.current);
    setShown(false);
    setTyped("");
    setTargets([]);
  }, []);

  const press = useCallback(
    (number: number) => {
      const target = targets.find((candidate) => candidate.number === number);
      hide();
      if (target === undefined) {
        setStatus(t("missing", { number }));
        return;
      }
      target.element.focus();
      if (!isField(target.element)) target.element.click();
      setStatus(t("pressed", { number }));
    },
    [hide, t, targets],
  );

  const show = useCallback(() => {
    const found = measure();
    setShown(true);
    setTyped("");
    setStatus(t("shown", { count: found.length }));
  }, [measure, t]);

  // Asked from elsewhere: a shortcut, the voice, the comfort panel.
  useEffect(() => {
    const onRequest = (event: Event) => {
      const request = (event as CustomEvent<NumbersRequest>).detail;
      if (request.show === "toggle") (shown ? hide : show)();
      else if (request.show === true) show();
      else if (request.show === false) hide();
      if (typeof request.pick === "number") press(request.pick);
    };
    window.addEventListener(NUMBERS_EVENT, onRequest);
    return () => window.removeEventListener(NUMBERS_EVENT, onRequest);
  }, [hide, press, show, shown]);

  // While shown: numbers follow the page as it scrolls, and digits are read from the keyboard.
  useEffect(() => {
    if (!shown) return;
    let frame = 0;
    const remeasure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => void measure());
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key === "Escape") {
        event.preventDefault();
        hide();
        setStatus(t("hidden"));
        return;
      }
      if (event.key === "Backspace") {
        event.preventDefault();
        setTyped((value) => value.slice(0, -1));
        return;
      }
      if (event.key === "Enter" && typed !== "") {
        event.preventDefault();
        press(Number(typed));
        return;
      }
      if (/^[0-9]$/.test(event.key)) {
        event.preventDefault();
        const next = `${typed}${event.key}`.replace(/^0+/, "");
        setTyped(next);
        window.clearTimeout(settle.current);
        // Pressed at once when no longer number could still follow; otherwise after a pause.
        const longer = targets.some((target) => String(target.number).startsWith(next) && String(target.number) !== next);
        if (next !== "" && !longer) press(Number(next));
        else if (next !== "") settle.current = window.setTimeout(() => press(Number(next)), SETTLE_MS);
      }
    };
    window.addEventListener("scroll", remeasure, { passive: true });
    window.addEventListener("resize", remeasure);
    window.addEventListener("keydown", onKey, true);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", remeasure);
      window.removeEventListener("resize", remeasure);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [hide, measure, press, shown, t, targets, typed]);

  return (
    <>
      <p role="status" className="sr-only" data-agent-id="numbers:status">
        {status}
      </p>
      {!shown ? null : (
        <div aria-hidden="true" data-point-number="" data-agent-id="numbers:layer">
          {targets.map((target) => (
            <span
              key={target.number}
              className="point-number"
              style={{ left: target.x, top: target.y }}
              data-match={typed !== "" && String(target.number).startsWith(typed) ? "true" : undefined}
              data-agent-id={`numbers:${target.number}`}
            >
              {target.number}
            </span>
          ))}
          <span className="bg-dusk text-glass rounded-plinth fixed right-4 bottom-20 z-[86] px-3 py-2 text-sm shadow-lg md:bottom-4" data-agent-id="numbers:prompt">
            {typed === "" ? t("prompt") : t("typed", { number: typed })}
          </span>
        </div>
      )}
    </>
  );
}
