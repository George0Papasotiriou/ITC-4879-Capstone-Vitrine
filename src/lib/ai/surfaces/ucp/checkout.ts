/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * UCP checkout over MCP: an agent assembles a checkout session, and the buyer finishes it on the shop's own page.
 */

import { z } from "zod";

import type { McpCallResult, McpToolDefinition } from "@/lib/ai/surfaces/mcp/protocol";
import type { ToolRun } from "@/lib/ai/tools/registry";

/**
 * docs/adr/043. The Universal Commerce Protocol's checkout capability
 * (dev.ucp.shopping.checkout, version 2026-08-25), MCP binding: five tools,
 * `create_checkout`, `get_checkout`, `update_checkout`, `complete_checkout`
 * and `cancel_checkout`.
 *
 * UCP says a checkout "has to be finalized manually by the user through a
 * trusted UI" unless the business supports AP2 mandates, which this shop does
 * not. So a session with pieces in it is always `requires_escalation`, and its
 * `continue_url` opens the shop's own cart with those pieces, in the buyer's
 * browser; the buyer chooses delivery, sees the price and pays there
 * (CLAUDE.md rule 5). `complete_checkout` never places an order.
 *
 * A session is a cart of its own, changed only through the registry's cart
 * tools (rule 4), so stock limits and prices are the shop's. Its id is the
 * cart's id signed with the shop's secret: it cannot be guessed or forged,
 * and it is all a session needs — nothing is stored beside the cart. Buyer
 * details an agent sends are not kept: the buyer gives them at checkout.
 */

export const UCP_VERSION = "2026-08-25";
export const UCP_CHECKOUT = "dev.ucp.shopping.checkout";
/**
 * Session ids are signed under their own purpose, so a cart cookie (signed with
 * the same secret, without it) can never be used as a checkout id, nor a
 * checkout id as a cookie.
 */
export const UCP_SIGNING_PREFIX = "ucp:";

/** What the adapter needs from the shop, per session. */
export type UcpDeps = {
  /** Runs a registry tool on the cart with this id (the cart is made on the first add). */
  runOn(cartId: string): (tool: string, input: Record<string, unknown>) => Promise<ToolRun>;
  newCartId(): string;
  sign(cartId: string): string;
  verify(signed: string): string | null;
  appUrl: string;
  locale: "en" | "el";
};

const meta = z.looseObject({ "ucp-agent": z.looseObject({ profile: z.string().min(1) }), "idempotency-key": z.string().min(1).optional() });
const metaWithKey = z.looseObject({ "ucp-agent": z.looseObject({ profile: z.string().min(1) }), "idempotency-key": z.string().min(1) });
const lineItem = z.looseObject({ id: z.string().optional(), item: z.looseObject({ id: z.string().min(1) }), quantity: z.number().int().min(0).max(10) });
const checkoutPayload = z.looseObject({ line_items: z.array(lineItem).max(20).optional(), currency: z.string().optional() });

export const UCP_INPUTS = {
  create_checkout: z.object({ meta, checkout: checkoutPayload.extend({ line_items: z.array(lineItem).min(1).max(20) }) }),
  get_checkout: z.object({ meta, id: z.string().min(1) }),
  update_checkout: z.object({ meta, id: z.string().min(1), checkout: checkoutPayload }),
  complete_checkout: z.object({ meta: metaWithKey, id: z.string().min(1), checkout: z.looseObject({}).optional() }),
  cancel_checkout: z.object({ meta: metaWithKey, id: z.string().min(1) }),
} as const;
export type UcpTool = keyof typeof UCP_INPUTS;

const DESCRIPTIONS: Record<UcpTool, string> = {
  create_checkout:
    "UCP (dev.ucp.shopping.checkout): start a checkout session with line items, each `item.id` a product id from search_products and a quantity. " +
    "The answer is the session with the shop's prices and totals and a continue_url where the buyer reviews, chooses delivery and pays. Orders are never placed through the API.",
  get_checkout: "UCP: the current state of a checkout session, by its id. Use it to show the buyer the shop's totals again.",
  update_checkout: "UCP: replace a session's line items (quantity 0 removes a piece). Use it when the buyer changes what they want before opening continue_url.",
  complete_checkout:
    "UCP: this shop does not complete checkouts through the API; the answer repeats the continue_url where the buyer finishes and pays. Call it only if your platform must, and then hand the buyer the link.",
  cancel_checkout: "UCP: empty and close a checkout session the buyer no longer wants.",
};

