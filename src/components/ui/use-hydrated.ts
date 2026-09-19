/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Whether React has hydrated the page yet, for forms that must not submit natively.
 */

import { useSyncExternalStore } from "react";

const subscribeNever = () => () => {};

/**
 * False in the server render and during hydration, true once React owns the
 * page. A form's submit button stays disabled until then: pressed earlier, the
 * browser would submit the form itself, bypassing the handler, and on a slow
 * phone that happens (the checkout found it; the sign-up form hit it too).
 * With its only submit button disabled, pressing Enter in a field does not
 * submit either (HTML's implicit submission rule).
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(subscribeNever, () => true, () => false);
}
