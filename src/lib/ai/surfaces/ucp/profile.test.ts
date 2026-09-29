/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Tests for the UCP business profile.
 */

import { describe, expect, it } from "vitest";

import { ucpProfile } from "@/lib/ai/surfaces/ucp/profile";

describe("UCP business profile", () => {
  it("declares the MCP endpoint and the checkout capability, with the registries UCP requires even when empty", () => {
    const profile = ucpProfile("https://vitrine.example");
    expect(profile.ucp.version).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(profile.ucp.services["dev.ucp.shopping"]).toEqual([expect.objectContaining({ transport: "mcp", endpoint: "https://vitrine.example/api/mcp" })]);
    expect(Object.keys(profile.ucp.capabilities)).toEqual(["dev.ucp.shopping.checkout"]);
    expect(profile.ucp.payment_handlers).toEqual({});
    for (const entry of [...profile.ucp.services["dev.ucp.shopping"], ...profile.ucp.capabilities["dev.ucp.shopping.checkout"]]) {
      expect(entry).toMatchObject({ version: profile.ucp.version, spec: expect.stringMatching(/^https:\/\/ucp\.dev\//), schema: expect.stringMatching(/^https:\/\/ucp\.dev\//) });
    }
  });
});
