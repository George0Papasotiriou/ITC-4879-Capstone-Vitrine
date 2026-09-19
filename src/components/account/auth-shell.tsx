/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * The narrow column the sign-in, sign-up and password pages share.
 */

import type { ReactNode } from "react";

/** One column at reading width: a form is easier to follow when nothing competes with it. */
export function AuthShell({ title, lede, children }: { title: string; lede?: string; children: ReactNode }) {
  return (
    <main className="mx-auto w-full max-w-[34rem] px-6 py-12 md:py-20">
      <h1 className="font-display text-3xl">{title}</h1>
      {lede !== undefined ? <p className="text-slate mt-3 max-w-[52ch]">{lede}</p> : null}
      <div className="mt-8">{children}</div>
    </main>
  );
}
