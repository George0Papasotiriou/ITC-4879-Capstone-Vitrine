/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Locale-aware Link, router and pathname helpers.
 */

import { createNavigation } from "next-intl/navigation";

import { routing } from "@/i18n/routing";

/**
 * Locale-aware navigation. Components import `Link` and `useRouter` from here
 * rather than from `next/link`, so a link written as `/cart` resolves to
 * `/el/cart` for a Greek reader without every call site remembering to add the
 * prefix.
 */
export const { Link, redirect, usePathname, useRouter, getPathname } =
  createNavigation(routing);
