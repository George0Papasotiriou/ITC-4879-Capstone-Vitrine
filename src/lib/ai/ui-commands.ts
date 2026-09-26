/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Concierge UI control protocol: validated declarative commands and the route allowlist.
 */

import { z } from "zod";

import { comfortPatchSchema } from "@/lib/comfort/settings";
import { preferencesPatchSchema } from "@/lib/prefs/preferences";

/**
 * The UI control protocol (docs/PLAN.md 2.5)
 *
 * The Concierge never sends code to the browser. It sends *commands*: small,
 * declarative, validated objects describing an intent ("filter this listing to
 * oak"). The client decides how to perform them, plays each one through the
 * Spotlight, and records an inverse so the user can undo it.
 *
 * That boundary is the whole safety story for agent-driven UI. A model that can
 * only emit `{ type: "navigate", href: "/lamps" }` cannot navigate to an
 * attacker's domain, cannot inject markup, and cannot reach anything that is
 * not in the allowlist below — regardless of what a poisoned product review
 * told it to do (2.5 guardrails, E8).
 */

/**
 * Routes the Concierge may navigate to. Patterns, not free strings: an
 * allowlist is the difference between "go to the lamps category" and an open
 * redirect. Anchors and protocol-relative URLs are rejected by construction
 * because every pattern is anchored at both ends.
 */
const ROUTE_ALLOWLIST: readonly RegExp[] = [
  /^\/$/,
  /^\/design$/,
  /^\/c$/, // the whole collection
  /^\/c\/[a-z0-9-]{1,64}$/, // category
  /^\/p\/[a-z0-9-]{1,96}$/, // product
  /^\/search$/,
  /^\/cart$/,
  /^\/account(?:\/[a-z0-9-]{1,32})?$/,
  // Checkout only opens the page: the shopper reviews and pays there themselves (CLAUDE.md rule 5).
  /^\/checkout$/,
  /^\/room$/,
  // The Fitting Room, where a shopper's own photograph lives (docs/adr/023).
  /^\/fitting-room$/,
  // Search by photo (docs/adr/024).
  /^\/snap$/,
  /^\/stylist$/,
  /^\/taste$/,
  /^\/(?:shipping|privacy|contact|credits)$/,
];

export function isAllowedRoute(href: string): boolean {
  // Reject anything that could leave the origin before pattern matching, so a
  // clever pattern can never be the only line of defence.
  if (href.includes("//") || href.includes(":") || href.includes("\\")) return false;
  const path = href.split("?")[0] ?? "";
  return ROUTE_ALLOWLIST.some((pattern) => pattern.test(path));
}

/**
 * Every element the Concierge can point at carries
 * `data-agent-id="<kind>:<id>"` — for example `product:0192f...`,
 * `filter:color`, `nav:cart`. The shape is constrained so an id cannot be used
 * to smuggle a CSS selector into `querySelector`.
 */
export const agentIdSchema = z
  .string()
  .regex(
    /^[a-z]{1,24}:[A-Za-z0-9_-]{1,64}$/,
    "An agent id looks like `kind:id`, for example `filter:color`.",
  );

/**
 * A caption is shown on screen and read aloud to screen readers, so it is part
 * of the contract rather than a debug string: plain words, sentence case, no
 * jargon. "Filtering to oak", not "setFilters(material=oak)".
 */
const captionSchema = z.string().min(3).max(80);

const navigateCommand = z.object({
  type: z.literal("navigate"),
  href: z.string().refine(isAllowedRoute, "Route is not in the allowlist."),
  caption: captionSchema,
});

const highlightCommand = z.object({
  type: z.literal("highlight"),
  agentId: agentIdSchema,
  caption: captionSchema,
});

const scrollToCommand = z.object({
  type: z.literal("scroll_to"),
  agentId: agentIdSchema,
  caption: captionSchema,
});

const setFiltersCommand = z.object({
  type: z.literal("set_filters"),
  /** The filter panel to spotlight while the change happens. */
  agentId: agentIdSchema,
  /** Facet name to selected values. An empty array clears that facet. */
  filters: z.record(z.string().min(1).max(32), z.array(z.string().min(1).max(64)).max(24)),
  caption: captionSchema,
});

const showProductsCommand = z.object({
  type: z.literal("show_products"),
  /** Product ids only. The component fetches the details from the database. */
  productIds: z.array(z.string().min(1).max(64)).min(1).max(12),
  caption: captionSchema,
});

const openViewerCommand = z.object({
  type: z.literal("open_viewer"),
  agentId: agentIdSchema,
  viewer: z.enum(["spin", "model", "ar", "room"]),
  caption: captionSchema,
});

/**
 * Changes how the shop is shown to this shopper (docs/adr/032): text size,
 * contrast, motion and the rest. The light travels to the comfort button in
 * the header, where the shopper can change it back; the change is undoable.
 */
const comfortCommand = z.object({
  type: z.literal("comfort"),
  agentId: agentIdSchema,
  settings: comfortPatchSchema,
  caption: captionSchema,
});

/**
 * Keeps something the shopper said about themselves (docs/adr/033), after
 * they approved it: the page saves it where their preferences live — the
 * device or the account — and records an undo.
 */
const preferencesCommand = z.object({
  type: z.literal("preferences"),
  agentId: agentIdSchema,
  patch: preferencesPatchSchema,
  caption: captionSchema,
});

export const uiCommandSchema = z.discriminatedUnion("type", [
  navigateCommand,
  highlightCommand,
  scrollToCommand,
  setFiltersCommand,
  showProductsCommand,
  openViewerCommand,
  comfortCommand,
  preferencesCommand,
]);

export type UiCommand = z.infer<typeof uiCommandSchema>;
export type UiCommandType = UiCommand["type"];

/** A batch, capped so one turn cannot drive the interface indefinitely. */
export const uiCommandBatchSchema = z.array(uiCommandSchema).min(1).max(8);

/**
 * Parses commands arriving from the model. Invalid ones are dropped with a
 * reason rather than throwing: one malformed command should not discard a
 * turn's worth of valid work, and the reasons are worth logging.
 */
export function parseCommands(input: unknown): {
  commands: UiCommand[];
  rejected: { index: number; reason: string }[];
} {
  const asArray = Array.isArray(input) ? input : [input];
  const commands: UiCommand[] = [];
  const rejected: { index: number; reason: string }[] = [];

  asArray.slice(0, 8).forEach((candidate, index) => {
    const result = uiCommandSchema.safeParse(candidate);
    if (result.success) {
      commands.push(result.data);
    } else {
      rejected.push({
        index,
        reason: result.error.issues.map((issue) => issue.message).join("; "),
      });
    }
  });

  return { commands, rejected };
}
