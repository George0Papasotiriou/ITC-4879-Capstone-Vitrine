/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * End-to-end tests for the agent-ready shop: MCP over HTTP, agent keys, UCP checkout hand-off and WebMCP.
 */

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type APIRequestContext } from "@playwright/test";

import { clientAddress, freshPage, signUpAndConfirm, uniqueEmail } from "./support/accounts";

/** docs/adr/043, against the production build, with no real agent: the test plays the agent. */

const META = { "io.modelcontextprotocol/protocolVersion": "2026-07-28", "io.modelcontextprotocol/clientInfo": { name: "vitrine-e2e", version: "1" }, "io.modelcontextprotocol/clientCapabilities": {} };

/** One modern MCP request, with its headers mirrored as the 2026-07-28 revision requires. */
async function mcp(request: APIRequestContext, method: string, params: Record<string, unknown> = {}, { key, address }: { key?: string; address: string }) {
  const response = await request.post("/api/mcp", {
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": "2026-07-28",
      "mcp-method": method,
      "x-forwarded-for": address,
      ...(typeof params.name === "string" ? { "mcp-name": params.name } : {}),
      ...(key === undefined ? {} : { authorization: `Bearer ${key}` }),
    },
    data: { jsonrpc: "2.0", id: 1, method, params: { ...params, _meta: META } },
  });
  return { status: response.status(), body: (await response.json().catch(() => null)) as { result?: Record<string, unknown>; error?: { code: number; message: string } } | null };
}

const lampId = async (request: APIRequestContext, address: string) => {
  const found = await mcp(request, "tools/call", { name: "search_products", arguments: { query: "faux wood table lamp", limit: 3 } }, { address });
  const products = (found.body?.result?.structuredContent as { products: { id: string; slug: string }[] }).products;
  return products.find((product) => product.slug.startsWith("faux-wood-table-lamp"))!.id;
};

test("@smoke an outside agent discovers the shop and searches it without a key", async ({ request }) => {
  const address = clientAddress();
  const discover = await mcp(request, "server/discover", {}, { address });
  expect(discover.status).toBe(200);
  expect(discover.body?.result).toMatchObject({ resultType: "complete", supportedVersions: expect.arrayContaining(["2026-07-28"]), capabilities: { tools: {} } });

  const list = await mcp(request, "tools/list", {}, { address });
  const names = (list.body?.result?.tools as { name: string }[]).map((tool) => tool.name);
  expect(names).toEqual(expect.arrayContaining(["search_products", "compare_products", "build_bundle", "create_checkout"]));
  expect(names).not.toContain("add_to_cart");
  expect(list.body?.result?.cacheScope).toBe("public");

  const found = await mcp(request, "tools/call", { name: "search_products", arguments: { query: "oak table" } }, { address });
  expect(found.body?.result).toMatchObject({ isError: false, structuredContent: { products: expect.any(Array) } });

  // The cart needs a key, and the answer says where the shopper makes one.
  const refused = await mcp(request, "tools/call", { name: "add_to_cart", arguments: { productId: await lampId(request, address) } }, { address });
  expect(refused.body?.result).toMatchObject({ isError: true, structuredContent: { reason: "key_needed" } });

  // No sessions and no stream: GET is refused. An older client still gets an initialize answer.
  expect((await request.get("/api/mcp")).status()).toBe(405);
  const legacy = await request.post("/api/mcp", { headers: { "x-forwarded-for": address }, data: { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "old", version: "1" } } } });
  expect(await legacy.json()).toMatchObject({ result: { protocolVersion: "2025-06-18", serverInfo: { name: "vitrine" } } });

  const profile = await request.get("/.well-known/ucp");
  expect(profile.headers()["cache-control"]).toContain("public");
  expect(await profile.json()).toMatchObject({ ucp: { services: { "dev.ucp.shopping": [{ transport: "mcp", endpoint: expect.stringMatching(/\/api\/mcp$/) }] }, payment_handlers: {} } });
});

test("a shopper makes a key, their agent fills their cart with it, and revoking it stops the agent", async ({ browser, request }) => {
  const page = await freshPage(browser);
  const address = clientAddress();
  const email = uniqueEmail("agent");
  await signUpAndConfirm(page, email);

  await page.locator('[data-agent-id="account:agents-link"]').click();
  await expect(page.getByRole("heading", { level: 1, name: "Your AI assistants" })).toBeVisible();
  await expect(page.locator('[data-agent-id="agents:mcp-url"]')).toHaveText(/\/api\/mcp$/);
  const axe = await new AxeBuilder({ page }).include('[data-agent-id="agents:page"]').analyze();
  expect(axe.violations).toEqual([]);

  await page.locator('[data-agent-id="agents:name"]').fill("Claude on my laptop");
  await page.locator('[data-agent-id="agents:scope:orders"]').check();
  await page.locator('[data-agent-id="action:make-agent-key"]').click();
  const shown = page.locator('[data-agent-id="agents:new-key-value"]');
  await expect(shown).toHaveText(/^vta_[A-Za-z0-9_-]{43}$/);
  const key = (await shown.textContent())!;
  await expect(page.locator('[data-agent-id="agents:config"]')).toContainText(`"Authorization": "Bearer ${key}"`);
  await expect(page.locator('[data-agent-id="agents:list"]')).toContainText(`…${key.slice(-4)}`);

  // The agent, with the key: its tool list grows, and the lamp lands in this shopper's own cart.
  const list = await mcp(request, "tools/list", {}, { key, address });
  expect((list.body?.result?.tools as { name: string }[]).map((tool) => tool.name)).toEqual(expect.arrayContaining(["get_cart", "add_to_cart", "get_orders"]));
  expect(list.body?.result?.cacheScope).toBe("private");
  const added = await mcp(request, "tools/call", { name: "add_to_cart", arguments: { productId: await lampId(request, address), quantity: 2 } }, { key, address });
  expect(added.body?.result).toMatchObject({ isError: false, structuredContent: { ok: true, quantity: 2 } });
  await page.goto("/en/cart", { waitUntil: "domcontentloaded" });
  await expect(page.locator('[data-agent-id="cart:lines"]')).toContainText("Faux Wood Table Lamp");
  const checkout = await mcp(request, "tools/call", { name: "start_checkout", arguments: {} }, { key, address });
  expect(checkout.body?.result).toMatchObject({ structuredContent: { ok: true, links: [{ url: expect.stringMatching(/\/en\/checkout$/) }] } });

  // Revoked on the page: the next call is refused outright.
  await page.goto("/en/account/agents", { waitUntil: "domcontentloaded" });
  await page.locator('[data-agent-id^="action:revoke-agent-key:"]').first().click();
  await expect(page.locator('[data-agent-id="agents:list"]')).toContainText("Revoked");
  const after = await mcp(request, "tools/list", {}, { key, address });
  expect(after.status).toBe(401);
  await page.context().close();
});

