"use client";

/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Accessible tabs primitive.
 */

import { Tabs as Primitive } from "radix-ui";
import type { ReactNode } from "react";

import { cn } from "@/lib/ui/cn";

/**
 * Tabs (docs/PLAN.md 4.3, 4.4).
 *
 * The product page's media stage is the main user: Photos, 360°, 3D and In my
 * room are views of one object, which is what tabs are for. They are not a way
 * to hide a long page — content a shopper needs to decide belongs on the page.
 *
 * The active tab is marked by a Dusk underline and weight, not colour alone.
 * Arrow keys move between tabs and the tab list is a single tab stop.
 */
export type TabItem = { value: string; label: ReactNode; content: ReactNode; disabled?: boolean };

export function Tabs({
  label,
  items,
  defaultValue,
  value,
  onValueChange,
  className,
}: {
  /** Accessible name for the tab list, e.g. "Product views". */
  label: string;
  items: readonly TabItem[];
  defaultValue?: string;
  value?: string;
  onValueChange?: (value: string) => void;
  className?: string;
}) {
  return (
    <Primitive.Root
      defaultValue={defaultValue ?? items[0]?.value}
      value={value}
      onValueChange={onValueChange}
      className={cn("flex flex-col", className)}
    >
      <Primitive.List aria-label={label} className="border-hairline flex gap-1 overflow-x-auto border-b">
        {items.map((item) => (
          <Primitive.Trigger
            key={item.value}
            value={item.value}
            disabled={item.disabled}
            className={cn(
              "text-slate relative h-11 shrink-0 cursor-pointer px-3 text-sm whitespace-nowrap",
              "transition-colors duration-quick ease-standard hover:text-dusk",
              // The underline draws out from the middle of the chosen tab (docs/adr/031).
              "after:bg-dusk after:absolute after:inset-x-3 after:bottom-[-1px] after:h-0.5 after:scale-x-0 after:transition-transform after:duration-calm after:ease-standard",
              "data-[state=active]:text-dusk data-[state=active]:font-medium data-[state=active]:after:scale-x-100",
              "disabled:cursor-not-allowed disabled:opacity-40",
            )}
          >
            {item.label}
          </Primitive.Trigger>
        ))}
      </Primitive.List>
      {items.map((item) => (
        <Primitive.Content key={item.value} value={item.value} className="data-[state=active]:animate-[vitrine-fade-in_var(--duration-calm)_var(--ease-standard)] pt-5 outline-none">
          {item.content}
        </Primitive.Content>
      ))}
    </Primitive.Root>
  );
}
