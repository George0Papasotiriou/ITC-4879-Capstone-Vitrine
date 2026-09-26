"use client";

/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Labelled text field with hint and error message.
 */

import type { ComponentPropsWithoutRef } from "react";
import { useId } from "react";

import { cn } from "@/lib/ui/cn";

/**
 * Text field (docs/PLAN.md 4.4, 4.7)
 *
 * The label is a required prop rather than something a caller can forget, and
 * it is wired to the input by a generated id. A placeholder is never the label:
 * it disappears the moment someone types, which is exactly when they need it.
 *
 * Errors are announced, not merely coloured — meaning is never carried by
 * colour alone (4.7).
 */
export function Field({
  label,
  hint,
  error,
  className,
  inputClassName,
  ...props
}: {
  label: string;
  /** Plain-language help shown under the field. */
  hint?: string;
  /** What went wrong and how to fix it (4.6). */
  error?: string;
  className?: string;
  inputClassName?: string;
} & Omit<ComponentPropsWithoutRef<"input">, "className" | "id">) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;

  const describedBy =
    [hint !== undefined ? hintId : null, error !== undefined ? errorId : null]
      .filter((value) => value !== null)
      .join(" ") || undefined;

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>

      <input
        id={id}
        aria-describedby={describedBy}
        aria-invalid={error !== undefined}
        className={cn(
          "border-hairline text-dusk placeholder:text-slate/70 h-11 w-full rounded-plinth border bg-white px-3",
          "transition-colors duration-quick ease-standard",
          "hover:border-dusk/35",
          "disabled:cursor-not-allowed disabled:opacity-40",
          error !== undefined && "border-danger",
          inputClassName,
        )}
        {...props}
      />

      {hint !== undefined ? (
        <p id={hintId} className="text-slate text-sm">
          {hint}
        </p>
      ) : null}

      {error !== undefined ? (
        <p id={errorId} className="text-danger animate-rise text-sm">
          {error}
        </p>
      ) : null}
    </div>
  );
}
