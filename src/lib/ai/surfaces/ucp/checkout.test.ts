/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Tests for UCP checkout over MCP: sessions as carts, the shop's totals, and the hand-off to the buyer's own page.
 */

import { describe, expect, it } from "vitest";

import { callUcpTool, ucpDefinitions, UCP_VERSION, type UcpDeps } from "@/lib/ai/surfaces/ucp/checkout";
import { context, LAMP } from "@/lib/ai/tools/fakes";
import { findTool, runTool } from "@/lib/ai/tools/registry";

const APP = "https://vitrine.example";
const agent = { "ucp-agent": { profile: "https://platform.example/profile.json" } };

function deps(): { deps: UcpDeps; changes: unknown[] } {
  const { ctx, changes } = context();
  return {
    changes,
    deps: {
      runOn: () => (tool, input) => runTool(findTool(tool, "mcp")!, ctx, input),
      newCartId: () => "cart-1",
      sign: (id) => `${id}.sig`,
      verify: (signed) => (signed.endsWith(".sig") ? signed.slice(0, -4) : null),
      appUrl: APP,
      locale: "en",
    },
  };
}

type Checkout = {
  ucp: { version: string; status: string };
  id: string;
  status: string;
  line_items: { item: { id: string; price: number }; quantity: number }[];
  totals: { type: string; amount: number }[];
  messages: { type: string; code?: string; severity?: string }[];
  continue_url?: string;
};

const structured = async (promise: ReturnType<typeof callUcpTool>) => (await promise)?.structuredContent as unknown as Checkout;

describe("UCP checkout", () => {
  it("offers the five checkout tools of the MCP binding, with JSON Schema inputs", () => {
    expect(ucpDefinitions().map((tool) => tool.name)).toEqual(["create_checkout", "get_checkout", "update_checkout", "complete_checkout", "cancel_checkout"]);
    expect(ucpDefinitions()[0]!.inputSchema).toMatchObject({ type: "object", required: ["meta", "checkout"] });
  });

  it("creates a session priced by the shop, which the buyer finishes on the shop's page", async () => {
    const { deps: d, changes } = deps();
    const checkout = await structured(callUcpTool("create_checkout", { meta: agent, checkout: { line_items: [{ item: { id: LAMP }, quantity: 2 }] } }, d));
    expect(changes).toHaveLength(1);
    expect(checkout.ucp).toMatchObject({ version: UCP_VERSION, status: "success" });
    expect(checkout.id).toBe("chk_cart-1.sig");
    expect(checkout.status).toBe("requires_escalation");
    expect(checkout.line_items).toMatchObject([{ item: { id: LAMP, price: 3900 }, quantity: 2 }]);
    expect(checkout.messages).toContainEqual(expect.objectContaining({ type: "error", code: "buyer_handoff_required", severity: "requires_buyer_input" }));
    expect(checkout.continue_url).toBe(`${APP}/api/cart/resume?c=cart-1.sig&locale=en`);
  });

  it("keeps UCP's totals rule: one subtotal, one total, and the entries between adding up to it", async () => {
    const checkout = await structured(callUcpTool("create_checkout", { meta: agent, checkout: { line_items: [{ item: { id: LAMP }, quantity: 2 }] } }, deps().deps));
    expect(checkout.totals.filter((total) => total.type === "subtotal")).toHaveLength(1);
    const total = checkout.totals.filter((entry) => entry.type === "total");
    expect(total).toEqual([expect.objectContaining({ amount: 8700 })]);
    expect(checkout.totals.filter((entry) => entry.type !== "total").reduce((sum, entry) => sum + entry.amount, 0)).toBe(8700);
  });

  it("answers a session of pieces that do not exist with an error envelope and no session", async () => {
    const checkout = await structured(callUcpTool("create_checkout", { meta: agent, checkout: { line_items: [{ item: { id: "SKU-123" }, quantity: 1 }] } }, deps().deps));
    expect(checkout.ucp.status).toBe("error");
    expect(checkout.messages).toContainEqual(expect.objectContaining({ code: "item_unavailable", severity: "unrecoverable" }));
    expect(checkout.id).toBeUndefined();
  });

  it("refuses requests without the agent's profile, and complete or cancel without an idempotency key", async () => {
    const d = deps().deps;
    const noAgent = await callUcpTool("create_checkout", { checkout: { line_items: [{ item: { id: LAMP }, quantity: 1 }] } }, d);
    expect(noAgent?.isError).toBe(true);
    expect(JSON.stringify(noAgent?.structuredContent)).toContain("invalid_request");
    expect((await callUcpTool("complete_checkout", { meta: agent, id: "chk_cart-1.sig" }, d))?.isError).toBe(true);
    expect((await callUcpTool("cancel_checkout", { meta: agent, id: "chk_cart-1.sig" }, d))?.isError).toBe(true);
  });

  it("does not know a session whose id was not signed by the shop", async () => {
    const checkout = await structured(callUcpTool("get_checkout", { meta: agent, id: "chk_cart-1.forged" }, deps().deps));
    expect(checkout.ucp.status).toBe("error");
    expect(checkout.messages).toContainEqual(expect.objectContaining({ code: "not_found" }));
  });

  it("updates, never completes through the API, and cancels", async () => {
    const d = deps().deps;
    await callUcpTool("create_checkout", { meta: agent, checkout: { line_items: [{ item: { id: LAMP }, quantity: 1 }] } }, d);
    const withKey = { ...agent, "idempotency-key": "550e8400-e29b-41d4-a716-446655440000" };

    const completed = await structured(callUcpTool("complete_checkout", { meta: withKey, id: "chk_cart-1.sig", checkout: {} }, d));
    expect(completed.status).toBe("requires_escalation");
    expect(completed.messages).toContainEqual(expect.objectContaining({ code: "complete_on_page" }));

    const emptied = await structured(callUcpTool("update_checkout", { meta: agent, id: "chk_cart-1.sig", checkout: { line_items: [{ item: { id: LAMP }, quantity: 0 }] } }, d));
    expect(emptied.status).toBe("incomplete");
    expect(emptied.line_items).toEqual([]);

    const canceled = await structured(callUcpTool("cancel_checkout", { meta: withKey, id: "chk_cart-1.sig" }, d));
    expect(canceled.status).toBe("canceled");
    expect(canceled.continue_url).toBeUndefined();
  });

  it("is not a UCP tool when the name is something else", async () => {
    expect(await callUcpTool("search_products", {}, deps().deps)).toBeNull();
  });
});
