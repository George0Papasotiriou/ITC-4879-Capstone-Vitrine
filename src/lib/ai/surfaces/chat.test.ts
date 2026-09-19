/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Unit tests for the chat surface: the AI SDK tool loop over the registry, with the demo model, approvals and usage.
 */

import { describe, expect, it } from "vitest";

import { createDemoModel } from "@/lib/ai/providers/demo";
import { runTurn, type TurnUsage } from "@/lib/ai/surfaces/chat";
import { context, LAMP, LAMP_VARIANT } from "@/lib/ai/tools/fakes";

/**
 * The same streamText call the route makes, with the demo rules as the model
 * and fake services: proves the loop, the registry adapter, approvals and the
 * usage callback work together, with no key and no database.
 */

async function turn(text: string, cart: Parameters<typeof context>[1] = []) {
  const { ctx, changes } = context({}, cart);
  const usages: TurnUsage[] = [];
  const result = runTurn({
    model: createDemoModel({ locale: "en" }),
    instructions: "test",
    messages: [{ role: "user", content: [{ type: "text", text }] }],
    ctx,
    approvalSecret: "a".repeat(32),
    onUsage: (usage) => void usages.push(usage),
  });
  const steps = await result.steps;
  const text_ = await result.text;
  await result.consumeStream();
  return { steps, text: text_, changes, usages, content: await result.content };
}

describe("a Concierge turn", () => {
  it("searches, adds to the cart and answers, in one turn", async () => {
    const { steps, text, changes, usages } = await turn("add the lamp to my cart");
    expect(steps.flatMap((step) => step.toolCalls.map((call) => call.toolName))).toEqual(["search_products", "add_to_cart"]);
    expect(changes).toEqual([{ variantId: LAMP_VARIANT, quantity: 1, mode: "add" }]);
    expect(text).toContain("undo");
    expect(usages).toHaveLength(1);
    expect(usages[0]!.steps).toBe(3);
    expect(usages[0]!.inputTokens).toBeGreaterThan(0);
  });

  it("stops at checkout and asks the shopper, without running the tool", async () => {
    const { steps, content } = await turn("I want to check out", [{ variantId: LAMP_VARIANT, productId: LAMP, title: "Lamp", quantity: 1, available: true }]);
    expect(steps.flatMap((step) => step.toolResults)).toEqual([]);
    expect(content.some((part) => part.type === "tool-approval-request")).toBe(true);
  });

  it("shows products after searching, with pages commands for the browser", async () => {
    const { steps } = await turn("oak lamp");
    const shown = steps.flatMap((step) => step.toolResults).find((result) => result.toolName === "show_products");
    expect(shown?.output).toMatchObject({ commands: [{ type: "show_products" }] });
  });
});
