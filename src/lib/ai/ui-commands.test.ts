/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Unit tests for the Concierge UI command protocol, including manipulation attempts.
 */

import { describe, expect, it } from "vitest";

import {
  isAllowedRoute,
  parseCommands,
  uiCommandSchema,
} from "@/lib/ai/ui-commands";

/**
 * These tests are the client half of evaluation E8 (docs/PLAN.md 7.4): can the
 * Concierge be manipulated into doing something the user did not ask for? The
 * command layer is where a poisoned product description or review would have to
 * land to steer the interface, so every rejection below is a real attack shape.
 */

describe("route allowlist", () => {
  it("allows the routes the Concierge is meant to use", () => {
    expect(isAllowedRoute("/")).toBe(true);
    expect(isAllowedRoute("/c/lighting")).toBe(true);
    expect(isAllowedRoute("/p/oak-lounge-chair")).toBe(true);
    expect(isAllowedRoute("/search?q=lamp")).toBe(true);
    expect(isAllowedRoute("/account/orders")).toBe(true);
    expect(isAllowedRoute("/c")).toBe(true);
    expect(isAllowedRoute("/checkout")).toBe(true);
    expect(isAllowedRoute("/room?product=oak-lounge-chair")).toBe(true);
    expect(isAllowedRoute("/stylist")).toBe(true);
  });

  it("rejects absolute URLs to another origin", () => {
    expect(isAllowedRoute("https://evil.example/steal")).toBe(false);
    expect(isAllowedRoute("//evil.example")).toBe(false);
  });

  it("rejects javascript: and data: payloads", () => {
    expect(isAllowedRoute("javascript:alert(1)")).toBe(false);
    expect(isAllowedRoute("data:text/html,<script>")).toBe(false);
  });

  it("rejects backslash tricks some parsers treat as a slash", () => {
    expect(isAllowedRoute("/\\evil.example")).toBe(false);
  });

  it("rejects routes that merely start with an allowed prefix", () => {
    expect(isAllowedRoute("/cart/../admin")).toBe(false);
    expect(isAllowedRoute("/admin")).toBe(false);
    expect(isAllowedRoute("/staff/orders")).toBe(false);
    expect(isAllowedRoute("/checkout/pay")).toBe(false);
    expect(isAllowedRoute("/api/health")).toBe(false);
  });
});

describe("agent ids", () => {
  it("accepts the documented kind:id shape", () => {
    const result = uiCommandSchema.safeParse({
      type: "highlight",
      agentId: "filter:color",
      caption: "Showing colour options",
    });
    expect(result.success).toBe(true);
  });

  it("rejects an id carrying a CSS selector", () => {
    // Would become querySelector('[data-agent-id="..."]') — an id containing
    // quotes or brackets must never reach it.
    for (const bad of ['filter:a"]', "filter:a[b]", "filter:a b", "*", "filter:a'"]) {
      const result = uiCommandSchema.safeParse({
        type: "highlight",
        agentId: bad,
        caption: "Trying something",
      });
      expect(result.success, `expected ${bad} to be rejected`).toBe(false);
    }
  });
});

describe("parseCommands", () => {
  it("keeps valid commands and reports why the others were dropped", () => {
    const { commands, rejected } = parseCommands([
      { type: "navigate", href: "/c/lighting", caption: "Opening lighting" },
      { type: "navigate", href: "https://evil.example", caption: "Opening lighting" },
      { type: "not_a_command", caption: "Doing something" },
    ]);

    expect(commands).toHaveLength(1);
    expect(commands[0]?.type).toBe("navigate");
    expect(rejected).toHaveLength(2);
    expect(rejected[0]?.reason).toContain("allowlist");
  });

  it("caps a batch so one turn cannot drive the interface indefinitely", () => {
    const many = Array.from({ length: 20 }, () => ({
      type: "highlight",
      agentId: "nav:cart",
      caption: "Pointing at the cart",
    }));
    const { commands } = parseCommands(many);
    expect(commands.length).toBeLessThanOrEqual(8);
  });

  it("accepts a single command that is not wrapped in an array", () => {
    const { commands } = parseCommands({
      type: "scroll_to",
      agentId: "product:abc",
      caption: "Scrolling to the chair",
    });
    expect(commands).toHaveLength(1);
  });

  it("requires a human-readable caption, because it is announced aloud", () => {
    const { commands } = parseCommands({
      type: "highlight",
      agentId: "nav:cart",
      caption: "x",
    });
    expect(commands).toHaveLength(0);
  });
});

describe("set_filters", () => {
  it("accepts facet values", () => {
    const result = uiCommandSchema.safeParse({
      type: "set_filters",
      agentId: "filter:material",
      filters: { material: ["oak"], price: ["0-150"] },
      caption: "Filtering to oak under €150",
    });
    expect(result.success).toBe(true);
  });

  it("allows an empty array to clear a facet", () => {
    const result = uiCommandSchema.safeParse({
      type: "set_filters",
      agentId: "filter:material",
      filters: { material: [] },
      caption: "Clearing the material filter",
    });
    expect(result.success).toBe(true);
  });
});
