/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Runs in the browser before the shop becomes interactive: settings every page's scripts rely on.
 */

import { z } from "zod";

/**
 * docs/adr/046. Zod speeds up parsing by compiling schemas with
 * `new Function`, and first checks whether it may by trying one. Under the
 * shop's Content Security Policy that check is refused — harmlessly, since
 * zod catches it — but the browser still reports a violation on every page
 * that parses. `jitless` skips the check and the compiling; the browser's
 * schemas are small, so nothing is lost.
 */
z.config({ jitless: true });
