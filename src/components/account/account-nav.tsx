"use client";

/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * The account page's quick navigation: every section one click away, and the one being read marked.
 */

import { useEffect, useRef, useState } from "react";

import { SmartLink } from "@/components/ui/smart-link";
import { cn } from "@/lib/ui/cn";
import { prefersReducedMotion } from "@/lib/ui/use-reduced-motion";

/**
 * docs/adr/067. On wide screens a column that stays beside the page as it
 * scrolls; on phones a row of chips under the header that scrolls sideways.
 * The links are plain anchors (#orders, #passkeys…), so they work before any
 * script loads; with script, the jump is smooth unless motion is reduced, and
 * the section being read is marked with aria-current="location".
 */

export type AccountNavItem = { id: string; label: string; level?: 0 | 1 };
export type AccountNavPage = { href: string; label: string; agentId: string };

/** The section counts as being read once its heading is above this share of the window. */
const READING_LINE = 0.3;

export function AccountNav({ label, items, more }: { label: string; items: readonly AccountNavItem[]; more: { label: string; pages: readonly AccountNavPage[] } }) {
  const [current, setCurrent] = useState<string | null>(items[0]?.id ?? null);
  const listRef = useRef<HTMLUListElement | null>(null);

  useEffect(() => {
    const targets = items.map((item) => document.getElementById(item.id)).filter((element): element is HTMLElement => element !== null);
    if (targets.length === 0) return;
    // The last section whose heading has passed the reading line is the one being read.
    const update = () => {
      const line = window.innerHeight * READING_LINE;
      let reading = targets[0]!.id;
      for (const target of targets) if (target.getBoundingClientRect().top <= line) reading = target.id;
      // At the very bottom, the last section is being read even if its heading never reached the line.
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) reading = targets.at(-1)!.id;
      setCurrent(reading);
    };
    update();
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [items]);

  // On phones the marked chip is kept in view in its row.
  useEffect(() => {
    if (current === null || listRef.current === null) return;
    const chip = listRef.current.querySelector<HTMLElement>(`[data-section="${current}"]`);
    if (chip === null || listRef.current.scrollWidth <= listRef.current.clientWidth) return;
    const row = listRef.current;
    const left = chip.offsetLeft - row.clientWidth / 2 + chip.clientWidth / 2;
    row.scrollTo({ left, behavior: prefersReducedMotion() ? "auto" : "smooth" });
  }, [current]);

  const jump = (event: React.MouseEvent<HTMLAnchorElement>, id: string) => {
    const target = document.getElementById(id);
    if (target === null || event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    target.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
    window.history.replaceState(null, "", `#${id}`);
    setCurrent(id);
    // Keyboard and screen-reader users continue from the section they chose.
    target.setAttribute("tabindex", "-1");
    target.focus({ preventScroll: true });
  };

  return (
    <nav
      aria-label={label}
      data-agent-id="account:nav"
      className={cn(
        "border-hairline bg-glass/95 sticky top-16 z-30 -mx-6 border-b px-6 backdrop-blur-sm md:-mx-10 md:px-10",
        "lg:top-24 lg:mx-0 lg:self-start lg:border-b-0 lg:bg-transparent lg:px-0 lg:backdrop-blur-none",
      )}
    >
      <p className="text-slate hidden text-xs font-medium tracking-wide lg:mb-3 lg:block">{label}</p>
      <ul ref={listRef} className="flex gap-2 overflow-x-auto py-2.5 [scrollbar-width:none] lg:flex-col lg:gap-0.5 lg:overflow-visible lg:py-0">
        {items.map((item) => {
          const active = current === item.id;
          return (
            <li key={item.id} data-section={item.id} className={cn("shrink-0", item.level === 1 && "lg:pl-3")}>
              <a
                href={`#${item.id}`}
                onClick={(event) => jump(event, item.id)}
                aria-current={active ? "location" : undefined}
                data-agent-id={`account:nav-${item.id}`}
                className={cn(
                  "rounded-plinth flex min-h-9 items-center px-3 text-sm whitespace-nowrap no-underline",
                  "duration-quick ease-standard transition-colors",
                  "border-hairline border lg:border-0 lg:border-l-2 lg:rounded-none lg:px-3 lg:whitespace-normal",
                  item.level === 1 ? "lg:text-[0.8125rem]" : "",
                  active
                    ? "bg-dusk text-glass border-dusk lg:text-dusk lg:border-dusk font-medium lg:bg-transparent"
                    : "text-slate hover:text-dusk hover:bg-dusk/[0.04] lg:border-transparent lg:hover:border-hairline",
                )}
              >
                {item.label}
              </a>
            </li>
          );
        })}
        {more.pages.length === 0 ? null : (
          <>
            <li aria-hidden="true" className="hidden lg:mt-4 lg:mb-1 lg:block">
              <span className="text-slate text-xs font-medium tracking-wide">{more.label}</span>
            </li>
            {more.pages.map((page) => (
              <li key={page.href} className="shrink-0">
                <SmartLink
                  href={page.href}
                  data-agent-id={page.agentId}
                  className={cn(
                    "rounded-plinth border-hairline text-slate hover:text-dusk flex min-h-9 items-center gap-1 border px-3 text-sm whitespace-nowrap no-underline",
                    "duration-quick ease-standard hover:bg-dusk/[0.04] transition-colors lg:border-0 lg:px-3 lg:whitespace-normal",
                  )}
                >
                  {page.label}
                  <span aria-hidden="true" className="text-xs">
                    ↗
                  </span>
                </SmartLink>
              </li>
            ))}
          </>
        )}
      </ul>
    </nav>
  );
}
