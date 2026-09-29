/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Whether this process is really the local stack on a laptop, not only a deployment carrying its flag.
 */

/**
 * `VITRINE_LOCAL=1` lets a process use the stand-in drivers (jobs in-process,
 * files on disk). A deployment may set it too, to boot before it has a bucket
 * (it happened, 2026-09-28). The flag alone must therefore never open anything
 * meant only for one person's laptop: the email outbox holds live sign-in and
 * password-reset links, and the lab pages and demo scripts assume nobody else
 * is there. Those need the local stack proper: the flag **and** a shop address
 * on this machine. A deployed shop's address is never a loopback one.
 */

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

export function isLoopbackUrl(url: string | undefined): boolean {
  if (url === undefined) return false;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return LOOPBACK_HOSTS.has(host) || host.endsWith(".localhost");
  } catch {
    return false;
  }
}

/** The flag as the environment spells it ("1") or as the parsed settings hold it (true). */
export function isLocalStack(env: { readonly [name: string]: unknown }): boolean {
  const flag = env.VITRINE_LOCAL;
  const flagged = flag === true || flag === "1" || flag === "true";
  return flagged && isLoopbackUrl(typeof env.APP_URL === "string" ? env.APP_URL : undefined);
}

/** Cookies are marked Secure whenever the shop is served over https, whatever else is set. */
export function servesHttps(appUrl: string | undefined): boolean {
  try {
    return appUrl !== undefined && new URL(appUrl).protocol === "https:";
  } catch {
    return false;
  }
}