test("a UCP checkout is priced by the shop and handed to the buyer's own cart", async ({ browser, request }) => {
  const address = clientAddress();
  const agent = { "ucp-agent": { profile: "https://platform.example/profile.json" } };
  const created = await mcp(request, "tools/call", { name: "create_checkout", arguments: { meta: agent, checkout: { line_items: [{ item: { id: await lampId(request, address) }, quantity: 1 }] } } }, { address });
  const session = created.body?.result?.structuredContent as { id: string; status: string; continue_url: string; totals: { type: string; amount: number }[] };
  expect(session.status).toBe("requires_escalation");
  const total = session.totals.find((entry) => entry.type === "total")!.amount;
  expect(session.totals.filter((entry) => entry.type !== "total").reduce((sum, entry) => sum + entry.amount, 0)).toBe(total);

  // complete_checkout never places an order through the API.
  const completed = await mcp(request, "tools/call", { name: "complete_checkout", arguments: { meta: { ...agent, "idempotency-key": crypto.randomUUID() }, id: session.id, checkout: {} } }, { address });
  expect(completed.body?.result?.structuredContent).toMatchObject({ status: "requires_escalation", messages: expect.arrayContaining([expect.objectContaining({ code: "complete_on_page" })]) });

  const page = await freshPage(browser);
  await page.goto(session.continue_url.replace(/^https?:\/\/[^/]+/, ""), { waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(/\/en\/cart\?handoff=agent$/);
  await expect(page.locator('[data-agent-id="cart:handoff"]')).toContainText("Nothing has been ordered or paid");
  await expect(page.locator('[data-agent-id="cart:lines"]')).toContainText("Faux Wood Table Lamp");

  // The link hands the cart over once; opened again, it says so.
  const again = await freshPage(browser);
  await again.goto(session.continue_url.replace(/^https?:\/\/[^/]+/, ""), { waitUntil: "domcontentloaded" });
  await expect(again).toHaveURL(/\/en\/cart\?handoff=(agent|gone)$/);
  await page.context().close();
  await again.context().close();
});

test("WebMCP: an assistant built into the browser gets the shop's tools and can open a page", async ({ browser }) => {
  const page = await freshPage(browser);
  // A stand-in for the browser's model context (WebMCP draft, 28 September 2026): it keeps what the page registers.
  await page.addInitScript(() => {
    const tools: { name: string; execute: (input: object, options: { signal: AbortSignal }) => Promise<unknown> }[] = [];
    Object.defineProperty(document, "modelContext", { value: { registerTool: async (tool: (typeof tools)[number]) => void tools.push(tool) }, configurable: true });
    (window as unknown as { __webmcpTools: typeof tools }).__webmcpTools = tools;
  });
  await page.goto("/en", { waitUntil: "domcontentloaded" });
  await expect.poll(() => page.evaluate(() => (window as unknown as { vitrineWebMcp?: { registered: number } }).vitrineWebMcp?.registered ?? 0)).toBeGreaterThan(5);
  const names = await page.evaluate(() => (window as unknown as { __webmcpTools: { name: string }[] }).__webmcpTools.map((tool) => tool.name));
  expect(names).toEqual(expect.arrayContaining(["search_products", "add_to_cart", "navigate"]));
  expect(names).not.toContain("start_checkout");

  const found = await page.evaluate(async () => {
    const tool = (window as unknown as { __webmcpTools: { name: string; execute: (input: object, options: { signal: AbortSignal }) => Promise<unknown> }[] }).__webmcpTools.find((entry) => entry.name === "search_products")!;
    return tool.execute({ query: "lamp" }, { signal: new AbortController().signal });
  });
  expect(found).toMatchObject({ products: expect.any(Array) });

  await page.evaluate(async () => {
    const tool = (window as unknown as { __webmcpTools: { name: string; execute: (input: object, options: { signal: AbortSignal }) => Promise<unknown> }[] }).__webmcpTools.find((entry) => entry.name === "navigate")!;
    await tool.execute({ href: "/showcase" }, { signal: new AbortController().signal });
  });
  await expect(page).toHaveURL(/\/en\/showcase/);
  await page.context().close();
});
