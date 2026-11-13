/**
 * Vitrine — AI-native e-shop (ITC 4879 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Where to go after signing in, and a plain description of the device behind a session.
 */

/**
 * The page to return to after signing in, from a `?next=` parameter.
 *
 * Only a path on this site is accepted. "https://evil.example", "//evil.example"
 * (a protocol-relative URL) and "/\\evil.example" (which some browsers read the
 * same way) all fall back to the account page: otherwise a link to the sign-in
 * page could send someone, freshly signed in and trusting, to another site.
 */
export function safeNext(value: string | null | undefined, locale: string): string {
  const fallback = `/${locale}/account`;
  if (value === null || value === undefined || value === "") return fallback;
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return fallback;
  // Nothing that could smuggle a scheme or control character past the checks above.
  if (/[\p{Cc}\\]/u.test(value)) return fallback;
  try {
    const url = new URL(value, "https://vitrine.invalid");
    if (url.origin !== "https://vitrine.invalid") return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}

export type Device = { browser: string | null; system: string | null };

/**
 * "Chrome on Windows" from a User-Agent string, for the list of signed-in
 * devices. Deliberately coarse: enough for a person to recognise their own
 * phone or laptop, with no attempt at versions or models.
 */
export function describeDevice(userAgent: string | null | undefined): Device {
  const ua = userAgent ?? "";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /OPR\//.test(ua)
      ? "Opera"
      : /SamsungBrowser\//.test(ua)
        ? "Samsung Internet"
        : /Firefox\/|FxiOS\//.test(ua)
          ? "Firefox"
          : /Chrome\/|CriOS\//.test(ua)
            ? "Chrome"
            : /Safari\//.test(ua)
              ? "Safari"
              : null;
  const system = /Windows/.test(ua)
    ? "Windows"
    : /iPhone|iPad|iPod/.test(ua)
      ? "iOS"
      : /Android/.test(ua)
        ? "Android"
        : /Mac OS X|Macintosh/.test(ua)
          ? "macOS"
          : /CrOS/.test(ua)
            ? "ChromeOS"
            : /Linux/.test(ua)
              ? "Linux"
              : null;
  return { browser, system };
}
