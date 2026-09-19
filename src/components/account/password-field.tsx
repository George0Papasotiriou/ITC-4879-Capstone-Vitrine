"use client";

/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Password field with a show/hide toggle, label, hint and error.
 */

import { useTranslations } from "next-intl";
import { useId, useState, type ComponentPropsWithoutRef } from "react";

import { cn } from "@/lib/ui/cn";

/**
 * Like Field (src/components/ui/field.tsx), plus a button that shows the
 * password: on a phone keyboard a mistyped password is the most common reason
 * a sign-up fails, and seeing it is the fix. The button is a real button with
 * a pressed state, so a screen reader says what it does and whether it is on.
 */
export function PasswordField({
  label,
  hint,
  error,
  className,
  ...props
}: {
  label: string;
  hint?: string;
  error?: string;
  className?: string;
} & Omit<ComponentPropsWithoutRef<"input">, "className" | "id" | "type">) {
  const t = useTranslations("auth");
  const id = useId();
  const [visible, setVisible] = useState(false);
  const describedBy = [hint !== undefined ? `${id}-hint` : null, error !== undefined ? `${id}-error` : null].filter((value) => value !== null).join(" ") || undefined;

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          type={visible ? "text" : "password"}
          aria-describedby={describedBy}
          aria-invalid={error !== undefined}
          autoCapitalize="none"
          spellCheck={false}
          className={cn(
            "border-hairline text-dusk h-11 w-full rounded-plinth border bg-white pr-24 pl-3",
            "transition-colors duration-quick ease-standard hover:border-dusk/35",
            error !== undefined && "border-danger",
          )}
          {...props}
        />
        <button
          type="button"
          aria-pressed={visible}
          aria-controls={id}
          onClick={() => setVisible((value) => !value)}
          className="text-slate hover:text-dusk absolute inset-y-1 right-1 cursor-pointer rounded-plinth px-3 text-sm underline-offset-4 hover:underline"
        >
          {visible ? t("hidePassword") : t("showPassword")}
        </button>
      </div>
      {hint !== undefined ? (
        <p id={`${id}-hint`} className="text-slate text-sm">
          {hint}
        </p>
      ) : null}
      {error !== undefined ? (
        <p id={`${id}-error`} className="text-danger text-sm">
          {error}
        </p>
      ) : null}
    </div>
  );
}
