/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Tests for telling the local stack apart from a deployment that carries its flag.
 */

import { describe, expect, it } from "vitest";

import { isLocalStack, isLoopbackUrl, servesHttps } from "@/lib/local-stack";

describe("isLocalStack", () => {
  it("is the local stack only with the flag and an address on this machine", () => {
    expect(isLocalStack({ VITRINE_LOCAL: "1", APP_URL: "http://localhost:3000" })).toBe(true);
    expect(isLocalStack({ VITRINE_LOCAL: true, APP_URL: "http://127.0.0.1:3100" })).toBe(true);
    expect(isLocalStack({ VITRINE_LOCAL: "1", APP_URL: "http://shop.localhost:3000" })).toBe(true);
  });

  it("is not the local stack for a deployment that sets the flag", () => {
    expect(isLocalStack({ VITRINE_LOCAL: "1", APP_URL: "https://itc-4879-capstone-vitrine-production.up.railway.app" })).toBe(false);
    expect(isLocalStack({ VITRINE_LOCAL: true, APP_URL: "https://localhost.example.com" })).toBe(false);
  });

  it("is not the local stack without the flag, even on a laptop", () => {
    expect(isLocalStack({ APP_URL: "http://localhost:3000" })).toBe(false);
    expect(isLocalStack({ VITRINE_LOCAL: "0", APP_URL: "http://localhost:3000" })).toBe(false);
  });
});

describe("isLoopbackUrl and servesHttps", () => {
  it("reads the host and the scheme, and refuses what is not an address", () => {
    expect(isLoopbackUrl("http://[::1]:3000")).toBe(true);
    expect(isLoopbackUrl("not a url")).toBe(false);
    expect(servesHttps("https://example.com")).toBe(true);
    expect(servesHttps("http://localhost:3000")).toBe(false);
    expect(servesHttps(undefined)).toBe(false);
  });
});
