"use client";

/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * The header's categories menu: a button beside the wordmark that opens every department, category, kind and brand at once.
 */

import { useTranslations } from "next-intl";
import { Tabs } from "radix-ui";
import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from "react";

import { Link, usePathname } from "@/i18n/navigation";
import type { ResolvedGroup, ResolvedLink } from "@/lib/catalog/menu";
import { cn } from "@/lib/ui/cn";
import { DURATION } from "@/lib/ui/motion";
import { usePresence } from "@/lib/ui/use-presence";

/**
 * docs/adr/067. A disclosure, not an ARIA menu: one button with
 * aria-expanded opens a panel of ordinary links, which is what the links are,
 * and which screen readers and the keyboard already know how to use. The panel
 * follows the button in the document, so Tab goes from the button straight
 * into it.
 *
 * - Click, Enter or Space toggles it; with a mouse it also opens after a short
 *   hover and closes a moment after the pointer leaves, the way large shops do.
 * - Escape, a click outside, leaving with the keyboard, choosing a link or
 *   arriving on a new page closes it; Escape returns focus to the button.
 * - Departments are tabs: hovering or arrowing through them shows their
 *   columns. Only the open department is in the page, so the Concierge's page
 *   map (src/components/concierge/page-map.ts) never fills up with hidden links.
 * - The panel hangs from the header, which is the positioned parent: the
 *   header's backdrop blur would otherwise catch `fixed` children.
 */

const HOVER_OPEN_MS = 140;
const HOVER_CLOSE_MS = 260;

const wide = "(min-width: 768px)";
function subscribeWide(onChange: () => void) {
  const query = window.matchMedia(wide);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}
const useWide = () => useSyncExternalStore(subscribeWide, () => window.matchMedia(wide).matches, () => true);