export function ucpDefinitions(): McpToolDefinition[] {
  return (Object.keys(UCP_INPUTS) as UcpTool[]).map((name) => ({
    name,
    title: name.replace(/_/g, " ").replace(/^./, (first) => first.toUpperCase()),
    description: DESCRIPTIONS[name],
    inputSchema: z.toJSONSchema(UCP_INPUTS[name], { io: "input", unrepresentable: "any" }) as Record<string, unknown>,
    annotations: { readOnlyHint: name === "get_checkout", destructiveHint: name === "cancel_checkout", idempotentHint: name !== "create_checkout", openWorldHint: false },
  }));
}

type Message =
  | { type: "error"; code: string; content: string; severity: "recoverable" | "requires_buyer_input" | "requires_buyer_review" | "unrecoverable"; path?: string }
  | { type: "warning"; code: string; content: string; path?: string }
  | { type: "info"; code?: string; content: string; path?: string };

type CartOutput = {
  lines: { productId: string; slug: string; title: string; quantity: number; unitPriceCents: number; available: boolean }[];
  items: number;
  subtotalCents: number;
  shippingCents: number;
  totalCents: number;
  currency: string;
};

const envelope = (status: "success" | "error") => ({ version: UCP_VERSION, status, capabilities: { [UCP_CHECKOUT]: [{ version: UCP_VERSION }] }, payment_handlers: {} });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function result(structured: Record<string, unknown>, isError = false): McpCallResult {
  return { content: [{ type: "text", text: JSON.stringify(structured) }], structuredContent: structured, isError };
}

function failure(code: string, content: string, deps: UcpDeps, severity: "recoverable" | "unrecoverable" = "unrecoverable", isError = false): McpCallResult {
  return result({ ucp: envelope("error"), messages: [{ type: "error", code, content, severity }], continue_url: new URL(`/${deps.locale}`, deps.appUrl).toString() }, isError);
}

/** The checkout as UCP describes it, from the cart as the shop prices it. */
export function checkoutObject({ id, cart, messages, canceled, deps }: { id: string; cart: CartOutput; messages: Message[]; canceled?: boolean; deps: UcpDeps }) {
  const el = deps.locale === "el";
  const url = (path: string) => new URL(`/${deps.locale}${path}`, deps.appUrl).toString();
  const lines = cart.lines.map((line, index) => {
    const amount = line.unitPriceCents * line.quantity;
    if (!line.available) messages.push({ type: "warning", code: "item_unavailable", content: `${line.title} can no longer be bought and is left out of the totals.`, path: `$.line_items[${index}]` });
    return {
      id: `li_${line.productId}`,
      item: { id: line.productId, title: line.title, price: line.unitPriceCents },
      quantity: line.quantity,
      totals: [{ type: "subtotal", amount }, { type: "total", amount: line.available ? amount : 0 }],
    };
  });
  // UCP requires exactly one subtotal and one total, and the entries in between to add up to the total.
  const totals: { type: string; display_text?: string; amount: number }[] = [
    { type: "subtotal", display_text: el ? "Υποσύνολο (με ΦΠΑ)" : "Subtotal (VAT included)", amount: cart.subtotalCents },
    { type: "fulfillment", display_text: el ? "Παράδοση (τυπική, εκτίμηση)" : "Delivery (standard, estimate)", amount: cart.shippingCents },
  ];
  const rest = cart.totalCents - cart.subtotalCents - cart.shippingCents;
  if (rest !== 0) totals.push({ type: "tax", display_text: el ? "Φόροι" : "Tax", amount: rest });
  totals.push({ type: "total", display_text: el ? "Σύνολο" : "Total", amount: cart.totalCents });

  const blocking = messages.some((message) => message.type === "error" && message.severity === "recoverable");
  let status: "incomplete" | "requires_escalation" | "canceled";
  if (canceled === true) status = "canceled";
  else if (blocking || cart.items === 0) status = "incomplete";
  else {
    status = "requires_escalation";
    messages.push({
      type: "error",
      code: "buyer_handoff_required",
      severity: "requires_buyer_input",
      content: "The buyer chooses delivery, checks the order and pays on the shop's own page at continue_url. This shop does not place orders through the API.",
    });
  }
  if (cart.items === 0 && canceled !== true) messages.push({ type: "info", code: "empty", content: "The session has no pieces yet; add line items with update_checkout." });

  return {
    ucp: envelope("success"),
    id,
    status,
    currency: cart.currency,
    line_items: lines,
    totals,
    links: [
      { type: "privacy_policy", url: url("/privacy") },
      { type: "shipping_policy", url: url("/shipping") },
      { type: "refund_policy", url: url("/shipping") },
    ],
    messages,
    ...(status === "canceled" ? {} : { continue_url: `${new URL("/api/cart/resume", deps.appUrl).toString()}?c=${encodeURIComponent(id.slice(4))}&locale=${deps.locale}` }),
  };
}

