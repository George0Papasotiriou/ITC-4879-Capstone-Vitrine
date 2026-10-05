/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * The shop's security headers: a nonce-based Content Security Policy, and the headers every response carries.
 */

/**
 * docs/adr/046. Written from Next.js 16's own guide (node_modules/next/dist/
 * docs/01-app/02-guides/content-security-policy.md) and Stripe's CSP list
 * (docs.stripe.com/security/guide, read 2026-09-29).
 *
 * SCRIPTS are the point. A fresh random nonce per page view, and
 * 'strict-dynamic': only scripts the page itself marked, and what those load,
 * may run — an injected <script> has no nonce and does not. Next.js puts the
 * nonce on its own scripts; the layout puts it on the one inline script the
 * shop writes. Every page is therefore rendered per request (the layout reads
 * the headers), which the guide requires. 'wasm-unsafe-eval' lets the room's
 * depth model run WebAssembly; it does not allow eval of JavaScript.
 *
 * STYLES allow 'unsafe-inline': the pages and model-viewer set style
 * attributes, which a nonce cannot cover, and style injection cannot run code.
 *
 * WHO ELSE the browser may talk to, and only these:
 * - Stripe: its script, frames (card fields, 3-D Secure, Link) and API.
 * - Realtime voice: OpenAI's and Google's sockets, opened by the browser with
 *   a one-minute token (docs/adr/030).
 * - The shop's bucket, for images only: a shopper's photograph and a try-on
 *   result are shown through short-lived signed links to it (bucketOrigins).
 * Product photographs come through the shop's own image optimizer, 3D scans
 * from its own storage, the depth model from its own files: nothing else.
 */

export type CspMode = "enforce" | "report" | "off";

/** Bucket names as S3-compatible providers allow them; anything else never reaches the header. */
const BUCKET_NAME = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;

/**
 * Where the browser meets the bucket. Photographs and try-on results are shown
 * with signed links straight to it (src/lib/photos/server.ts), so without this
 * the policy would block them the moment a bucket replaces the local disk.
 *
 * Virtual-hosted addresses put the bucket in the host name
 * (https://vitrine.<account>.r2.cloudflarestorage.com); path-style ones keep
 * the endpoint's host. The endpoint's own origin is always listed too, because
 * the S3 client falls back to path style for a bucket name a host name cannot
 * carry. Empty when there is no bucket, the endpoint is not a web address, or
 * the name is not a valid bucket name.
 */
export function bucketOrigins({ endpoint, bucket, forcePathStyle }: { endpoint?: string; bucket?: string; forcePathStyle: boolean }): string[] {
  if (endpoint === undefined || bucket === undefined || !BUCKET_NAME.test(bucket)) return [];
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return [];
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return [];
  return forcePathStyle ? [url.origin] : [url.origin, `${url.protocol}//${bucket}.${url.host}`];
}

const STRIPE = { script: ["https://js.stripe.com", "https://*.js.stripe.com"], frame: ["https://js.stripe.com", "https://*.js.stripe.com", "https://hooks.stripe.com", "https://link.com", "https://*.link.com"], connect: ["https://api.stripe.com", "https://link.com", "https://*.link.com"], img: ["https://*.stripe.com", "https://*.link.com"] };
const VOICE = ["wss://api.openai.com", "https://api.openai.com", "wss://generativelanguage.googleapis.com", "https://generativelanguage.googleapis.com"];

export function contentSecurityPolicy({ nonce, dev, https, bucket = [] }: { nonce: string; dev: boolean; https: boolean; bucket?: string[] }): string {
  const directives: [string, string[]][] = [
    ["default-src", ["'self'"]],
    // In development React evaluates code for its error overlay; never in production.
    ["script-src", ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'", "'wasm-unsafe-eval'", ...STRIPE.script, ...(dev ? ["'unsafe-eval'"] : [])]],
    ["style-src", ["'self'", "'unsafe-inline'"]],
    ["img-src", ["'self'", "data:", "blob:", ...bucket, ...STRIPE.img]],
    ["font-src", ["'self'", "data:"]],
    // blob: and data: because three.js (inside model-viewer) fetches a scan's embedded textures from them.
    ["connect-src", ["'self'", "blob:", "data:", ...STRIPE.connect, ...VOICE, ...(dev ? ["ws:"] : [])]],
    ["frame-src", STRIPE.frame],
    ["worker-src", ["'self'", "blob:"]],
    // The bucket too: a try-on video ("See it move", docs/adr/063) plays from a link to the shopper's own file there.
    ["media-src", ["'self'", "blob:", "data:", ...bucket]],
    ["manifest-src", ["'self'"]],
    ["object-src", ["'none'"]],
    ["base-uri", ["'self'"]],
    ["form-action", ["'self'"]],
    ["frame-ancestors", ["'none'"]],
    ["report-uri", ["/api/csp-report"]],
  ];
  const policy = directives.map(([name, values]) => `${name} ${values.join(" ")}`);
  if (https) policy.push("upgrade-insecure-requests");
  return policy.join("; ");
}

/** The header that carries the policy, by mode: enforced, only reported (a way back if a deploy blocks something), or none. */
export function cspHeaderName(mode: CspMode): string | null {
  return mode === "enforce" ? "Content-Security-Policy" : mode === "report" ? "Content-Security-Policy-Report-Only" : null;
}

export function cspMode(value: string | undefined): CspMode {
  return value === "report" || value === "off" ? value : "enforce";
}

/** A nonce: 128 random bits, base64. */
export function newNonce(): string {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
}

/**
 * Headers for every response. HSTS only over https, and without `preload`,
 * which would commit the domain beyond what a student project should promise.
 */
export function baseSecurityHeaders({ https }: { https: boolean }): [string, string][] {
  const headers: [string, string][] = [
    ["X-Content-Type-Options", "nosniff"],
    ["Referrer-Policy", "strict-origin-when-cross-origin"],
    ["X-Frame-Options", "DENY"],
    [
      "Permissions-Policy",
      [
        // The Concierge listens on every page (voice, docs/adr/026). The camera API serves the AR Mirror (docs/adr/065),
        // on this shop's own pages only: no frame embedded in a page may ask for it. Photographs still come from file inputs.
        "microphone=(self)",
        "camera=(self)",
        "geolocation=()",
        // Apple Pay and Google Pay in Stripe's Express Checkout.
        'payment=(self "https://js.stripe.com")',
        // AR through model-viewer's WebXR mode.
        "xr-spatial-tracking=(self)",
        "fullscreen=(self)",
        "usb=()",
        "serial=()",
        "bluetooth=()",
        "browsing-topics=()",
      ].join(", "),
    ],
  ];
  if (https) headers.push(["Strict-Transport-Security", "max-age=63072000; includeSubDomains"]);
  return headers;
}