export function CategoriesMenu({ groups }: { groups: readonly ResolvedGroup[] }) {
  const t = useTranslations("menu");
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const [group, setGroup] = useState<string>(groups[0]?.id ?? "home");
  const openedBy = useRef<"hover" | "click" | null>(null);
  const timer = useRef<number | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const isWide = useWide();
  const { mounted, state } = usePresence(open, DURATION.instant);
  const pathname = usePathname();

  const clearTimer = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  };
  const close = useCallback((returnFocus = false) => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    openedBy.current = null;
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  }, []);

  // A new page closes the menu (a link was followed, or the Concierge navigated).
  const [shownPath, setShownPath] = useState(pathname);
  if (pathname !== shownPath) {
    setShownPath(pathname);
    if (open) setOpen(false);
  }

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const inside = wrapperRef.current?.contains(document.activeElement) ?? false;
      close(inside);
    };
    const onPointer = (event: PointerEvent) => {
      if (wrapperRef.current !== null && !wrapperRef.current.contains(event.target as Node)) close();
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open, close]);

  useEffect(() => () => clearTimer(), []);

  const hoverOpen = (event: React.PointerEvent) => {
    if (event.pointerType !== "mouse" || !isWide) return;
    clearTimer();
    if (open) return;
    timer.current = window.setTimeout(() => {
      openedBy.current = "hover";
      setOpen(true);
    }, HOVER_OPEN_MS);
  };
  const hoverClose = (event: React.PointerEvent) => {
    if (event.pointerType !== "mouse" || !isWide) return;
    clearTimer();
    if (!open || openedBy.current !== "hover") return;
    timer.current = window.setTimeout(() => close(), HOVER_CLOSE_MS);
  };

  const onTriggerClick = () => {
    clearTimer();
    // A click on a menu the pointer has just opened keeps it open, rather than closing it under the cursor.
    if (open && openedBy.current === "hover") {
      openedBy.current = "click";
      return;
    }
    if (open) close();
    else {
      openedBy.current = "click";
      setOpen(true);
    }
  };

  const onBlur = (event: React.FocusEvent) => {
    const next = event.relatedTarget as Node | null;
    if (next !== null && wrapperRef.current !== null && !wrapperRef.current.contains(next)) close();
  };

  const linkClass = "text-dusk hover:text-dusk decoration-hairline hover:decoration-dusk inline-flex min-h-8 items-center py-1 text-sm underline-offset-4 hover:underline";
  const renderLink = (link: ResolvedLink, strong = false) => (
    <Link
      href={link.href}
      data-agent-id={`menu:${link.id}`}
      onClick={() => close()}
      className={cn(linkClass, strong && "font-medium text-base")}
    >
      {link.label}
    </Link>
  );

  return (
    <>
      <div ref={wrapperRef} onPointerEnter={hoverOpen} onPointerLeave={hoverClose} onBlur={onBlur}>
        <button
          ref={triggerRef}
          type="button"
          aria-expanded={open}
          aria-controls={mounted ? panelId : undefined}
          onClick={onTriggerClick}
          data-agent-id="nav:categories"
          className={cn(
            "text-dusk rounded-plinth press inline-flex h-11 items-center gap-2 px-2.5 md:px-3",
            "duration-quick ease-standard hover:bg-dusk/[0.05] transition-colors",
            open && "bg-dusk/[0.05]",
          )}
        >
          <GridGlyph />
          <span className="sr-only text-sm md:not-sr-only">{t("trigger")}</span>
          <ChevronGlyph open={open} />
        </button>

        {mounted ? (
          <div
            id={panelId}
            data-state={state}
            data-agent-id="menu:panel"
            className={cn(
              "animate-pop border-hairline bg-glass absolute inset-x-0 top-full z-10 border-b shadow-[0_24px_48px_-24px_rgb(0_0_0/0.25)]",
              "max-h-[calc(100dvh-4rem-3.5rem-env(safe-area-inset-bottom))] overflow-y-auto overscroll-contain md:max-h-[min(78vh,680px)]",
            )}
          >
            <nav aria-label={t("label")} className="mx-auto w-full max-w-[1440px] px-4 py-5 md:px-10 md:py-8">
              <Tabs.Root
                value={group}
                onValueChange={setGroup}
                orientation={isWide ? "vertical" : "horizontal"}
                className="flex flex-col gap-5 md:grid md:grid-cols-[220px_minmax(0,1fr)] md:gap-10"
              >
                <Tabs.List aria-label={t("groupsLabel")} className="border-hairline -mx-1 flex gap-1 overflow-x-auto px-1 md:mx-0 md:flex-col md:overflow-visible md:border-r md:px-0 md:pr-6">
                  {groups.map((entry) => (
                    <Tabs.Trigger
                      key={entry.id}
                      value={entry.id}
                      data-agent-id={`menu:tab-${entry.id}`}
                      onPointerEnter={(event) => {
                        if (event.pointerType === "mouse") setGroup(entry.id);
                      }}
                      className={cn(
                        "rounded-plinth text-slate shrink-0 cursor-pointer px-3 py-2.5 text-left text-sm whitespace-nowrap md:whitespace-normal",
                        "duration-quick ease-standard hover:text-dusk hover:bg-dusk/[0.04] transition-colors",
                        "data-[state=active]:bg-dusk/[0.06] data-[state=active]:text-dusk data-[state=active]:font-medium",
                      )}
                    >
                      {entry.title}
                    </Tabs.Trigger>
                  ))}
                </Tabs.List>
                {groups.map((entry) => (
                  <Tabs.Content key={entry.id} value={entry.id} className="outline-none data-[state=active]:animate-[vitrine-fade-in_var(--duration-quick)_var(--ease-standard)]">
                    <div className="grid grid-cols-2 gap-x-8 gap-y-6 lg:grid-cols-4">
                      {entry.columns.map((column, index) => (
                        <div key={column.heading?.id ?? `${entry.id}-${index}`} className="flex min-w-0 flex-col">
                          {column.heading !== null ? (
                            renderLink(column.heading, true)
                          ) : (
                            <p className="text-slate inline-flex min-h-8 items-center py-1 text-base font-medium">{column.headingLabel}</p>
                          )}
                          {column.links.length === 0 ? null : (
                            <ul className="mt-1 flex flex-col">
                              {column.links.map((link) => (
                                <li key={link.id}>{renderLink(link)}</li>
                              ))}
                            </ul>
                          )}
                        </div>
                      ))}
                    </div>
                    <div className="border-hairline mt-6 border-t pt-4">
                      <Link href={entry.all.href} data-agent-id={`menu:${entry.all.id}`} onClick={() => close()} className="text-dusk inline-flex min-h-8 items-center gap-1 text-sm font-medium underline-offset-4 hover:underline">
                        {entry.all.label}
                        <span aria-hidden="true">→</span>
                      </Link>
                    </div>
                  </Tabs.Content>
                ))}
              </Tabs.Root>
            </nav>
          </div>
        ) : null}
      </div>
      {/* Dims the page under an open menu. A click on it only closes the menu (the pointer listener above); it never reaches the page beneath. */}
      {mounted ? <div data-state={state} aria-hidden="true" onClick={() => close()} className="animate-overlay bg-dusk/15 absolute inset-x-0 top-full h-[100dvh]" /> : null}
    </>
  );
}

/* Icons are inline SVG, 1.5px strokes to match the header's (docs/PLAN.md 4.8). */

function GridGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="size-5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <rect x="4" y="4" width="6.5" height="6.5" rx="1.2" />
      <rect x="13.5" y="4" width="6.5" height="6.5" rx="1.2" />
      <rect x="4" y="13.5" width="6.5" height="6.5" rx="1.2" />
      <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.2" />
    </svg>
  );
}

function ChevronGlyph({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={cn("duration-quick ease-standard hidden size-4 shrink-0 transition-transform md:block", open && "rotate-180")}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
    >
      <path d="M6.5 9.5l5.5 5.5 5.5-5.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
