/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Tests for the registry as MCP sees it: which tools an agent gets, what each needs, and how answers come back.
 */

import { describe, expect, it } from "vitest";

import { callMcpTool, MCP_TOOL_ACCESS, mcpDefinition, mcpTools } from "@/lib/ai/surfaces/mcp/tools";
import { context, LAMP, LAMP_VARIANT } from "@/lib/ai/tools/fakes";
import { TOOLS } from "@/lib/ai/tools/registry";

const APP = "https://vitrine.example";
const names = (scopes: ("cart" | "orders")[]) => mcpTools(scopes).map((tool) => tool.name);

describe("which tools an outside agent gets", () => {
  it("offers the catalogue to anyone, and the cart and orders only with a key allowed to use them", () => {
    expect(names([])).toEqual(expect.arrayContaining(["search_products", "get_products", "compare_products", "recommend", "build_bundle", "summarize_reviews", "compose_showcase"]));
    expect(names([])).not.toContain("add_to_cart");
    expect(names(["cart"])).toEqual(expect.arrayContaining(["get_cart", "add_to_cart", "update_cart_item", "remove_from_cart", "start_checkout"]));
    expect(names(["cart"])).not.toContain("get_orders");
    expect(names(["orders"])).toEqual(expect.arrayContaining(["get_orders", "get_order_status"]));
  });

  it("never offers tools that drive a page, touch photographs, preferences, returns or the desk", () => {
    const everything = names(["cart", "orders"]);
    for (const hidden of ["navigate", "highlight", "set_filters", "try_on", "find_by_photo", "get_preferences", "remember_preference", "place_in_room", "start_return", "set_price_watch", "hand_to_person", "adjust_comfort"]) {
      expect(everything).not.toContain(hidden);
    }
    // Every tool named for MCP is a real registry tool, so a rename cannot leave a hole.
    for (const name of Object.keys(MCP_TOOL_ACCESS)) expect(TOOLS.some((tool) => tool.name === name)).toBe(true);
  });

  it("describes each tool with JSON Schema and honest hints, without the page's caption", () => {
    const showcase = mcpDefinition(TOOLS.find((tool) => tool.name === "compose_showcase")!);
    expect(showcase.inputSchema).toMatchObject({ type: "object" });
    expect(Object.keys(showcase.inputSchema.properties as object)).not.toContain("caption");
    expect(showcase.inputSchema.required).toBeUndefined();
    const search = mcpDefinition(TOOLS.find((tool) => tool.name === "search_products")!);
    expect(search.inputSchema).toMatchObject({ required: ["query"], properties: { query: { type: "string" } } });
    expect(search.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
    expect(mcpDefinition(TOOLS.find((tool) => tool.name === "add_to_cart")!).annotations).toMatchObject({ readOnlyHint: false, idempotentHint: false });
  });
});

describe("calling a tool", () => {
  it("runs a catalogue tool for anyone and returns structured and text content", async () => {
    const { ctx } = context();
    const result = await callMcpTool("search_products", { query: "lamp" }, { scopes: [], ctx, appUrl: APP });
    expect(result?.isError).toBe(false);
    expect(result?.structuredContent).toMatchObject({ products: [expect.objectContaining({ id: LAMP })] });
    expect(JSON.parse(result!.content[0]!.text)).toEqual(result?.structuredContent);
  });

  it("tells an agent without the right key where the shopper makes one, and changes nothing", async () => {
    const { ctx, changes } = context();
    const result = await callMcpTool("add_to_cart", { productId: LAMP }, { scopes: ["orders"], ctx, appUrl: APP });
    expect(result?.isError).toBe(true);
    expect(result?.content[0]?.text).toContain(`${APP}/en/account/agents`);
    expect(result?.structuredContent).toEqual({ ok: false, reason: "key_needed", scope: "cart" });
    expect(changes).toEqual([]);
  });

  it("changes the cart with a cart key, through the same store as the shop", async () => {
    const { ctx, changes } = context();
    const result = await callMcpTool("add_to_cart", { productId: LAMP, quantity: 2 }, { scopes: ["cart"], ctx, appUrl: APP });
    expect(result?.isError).toBe(false);
    expect(result?.structuredContent).toMatchObject({ ok: true, quantity: 2, itemsInCart: 2 });
    expect(changes).toEqual([{ variantId: LAMP_VARIANT, quantity: 2, mode: "add" }]);
  });

  it("turns the page's commands into links on the shop's address: checkout and shop windows", async () => {
    const { ctx } = context({}, [{ variantId: LAMP_VARIANT, productId: LAMP, title: "Faux Wood Table Lamp", quantity: 1, available: true }]);
    const checkout = await callMcpTool("start_checkout", {}, { scopes: ["cart"], ctx, appUrl: APP });
    expect(checkout?.structuredContent).toMatchObject({ ok: true, items: 1, links: [{ url: `${APP}/en/checkout` }] });
    expect(checkout?.structuredContent).not.toHaveProperty("commands");
    const window = await callMcpTool("compose_showcase", { theme: "reading-corner" }, { scopes: [], ctx: { ...ctx, locale: "el" }, appUrl: APP });
    expect(window?.structuredContent).toMatchObject({ links: [{ url: expect.stringMatching(/^https:\/\/vitrine\.example\/el\/showcase\?/) }] });
  });

  it("reports refused input as a tool error the model can correct, and unknown or hidden tools as unknown", async () => {
    const { ctx } = context();
    const refused = await callMcpTool("search_products", { query: "" }, { scopes: [], ctx, appUrl: APP });
    expect(refused?.isError).toBe(true);
    expect(refused?.content[0]?.text).toMatch(/^The input was not accepted: query/);
    expect(await callMcpTool("navigate", { href: "/" }, { scopes: ["cart", "orders"], ctx, appUrl: APP })).toBeNull();
    expect(await callMcpTool("drop_tables", {}, { scopes: [], ctx, appUrl: APP })).toBeNull();
  });

  it("marks an answer that says it failed as a tool error", async () => {
    const { ctx } = context();
    const result = await callMcpTool("start_checkout", {}, { scopes: ["cart"], ctx, appUrl: APP });
    expect(result).toMatchObject({ isError: true, structuredContent: { ok: false, reason: "empty_cart" } });
  });
});
