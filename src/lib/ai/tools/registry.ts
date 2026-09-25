/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * The one tool registry: every tool, which surfaces offer it, and running one with its input and output checked.
 */

import { getOrders, getOrderStatus, setPriceWatch, startCheckout, startReturn, tryOnPiece } from "@/lib/ai/tools/account";
import { addToCart, removeFromCart, updateCartItem } from "@/lib/ai/tools/cart";
import { buildBundle, compareProducts, findByPhoto, getProducts, recommend, searchProducts, summarizeReviews } from "@/lib/ai/tools/catalog";
import { handToPerson } from "@/lib/ai/tools/support";
import { APPROVAL_SCOPES, type Surface, type ToolContext, type VitrineTool } from "@/lib/ai/tools/types";
import { highlight, navigate, openViewer, setFilters, showProducts } from "@/lib/ai/tools/ui";

/**
 * Every surface reads this list (CLAUDE.md rule 4). Adding a capability means
 * adding one tool here; chat, voice and support pick it up with the same
 * authorization, approvals and cost accounting.
 */

/** Tools keep their exact types where they are written; the registry holds them erased, and checks input and output at run time. */
const erase = <I, O>(tool: VitrineTool<I, O>) => tool as unknown as VitrineTool<unknown, unknown>;

export const TOOLS: readonly VitrineTool<unknown, unknown>[] = [
  searchProducts,
  getProducts,
  compareProducts,
  recommend,
  buildBundle,
  summarizeReviews,
  findByPhoto,
  navigate,
  setFilters,
  highlight,
  showProducts,
  openViewer,
  addToCart,
  updateCartItem,
  removeFromCart,
  getOrders,
  getOrderStatus,
  setPriceWatch,
  tryOnPiece,
  startCheckout,
  startReturn,
  handToPerson,
].map((tool) => erase(tool as VitrineTool<never, unknown>));

/** The support assistant helps with orders and policies; it does not shop or drive the page. */
const SUPPORT_TOOLS = new Set<string>(["get_orders", "get_order_status", "start_return", "search_products", "get_products", "summarize_reviews"]);

export function toolsFor(surface: Surface): VitrineTool<unknown, unknown>[] {
  return TOOLS.filter((tool) => tool.surfaces === undefined || tool.surfaces.includes(surface)).filter((tool) => surface !== "support" || SUPPORT_TOOLS.has(tool.name));
}

export function findTool(name: string, surface: Surface): VitrineTool<unknown, unknown> | null {
  return toolsFor(surface).find((tool) => tool.name === name) ?? null;
}

export function needsApproval(tool: Pick<VitrineTool, "scope">): boolean {
  return APPROVAL_SCOPES.includes(tool.scope);
}

export type ToolRun = { ok: true; output: unknown } | { ok: false; reason: "invalid_input" | "invalid_output"; issues: string[] };

/**
 * Runs a tool with its input checked against its schema and its output checked
 * too, so a tool can never hand a surface more (or other) than it promises.
 */
export async function runTool(tool: VitrineTool<unknown, unknown>, ctx: ToolContext, input: unknown): Promise<ToolRun> {
  const parsed = tool.input.safeParse(input ?? {});
  if (!parsed.success) return { ok: false, reason: "invalid_input", issues: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`) };
  const output = await tool.run(ctx, parsed.data);
  const checked = tool.output.safeParse(output);
  if (!checked.success) return { ok: false, reason: "invalid_output", issues: checked.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`) };
  return { ok: true, output: checked.data };
}
