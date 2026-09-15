"use client";

/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Accessible checkbox and radio group primitives.
 */

import { Checkbox as CheckboxPrimitive, RadioGroup as RadioPrimitive } from "radix-ui";
import { useId, useRef, type ReactNode } from "react";

import { cn } from "@/lib/ui/cn";

/**
 * Checkbox and radio group (docs/PLAN.md 4.4, 4.7).
 *
 * The control is drawn at 20px, but the whole row — control and label — is the
 * hit area, which clears the 44px touch target without drawing an oversized box.
 * The label is part of the component rather than something a caller adds next
 * to it, so clicking the words always toggles the control.
 *
 * Checked state is shown by a mark, not only by fill colour, so it survives
 * forced-colours mode and colour blindness (4.7: meaning never by colour alone).
 */

const boxBase = cn(
  "border-dusk/35 inline-flex size-5 shrink-0 items-center justify-center border bg-white",
  "transition-colors duration-quick ease-standard",
  "data-[state=checked]:bg-dusk data-[state=checked]:border-dusk data-[state=checked]:text-glass",
  "disabled:cursor-not-allowed disabled:opacity-40",
);

export function Checkbox({
  label,
  hint,
  checked,
  defaultChecked,
  onCheckedChange,
  disabled = false,
  name,
  className,
}: {
  label: ReactNode;
  hint?: string;
  checked?: boolean;
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  disabled?: boolean;
  name?: string;
  className?: string;
}) {
  const id = useId();
  return (
    <div className={cn("flex min-h-11 items-start gap-3 py-2", className)}>
      <CheckboxPrimitive.Root
        id={id}
        name={name}
        checked={checked}
        defaultChecked={defaultChecked}
        onCheckedChange={(state) => onCheckedChange?.(state === true)}
        disabled={disabled}
        aria-describedby={hint === undefined ? undefined : `${id}-hint`}
        className={cn(boxBase, "mt-0.5 cursor-pointer rounded-plinth")}
      >
        <CheckboxPrimitive.Indicator>
          <svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden="true">
            <path d="m5 12 5 5 9-10" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </CheckboxPrimitive.Indicator>
      </CheckboxPrimitive.Root>
      <div className="flex flex-col">
        <label htmlFor={id} className="cursor-pointer select-none">
          {label}
        </label>
        {hint === undefined ? null : (
          <span id={`${id}-hint`} className="text-slate text-sm">
            {hint}
          </span>
        )}
      </div>
    </div>
  );
}

const ARROW_KEYS = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);

export type RadioOption = { value: string; label: ReactNode; hint?: string; disabled?: boolean };

/**
 * A radio group is one tab stop; the arrow keys move between options. That is
 * the platform convention, and Radix implements it — a group of independent
 * radio inputs each in the tab order would be slower and non-standard.
 */
export function RadioGroup({
  legend,
  options,
  value,
  defaultValue,
  onValueChange,
  hideLegend = false,
  name,
  className,
}: {
  legend: string;
  options: readonly RadioOption[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  hideLegend?: boolean;
  name?: string;
  className?: string;
}) {
  const id = useId();

  /**
   * Selection follows focus on arrow keys (WAI-ARIA radio group pattern).
   *
   * Radix intends this, but it only selects the newly focused radio if the
   * arrow key is still held when focus arrives — and it moves focus on a
   * deferred timer after the keypress. A key released instantly (a synthetic
   * press from voice control or switch access, or a test runner) is already up
   * by then, so focus moves and nothing is selected. Measured on this project:
   * arrowing after Tab moved focus without selecting.
   *
   * So the arrow is remembered until it is used, not until the key is released:
   * the next radio to receive focus consumes it. Any other key, a pointer press,
   * or focus leaving the group clears it, so Tab-ing in never selects anything.
   */
  const pendingArrow = useRef(false);

  return (
    <fieldset className={cn("flex flex-col", className)}>
      <legend className={cn("mb-1 text-sm font-medium", hideLegend && "sr-only")}>{legend}</legend>
      <RadioPrimitive.Root
        value={value}
        defaultValue={defaultValue}
        onValueChange={onValueChange}
        name={name}
        aria-label={legend}
        className="flex flex-col"
        onKeyDownCapture={(event) => {
          pendingArrow.current = ARROW_KEYS.has(event.key);
        }}
        onPointerDownCapture={() => {
          pendingArrow.current = false;
        }}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) pendingArrow.current = false;
        }}
      >
        {options.map((option) => {
          const optionId = `${id}-${option.value}`;
          return (
            <div key={option.value} className="flex min-h-11 items-start gap-3 py-2">
              <RadioPrimitive.Item
                id={optionId}
                value={option.value}
                disabled={option.disabled}
                onFocus={(event) => {
                  if (!pendingArrow.current) return;
                  pendingArrow.current = false;
                  // Clicking an already-checked radio is a no-op, so this cannot
                  // fight Radix on the occasions its own handler does select.
                  event.currentTarget.click();
                }}
                className={cn(boxBase, "mt-0.5 cursor-pointer rounded-full")}
              >
                <RadioPrimitive.Indicator className="bg-glass block size-2 rounded-full" />
              </RadioPrimitive.Item>
              <div className="flex flex-col">
                <label htmlFor={optionId} className="cursor-pointer select-none">
                  {option.label}
                </label>
                {option.hint === undefined ? null : (
                  <span className="text-slate text-sm">{option.hint}</span>
                )}
              </div>
            </div>
          );
        })}
      </RadioPrimitive.Root>
    </fieldset>
  );
}
