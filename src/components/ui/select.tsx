"use client";

/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Accessible select primitive.
 */

import { Select as Primitive } from "radix-ui";
import { useId } from "react";

import { cn } from "@/lib/ui/cn";

/**
 * Select (docs/PLAN.md 4.4).
 *
 * Used for sort order and variant pickers where the options are few and known.
 * The trigger looks like a field — hairline, 2px radius, 44px — because it is
 * one; the listbox is a sheet-class surface with the one allowed shadow.
 *
 * Like Field, the label is a required prop and is wired up by id, so an
 * unlabelled select is a type error rather than an audit finding.
 */
export type SelectOption = { value: string; label: string; disabled?: boolean };

export function Select({
  label,
  options,
  value,
  defaultValue,
  onValueChange,
  placeholder,
  hideLabel = false,
  disabled = false,
  className,
  name,
}: {
  label: string;
  options: readonly SelectOption[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  placeholder?: string;
  hideLabel?: boolean;
  disabled?: boolean;
  className?: string;
  /** Submitted with a surrounding form under this name. */
  name?: string;
}) {
  const id = useId();

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <label htmlFor={id} className={cn("text-sm font-medium", hideLabel && "sr-only")}>
        {label}
      </label>

      <Primitive.Root
        value={value}
        defaultValue={defaultValue}
        onValueChange={onValueChange}
        disabled={disabled}
        name={name}
      >
        <Primitive.Trigger
          id={id}
          className={cn(
            "border-hairline text-dusk inline-flex h-11 w-full items-center justify-between gap-3 rounded-plinth border bg-white px-3 text-left",
            "transition-colors duration-quick ease-standard hover:border-dusk/35 cursor-pointer",
            "data-[placeholder]:text-slate disabled:cursor-not-allowed disabled:opacity-40",
          )}
        >
          {/* Radix fills the value in only after hydration, so the server HTML
              showed an empty trigger that popped into place. When the value is
              controlled, its label is known on the server; render it. */}
          <Primitive.Value placeholder={placeholder}>
            {value === undefined ? undefined : options.find((option) => option.value === value)?.label}
          </Primitive.Value>
          <Primitive.Icon className="text-slate">
            <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
              <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </Primitive.Icon>
        </Primitive.Trigger>

        <Primitive.Portal>
          <Primitive.Content
            position="popper"
            sideOffset={6}
            className={cn(
              "bg-glass shadow-sheet rounded-sheet animate-pop z-50 overflow-hidden",
              "max-h-[var(--radix-select-content-available-height)] min-w-[var(--radix-select-trigger-width)]",
            )}
          >
            <Primitive.Viewport className="p-1">
              {options.map((option) => (
                <Primitive.Item
                  key={option.value}
                  value={option.value}
                  disabled={option.disabled}
                  className={cn(
                    "text-dusk relative flex h-11 cursor-pointer items-center rounded-plinth pr-3 pl-9 outline-none select-none",
                    "data-[highlighted]:bg-dusk/[0.06] data-[disabled]:cursor-not-allowed data-[disabled]:opacity-40",
                  )}
                >
                  <Primitive.ItemIndicator className="absolute left-3 inline-flex">
                    <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                      <path d="m5 12 5 5 9-10" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </Primitive.ItemIndicator>
                  <Primitive.ItemText>{option.label}</Primitive.ItemText>
                </Primitive.Item>
              ))}
            </Primitive.Viewport>
          </Primitive.Content>
        </Primitive.Portal>
      </Primitive.Root>
    </div>
  );
}
