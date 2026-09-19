/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Button, link button and icon button primitives.
 */

import type { ComponentPropsWithoutRef, ReactNode } from "react";

import { SmartLink } from "@/components/ui/smart-link";
import { cn } from "@/lib/ui/cn";

/**
 * Button (docs/PLAN.md 4.4)
 *
 * Dusk fill for primary, a hairline outline for secondary, text only for
 * tertiary. Labels are verbs in sentence case — never ALL CAPS, never an arrow
 * or emoji inside the label (4.6, 4.8).
 *
 * Nothing lifts on hover. Feedback is a colour shift inside `--duration-quick`,
 * because Part 4.5 spends all the motion budget on the window light and the
 * Spotlight.
 */

type Variant = "primary" | "secondary" | "tertiary" | "danger";
type Size = "sm" | "md" | "lg";

const base = [
  "inline-flex items-center justify-center gap-2",
  "rounded-plinth font-medium whitespace-nowrap",
  "transition-colors duration-quick ease-standard",
  "cursor-pointer select-none",
  "disabled:cursor-not-allowed disabled:opacity-40",
  // `aria-disabled` is the right tool for "temporarily unavailable": a real
  // `disabled` attribute removes the element from the tab order, and browsers
  // blur it, so a keyboard user who just activated it is thrown back to the
  // top of the document. This keeps focus and still announces the state.
  "aria-disabled:cursor-not-allowed aria-disabled:opacity-40",
].join(" ");

const variants: Record<Variant, string> = {
  primary: "bg-dusk text-glass hover:bg-dusk/90 active:bg-dusk",
  secondary:
    "border border-hairline bg-transparent text-dusk hover:border-dusk/35 hover:bg-dusk/[0.04]",
  tertiary: "bg-transparent text-dusk underline-offset-4 hover:underline",
  danger: "bg-danger text-white hover:bg-danger/90",
};

/**
 * Heights meet WCAG 2.2 target size: `sm` clears the 24px minimum, and `md` —
 * the default, and the only size used on touch surfaces — is 44px.
 */
const sizes: Record<Size, string> = {
  sm: "h-8 px-3 text-sm",
  md: "h-11 px-5 text-base",
  lg: "h-13 px-7 text-lg",
};

type CommonProps = {
  variant?: Variant;
  size?: Size;
  className?: string;
  children: ReactNode;
};

type ButtonProps = CommonProps &
  Omit<ComponentPropsWithoutRef<"button">, "className" | "children">;

export function Button({
  variant = "primary",
  size = "md",
  className,
  children,
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(base, variants[variant], sizes[size], className)}
      {...props}
    >
      {children}
    </button>
  );
}

type ButtonLinkProps = CommonProps & {
  href: string;
  /** Load as a new document (see SmartLink): the href is then used as is, locale included. */
  document?: boolean;
} & Omit<ComponentPropsWithoutRef<"a">, "className" | "children" | "href">;

/** The same surface rendered as a link, for navigation rather than an action.
 *  Locale-aware: `/cart` resolves to `/el/cart` on the Greek storefront. */
export function ButtonLink({
  variant = "primary",
  size = "md",
  className,
  children,
  href,
  ...props
}: ButtonLinkProps) {
  return (
    <SmartLink
      href={href}
      className={cn(base, variants[variant], sizes[size], "no-underline", className)}
      {...props}
    >
      {children}
    </SmartLink>
  );
}

type IconButtonProps = Omit<ButtonProps, "children" | "size"> & {
  /** Required: an icon alone carries no accessible name. */
  label: string;
  size?: Size;
  children: ReactNode;
};

/**
 * An icon-only control. `label` is mandatory rather than optional, so a button
 * without an accessible name is a type error instead of an audit finding.
 */
export function IconButton({
  label,
  variant = "tertiary",
  size = "md",
  className,
  children,
  type = "button",
  ...props
}: IconButtonProps) {
  const square: Record<Size, string> = {
    sm: "size-8",
    md: "size-11",
    lg: "size-13",
  };

  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={cn(base, variants[variant], square[size], "px-0", className)}
      {...props}
    >
      {children}
    </button>
  );
}
