/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Tests for the security headers: what the policy allows, what it never allows, and how it is switched.
 */

import { describe, expect, it } from "vitest";

import { baseSecurityHeaders, contentSecurityPolicy, cspHeaderName, cspMode, newNonce } from "@/lib/security/headers";

const directive = (policy: string, name: string) => policy.split("; ").find((entry) => entry.startsWith(`${name} `))?.split(" ").slice(1) ?? null;

describe("content security policy", () => {
  const production = contentSecurityPolicy({ nonce: "abc123", dev: false, https: true });

  it("runs only scripts the page marked with this view's nonce, and what they load", () => {
    expect(directive(production, "script-src")).toEqual(expect.arrayContaining(["'nonce-abc123'", "'strict-dynamic'", "'self'"]));
    expect(production).not.toContain("'unsafe-inline' https://js.stripe.com");
    expect(directive(production, "script-src")).not.toContain("'unsafe-inline'");
    expect(directive(production, "script-src")).not.toContain("'unsafe-eval'");
  });

  it("allows eval only in development, where React's overlay needs it", () => {
    expect(directive(contentSecurityPolicy({ nonce: "n", dev: true, https: false }), "script-src")).toContain("'unsafe-eval'");
  });

  it("names every outside party the browser may reach: Stripe and the voice providers", () => {
    expect(directive(production, "frame-src")).toEqual(expect.arrayContaining(["https://js.stripe.com", "https://hooks.stripe.com"]));
    expect(directive(production, "connect-src")).toEqual(expect.arrayContaining(["'self'", "https://api.stripe.com", "wss://api.openai.com", "wss://generativelanguage.googleapis.com"]));
    expect(directive(production, "object-src")).toEqual(["'none'"]);
    expect(directive(production, "frame-ancestors")).toEqual(["'none'"]);
    expect(directive(production, "base-uri")).toEqual(["'self'"]);
  });

  it("upgrades insecure requests only when the shop is served over https", () => {
    expect(production).toContain("upgrade-insecure-requests");
    expect(contentSecurityPolicy({ nonce: "n", dev: false, https: false })).not.toContain("upgrade-insecure-requests");
  });

  it("is enforced unless switched to report-only or off", () => {
    expect(cspMode(undefined)).toBe("enforce");
    expect(cspMode("nonsense")).toBe("enforce");
    expect(cspHeaderName(cspMode("report"))).toBe("Content-Security-Policy-Report-Only");
    expect(cspHeaderName(cspMode("off"))).toBeNull();
  });

  it("makes a new unguessable nonce each time", () => {
    const nonces = new Set(Array.from({ length: 50 }, newNonce));
    expect(nonces.size).toBe(50);
    for (const nonce of nonces) expect(Buffer.from(nonce, "base64")).toHaveLength(16);
  });
});

describe("headers on every response", () => {
  it("send HSTS only over https, and keep the microphone to the shop and the camera API off", () => {
    const secure = new Map(baseSecurityHeaders({ https: true }));
    expect(secure.get("Strict-Transport-Security")).toBe("max-age=63072000; includeSubDomains");
    expect(new Map(baseSecurityHeaders({ https: false })).has("Strict-Transport-Security")).toBe(false);
    expect(secure.get("Permissions-Policy")).toContain("microphone=(self)");
    expect(secure.get("Permissions-Policy")).toContain("camera=()");
    expect(secure.get("X-Content-Type-Options")).toBe("nosniff");
  });
});
