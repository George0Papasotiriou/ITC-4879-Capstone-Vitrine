/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Lightweight class name join without Tailwind merging.
 */

import { clsx, type ClassValue } from "clsx";

/**
 * Join class names without resolving Tailwind conflicts.
 *
 * `cn` (clsx + tailwind-merge) is the default and the right choice in Server
 * Components, where it costs nothing in the browser. In the handful of Client
 * Components that ship on *every* page — the language switch, the Concierge
 * prompt, the toast layer — it pulls tailwind-merge (8.4 KB gzipped) into the
 * shared bundle, and those components never need a caller's class to override
 * one of their own. They use this instead.
 *
 * Use `cn` whenever a caller's `className` must win over a default.
 */
export function cx(...inputs: ClassValue[]): string {
  return clsx(inputs);
}
