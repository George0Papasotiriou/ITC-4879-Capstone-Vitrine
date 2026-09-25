/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * The contract every AI capability follows: a typed tool with a scope, a context and the services it may call.
 */

import type { z } from "zod";

import type { Actor, CostlyAction } from "@/lib/ai/usage";
import type { Role } from "@/lib/auth/roles";
import type { ProductCard, ProductDetail } from "@/lib/catalog/queries";
import type { CartChange, CartView, OrderSummary, OrderView } from "@/lib/commerce/store";
import type { RatingSummary } from "@/lib/commerce/reviews";
import type { SetWatchResult } from "@/lib/commerce/price-watch-store";
import type { PublicReview } from "@/lib/commerce/review-store";
import type { StylistRequest, StylistResult } from "@/lib/stylist/stylist";
import type { TicketTopic } from "@/lib/support/tickets";

/**
 * One tool registry (CLAUDE.md rule 4, docs/PLAN.md 2.5). Chat, voice, the
 * support assistant and, later, MCP are thin adapters over these tools; none
 * of them carries its own copy of what a tool does.
 *
 * Scopes decide what a surface may do without asking:
 * - read: looks things up; runs at once.
 * - ui: returns commands for the page (navigate, highlight…); runs at once.
 * - cart: changes the cart; runs at once and can be undone.
 * - account: the shopper's own orders and data; needs a known owner.
 * - costly: spends credits (try-on, video); asks first.
 * - sensitive: checkout, returns; asks first, and the shopper finishes it on the page.
 *
 * Authorization lives in each tool's `run`, never in the prompt: the model can
 * ask for anything, a tool only does what the person in `ctx` may do.
 */

export type ToolScope = "read" | "ui" | "cart" | "account" | "costly" | "sensitive";
export type Surface = "chat" | "voice" | "support" | "eval";

export type ToolUser = { id: string; email: string; emailVerified: boolean; roles: Role[] };

/** What the tools can reach. Built per request on the server; faked in tests. */
export type ToolServices = {
  search(query: string, options: { category?: string; limit: number }): Promise<{ ids: string[]; corrected: boolean; relaxed: boolean }>;
  /** Cards with prices for the shopper's country, from the database. */
  cards(ids: readonly string[]): Promise<ProductCard[]>;
  /** Full details (dimensions, materials, rating) for comparisons; same prices as cards. */
  details(ids: readonly string[]): Promise<ProductDetail[]>;
  /** Neighbours of a product in the Taste Graph (A2), or the shopper's own picks. */
  recommend(input: { productId: string | null; limit: number }): Promise<string[]>;
  /** The Budget Stylist (A3). */
  bundles(request: StylistRequest): Promise<StylistResult>;
  reviews(productId: string): Promise<{ summary: RatingSummary; reviews: PublicReview[] }>;
  productIdBySlug(slug: string): Promise<string | null>;
  cart: {
    view(): Promise<CartView>;
    /** Adds or sets a quantity; creates the cart when needed and remembers it for the shopper. */
    change(variantId: string, quantity: number, mode: "add" | "set"): Promise<CartChange>;
    defaultVariant(productId: string): Promise<string | null>;
    /** A signed token that puts the line back to `quantity` (src/lib/ai/tools/undo.ts). */
    undoToken(payload: { cartId: string; variantId: string; quantity: number }): string;
  };
  /** The Fitting Room (docs/adr/023): the photograph the shopper gave, and one try-on. */
  tryOn: {
    /** The newest photograph this shopper gave for trying pieces on, if any. */
    photo(): Promise<{ id: string; minutesLeft: number } | null>;
    start(input: { photoId: string; productId: string }): Promise<{ ok: true; id: string } | { ok: false; reason: string }>;
  };
  /** Search by photo (docs/adr/024): the photograph the shopper gave, and what the shop has like it. */
  snap: {
    photo(): Promise<{ id: string } | null>;
    search(input: { photoId: string; category?: string }): Promise<{ ids: string[]; colours: string[] }>;
  };
  /** Price watches on one product, for the signed-in shopper (docs/adr/020). */
  watch: {
    get(productId: string): Promise<{ targetCents: number } | null>;
    set(productId: string, targetCents: number): Promise<SetWatchResult>;
    remove(productId: string): Promise<boolean>;
  };
  /** The support desk (docs/adr/021, 027): a person takes over from the Concierge. */
  support: {
    /**
     * Opens a ticket for the signed-in shopper with the summary they approved,
     * and hands the staff the conversation as an internal note.
     */
    handOver(input: { summary: string; topic: TicketTopic; orderNumber?: string }): Promise<{ ok: true; id: string; number: string } | { ok: false; reason: "slow_down" | "failed" }>;
  };
  orders: {
    /** The signed-in shopper's orders, or the guest's most recent one. */
    mine(): Promise<OrderSummary[]>;
    /** One of the shopper's own orders by number; null for anyone else's. */
    byNumber(number: string): Promise<OrderView | null>;
    /** Asks for a return of one of the shopper's own delivered orders. */
    requestReturn(orderId: string, reason: string): Promise<{ ok: true } | { ok: false; reason: string }>;
  };
};

export type ToolContext = {
  locale: "en" | "el";
  surface: Surface;
  user: ToolUser | null;
  actor: Actor;
  services: ToolServices;
  signal?: AbortSignal;
};

export type VitrineTool<I = unknown, O = unknown> = {
  /** Stable snake_case: prompts, evals and logs refer to it. */
  name: string;
  /** When to use it AND when not to (CLAUDE.md conventions). */
  description: string;
  scope: ToolScope;
  input: z.ZodType<I>;
  output: z.ZodType<O>;
  /** Costly tools name the allowance they spend. */
  credits?: CostlyAction;
  /** Surfaces that may offer the tool; all when omitted. */
  surfaces?: readonly Surface[];
  run(ctx: ToolContext, input: I): Promise<O>;
};

/** Scopes that ask the shopper before running. */
export const APPROVAL_SCOPES: readonly ToolScope[] = ["costly", "sensitive"];

/** A tool's refusal: a typed result the model can explain, never an exception. */
export type Refusal = { ok: false; reason: string };
