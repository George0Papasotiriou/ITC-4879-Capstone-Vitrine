"use client";

/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Accessible tooltip primitive.
 */

import { Tooltip as Primitive } from "radix-ui";
import type { ReactNode } from "react";

import { cn } from "@/lib/ui/cn";

/**
 * Tooltip (docs/PLAN.md 4.4, 4.7).
 *
 * A tooltip supplements a name; it never replaces one. Anything that only makes
 * sense with its tooltip — an icon-only button, say — must still carry an
 * accessible label of its own (IconButton makes that mandatory), because a
 * tooltip does not exist on touch screens and is easy to miss with a keyboard.
 *
 * It opens on hover after a short delay and immediately on keyboard focus, and
 * is set on Dusk so it reads as a note on top of the page, not part of it.
 */
export function Tooltip({
  content,
  children,
  side = "top",
}: {
  content: ReactNode;
  /** A single focusable element. */
  children: ReactNode;
  side?: "top" | "right" | "bottom" | "left";
}) {
  return (
    <Primitive.Provider delayDuration={350} skipDelayDuration={150}>
      <Primitive.Root>
        <Primitive.Trigger asChild>{children}</Primitive.Trigger>
        <Primitive.Portal>
          <Primitive.Content
            side={side}
            sideOffset={6}
            className={cn(
              "bg-dusk text-glass rounded-plinth animate-pop z-50 max-w-[16rem] px-2.5 py-1.5 text-xs leading-snug",
            )}
          >
            {content}
            <Primitive.Arrow className="fill-dusk" />
          </Primitive.Content>
        </Primitive.Portal>
      </Primitive.Root>
    </Primitive.Provider>
  );
}
