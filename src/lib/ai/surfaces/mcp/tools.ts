/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * The registry's tools as an outside agent sees them over MCP: which ones, what each needs, and their answers.
 */

import { z } from "zod";

import type { AgentScope } from "@/lib/agents/tokens";
import type { McpCallResult, McpToolDefinition } from "@/lib/ai/surfaces/mcp/protocol";
import { runTool, TOOLS } from "@/lib/ai/tools/registry";
import type { ToolContext, VitrineTool } from "@/lib/ai/tools/types";

/**
 * docs/adr/043. Only the registry's tools, run by the registry (CLAUDE.md
 * rule 4); this file decides which of them an agent outside the shop may use
 * and turns their answers into MCP results.
 *
 * - The catalogue is open: searching, reading, comparing, recommending,
 *   building a set, reading reviews, composing a shop window.
 * - The cart and the orders need a key the shopper made, allowed to use them.
 * - Checkout gives back the link to the shop's own checkout page, where the
 *   shopper pays; nothing here takes money (rule 5).
 * - Nothing else is offered: tools that drive a page, photographs, the
 *   shopper's preferences, returns, price watches and the desk stay with the
 *   shop's own Concierge, where the shopper sees and approves them.
 */

export type McpAccess = "open" | AgentScope;

export const MCP_TOOL_ACCESS: Readonly<Record<string, McpAccess>> = {
  search_products: "open",
  get_products: "open",
  compare_products: "open",
  recommend: "open",
  build_bundle: "open",
  summarize_reviews: "open",
  compose_showcase: "open",
  get_cart: "cart",
  add_to_cart: "cart",
  update_cart_item: "cart",
  remove_from_cart: "cart",
  start_checkout: "cart",
  get_orders: "orders",
  get_order_status: "orders",
};

/** The fields that only mean something on the shop's own page, filled in for an agent that has none. */
const PAGE_ONLY_DEFAULTS: Readonly<Record<string, unknown>> = { caption: "Opening it in the shop" };

/** An agent's input with the page-only fields filled in where the tool has them (MCP and WebMCP). */
export function withPageDefaults(tool: VitrineTool<unknown, unknown>, args: unknown): unknown {
  if (typeof args !== "object" || args === null || Array.isArray(args)) return args;
  const shape = (tool.input as { shape?: Record<string, unknown> }).shape ?? {};
  return { ...Object.fromEntries(Object.entries(PAGE_ONLY_DEFAULTS).filter(([field]) => field in shape)), ...args };
}

/** The tools an agent with these permissions may use, in the registry's order. */
export function mcpTools(scopes: readonly AgentScope[]): VitrineTool<unknown, unknown>[] {
  return TOOLS.filter((tool) => {
    const access = MCP_TOOL_ACCESS[tool.name];
    return access !== undefined && (access === "open" || scopes.includes(access));
  });
}

/** A tool's MCP description: its registry description and its input as JSON Schema, without page-only fields. */
export function mcpDefinition(tool: VitrineTool<unknown, unknown>): McpToolDefinition {
  const schema = z.toJSONSchema(tool.input, { io: "input", unrepresentable: "any" }) as Record<string, unknown>;
  const properties = { ...((schema.properties as Record<string, unknown> | undefined) ?? {}) };
  for (const field of Object.keys(PAGE_ONLY_DEFAULTS)) delete properties[field];
  const required = Array.isArray(schema.required) ? (schema.required as string[]).filter((field) => !(field in PAGE_ONLY_DEFAULTS)) : undefined;
  const readOnly = tool.scope === "read" || tool.name === "compose_showcase" || tool.name === "start_checkout" || MCP_TOOL_ACCESS[tool.name] === "orders";
  return {
    name: tool.name,
    title: tool.name.replace(/_/g, " ").replace(/^./, (first) => first.toUpperCase()),
    description: tool.description,
    inputSchema: { ...schema, properties, ...(required === undefined || required.length === 0 ? { required: undefined } : { required }) },
    annotations: {
      readOnlyHint: readOnly,
      // Cart changes are undone by another call; nothing here deletes or pays.
      destructiveHint: false,
      idempotentHint: readOnly || tool.name === "update_cart_item" || tool.name === "remove_from_cart",
      openWorldHint: false,
    },
  };
}

/**
 * A tool's answer as an MCP result. Commands meant for the shop's page (open
 * the checkout, open a shop window) become links the shopper can open, on the
 * shop's own address and in the agent's language. An answer that says
 * `ok: false` is a tool error the model can explain or recover from.
 */
export function mcpResult(output: unknown, { appUrl, locale }: { appUrl: string; locale: "en" | "el" }): McpCallResult {
  const structured = { ...(output as Record<string, unknown>) };
  if (Array.isArray(structured.commands)) {
    const links = (structured.commands as { type: string; href?: string; caption?: string }[])
      .filter((command) => command.type === "navigate" && typeof command.href === "string")
      .map((command) => ({ url: new URL(`/${locale}${command.href}`, appUrl).toString(), caption: command.caption ?? null }));
    delete structured.commands;
    if (links.length > 0) structured.links = links;
  }
  return { content: [{ type: "text", text: JSON.stringify(structured) }], structuredContent: structured, isError: structured.ok === false };
}

/** A plain-words tool error, for a call the agent may not make or input the tool refused. */
export function mcpToolError(text: string, detail?: Record<string, unknown>): McpCallResult {
  return { content: [{ type: "text", text }], ...(detail === undefined ? {} : { structuredContent: detail }), isError: true };
}

/**
 * Runs one tool for an agent: page-only fields filled, the registry's own
 * input and output checks, and the answer as MCP. A tool that needs a key the
 * agent lacks says where to get one rather than pretending not to exist.
 */
export async function callMcpTool(
  name: string,
  args: Record<string, unknown>,
  { scopes, ctx, appUrl }: { scopes: readonly AgentScope[]; ctx: ToolContext; appUrl: string },
): Promise<McpCallResult | null> {
  const access = MCP_TOOL_ACCESS[name];
  const tool = TOOLS.find((entry) => entry.name === name);
  if (access === undefined || tool === undefined) return null;
  if (access !== "open" && !scopes.includes(access)) {
    return mcpToolError(
      `${name} works on the shopper's own ${access === "cart" ? "cart" : "orders"}, so it needs an agent key allowed to use the ${access}. ` +
        `The shopper makes one at ${new URL(`/${ctx.locale}/account/agents`, appUrl).toString()} and gives it to you as "Authorization: Bearer <key>".`,
      { ok: false, reason: "key_needed", scope: access },
    );
  }
  const run = await runTool(tool, ctx, withPageDefaults(tool, args));
  if (!run.ok) return mcpToolError(run.reason === "invalid_input" ? `The input was not accepted: ${run.issues.join("; ")}` : "The tool could not answer.", { ok: false, reason: run.reason });
  return mcpResult(run.output, { appUrl, locale: ctx.locale });
}