/** Sets the session's cart to exactly these lines, through the registry's cart tools; what could not be done becomes messages. */
async function setLines(run: (tool: string, input: Record<string, unknown>) => Promise<ToolRun>, wanted: z.infer<typeof lineItem>[], replace: boolean): Promise<Message[]> {
  const messages: Message[] = [];
  const before = await run("get_cart", {});
  const current = before.ok ? (before.output as CartOutput).lines : [];
  if (replace) {
    const keep = new Set(wanted.map((line) => line.item.id));
    for (const line of current) if (!keep.has(line.productId)) await run("remove_from_cart", { productId: line.productId });
  }
  for (const [index, line] of wanted.entries()) {
    const path = `$.line_items[${index}]`;
    if (!UUID.test(line.item.id)) {
      messages.push({ type: "error", code: "item_unavailable", severity: "recoverable", content: `No piece has the id ${line.item.id.slice(0, 60)}; use an id from search_products.`, path });
      continue;
    }
    const exists = current.some((entry) => entry.productId === line.item.id);
    if (line.quantity === 0 && !exists) continue;
    const changed = exists || line.quantity === 0 ? await run("update_cart_item", { productId: line.item.id, quantity: line.quantity }) : await run("add_to_cart", { productId: line.item.id, quantity: line.quantity });
    const output = changed.ok ? (changed.output as { ok: boolean; reason?: string; limitedTo?: number | null }) : { ok: false, reason: "invalid" };
    if (!output.ok) {
      messages.push({ type: "error", code: output.reason === "out_of_stock" ? "out_of_stock" : "item_unavailable", severity: "recoverable", content: `That piece cannot be added (${output.reason ?? "unavailable"}).`, path });
    } else if (output.limitedTo !== null && output.limitedTo !== undefined) {
      messages.push({ type: "warning", code: "quantity_adjusted", content: `Quantity adjusted: requested ${line.quantity}, the shop can give ${output.limitedTo}.`, path: `${path}.quantity` });
    }
  }
  return messages;
}

/** Runs one UCP tool; null when the name is not a UCP tool. */
export async function callUcpTool(name: string, args: Record<string, unknown>, deps: UcpDeps): Promise<McpCallResult | null> {
  if (!(name in UCP_INPUTS)) return null;
  const tool = name as UcpTool;
  const parsed = UCP_INPUTS[tool].safeParse(args);
  if (!parsed.success) {
    return failure("invalid_request", `The request was not accepted: ${parsed.error.issues.slice(0, 5).map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`, deps, "recoverable", true);
  }

  if (tool === "create_checkout") {
    const input = parsed.data as z.infer<(typeof UCP_INPUTS)["create_checkout"]>;
    const cartId = deps.newCartId();
    const run = deps.runOn(cartId);
    const messages = await setLines(run, input.checkout.line_items, false);
    const cart = await run("get_cart", {});
    if (!cart.ok || (cart.output as CartOutput).items === 0) {
      return result({ ucp: envelope("error"), messages: messages.map((message) => (message.type === "error" ? { ...message, severity: "unrecoverable" } : message)), continue_url: new URL(`/${deps.locale}`, deps.appUrl).toString() });
    }
    if (input.checkout.currency !== undefined && input.checkout.currency.toUpperCase() !== (cart.output as CartOutput).currency) {
      messages.push({ type: "warning", code: "currency_changed", content: `This shop sells in ${(cart.output as CartOutput).currency}; the session is priced in it.` });
    }
    return result(checkoutObject({ id: `chk_${deps.sign(cartId)}`, cart: cart.output as CartOutput, messages, deps }));
  }

  const { id } = parsed.data as { id: string };
  const cartId = id.startsWith("chk_") ? deps.verify(id.slice(4)) : null;
  if (cartId === null) return failure("not_found", "No checkout session has that id.", deps);
  const run = deps.runOn(cartId);

  let messages: Message[] = [];
  let canceled = false;
  if (tool === "update_checkout") {
    const lines = (parsed.data as z.infer<(typeof UCP_INPUTS)["update_checkout"]>).checkout.line_items;
    if (lines !== undefined) messages = await setLines(run, lines, true);
  } else if (tool === "cancel_checkout") {
    // Emptying the cart is the whole of cancelling: running it twice changes nothing more.
    const before = await run("get_cart", {});
    for (const line of before.ok ? (before.output as CartOutput).lines : []) await run("remove_from_cart", { productId: line.productId });
    canceled = true;
  }
  const cart = await run("get_cart", {});
  if (!cart.ok) return failure("not_found", "No checkout session has that id.", deps);
  const checkout = checkoutObject({ id, cart: cart.output as CartOutput, messages, canceled, deps });
  if (tool === "complete_checkout" && checkout.status !== "canceled") {
    checkout.messages.push({ type: "info", code: "complete_on_page", content: "Nothing was charged and no order was placed: open continue_url so the buyer can finish." });
  }
  return result(checkout);
}
