/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * The shop's MCP server for one request: who the agent speaks for, their cart, and the tools they may use.
 */

import { connection } from "next/server";
import { uuidv7 } from "uuidv7";

import { serverEnv } from "@/env";
import { logConciergeEvents } from "@/lib/admin/server";
import { createAgentKeyStore, type AgentIdentity, type AgentKeyStore } from "@/lib/agents/store";
import { toolServices, toolUser } from "@/lib/ai/server";
import type { McpServer } from "@/lib/ai/surfaces/mcp/protocol";
import { callMcpTool, mcpDefinition, mcpTools } from "@/lib/ai/surfaces/mcp/tools";
import { callUcpTool, ucpDefinitions, UCP_SIGNING_PREFIX, type UcpDeps } from "@/lib/ai/surfaces/ucp/checkout";
import { findTool, runTool, type ToolRun } from "@/lib/ai/tools/registry";
import type { ToolContext } from "@/lib/ai/tools/types";
import type { CurrentUser } from "@/lib/auth/session";
import { commerce } from "@/lib/commerce/server";
import { cookieSecret } from "@/lib/commerce/services";
import { signValue, verifySignedValue } from "@/lib/commerce/tokens";
import { sql } from "@/lib/db/client";

let keyStore: AgentKeyStore | undefined;

export async function agentKeys(): Promise<AgentKeyStore> {
  await connection();
  return (keyStore ??= createAgentKeyStore(sql));
}

export const MCP_SERVER_INFO = { name: "vitrine", title: "Vitrine", version: "1.0.0" } as const;

export function mcpInstructions(appUrl: string): string {
  return (
    "Vitrine is an EU shop for furniture, lighting, rugs and home pieces, and for clothes, shoes, bags and accessories. " +
    "Prices are in euros for the shopper's country and every figure comes from the shop's database; quote them, never work them out. " +
    "Anyone may search and read the catalogue, compare pieces, read what buyers say, and put a set or a shop window together within a budget. " +
    `The shopper's cart and orders need an agent key the shopper makes at ${new URL("/en/account/agents", appUrl).toString()}, sent as "Authorization: Bearer <key>". ` +
    "Checkout and payment always happen on the shop's own page, which the shopper opens and completes; start_checkout gives you that link."
  );
}

/**
 * Builds the server for one request (docs/adr/043). With a key, the tools act
 * as its owner, on their own cart (made on the first thing added) and orders;
 * without one, only the catalogue is offered.
 */
export async function mcpServerFor({ identity, locale, signal }: { identity: AgentIdentity | null; locale: "en" | "el"; signal?: AbortSignal }): Promise<McpServer> {
  const appUrl = serverEnv().APP_URL;
  const scopes = identity?.scopes ?? [];
  const user: CurrentUser | null = identity === null ? null : { ...identity.user, sessionId: `agent:${identity.keyId}` };

  let cart: { cartId: string | null; userId: string | null } = { cartId: null, userId: null };
  if (user !== null && scopes.includes("cart")) {
    // The account's cart, or a new id the cart will be made under when something is first added.
    cart = { cartId: (await (await commerce()).claimCart(user.id, null)) ?? uuidv7(), userId: user.id };
  }
  const ctx: ToolContext = {
    locale,
    surface: "mcp",
    user: toolUser(user),
    // No allowance is spent here — the agent brings its own model — but a tool still knows whose request it is.
    actor: user === null ? { key: "agent:anonymous", kind: "guest" } : { key: `user:${user.id}`, kind: "customer" },
    services: await toolServices({ locale, user, cart }),
    signal,
  };

  const tools = mcpTools(scopes);
  const ucp = ucpDeps({ locale, appUrl, signal });
  return {
    info: MCP_SERVER_INFO,
    instructions: mcpInstructions(appUrl),
    personal: identity !== null,
    tools: () => [...tools.map(mcpDefinition), ...ucpDefinitions()],
    async call(name, args) {
      const started = performance.now();
      const result = (await callUcpTool(name, args, ucp)) ?? (await callMcpTool(name, args, { scopes, ctx, appUrl }));
      if (result !== null) {
        logConciergeEvents([{ kind: "tool", surface: "mcp", tool: name, outcome: result.isError ? "error" : "ok", latencyMs: performance.now() - started }]);
      }
      return result;
    },
  };
}

/**
 * UCP checkout sessions (src/lib/ai/surfaces/ucp/checkout.ts): each one a
 * guest cart of its own, changed through the registry as nobody in
 * particular. Once a buyer has taken the cart into an account, the session is
 * closed to the agent: the cart is theirs now.
 */
function ucpDeps({ locale, appUrl, signal }: { locale: "en" | "el"; appUrl: string; signal?: AbortSignal }): UcpDeps {
  return {
    runOn(cartId) {
      let ctx: Promise<ToolContext> | undefined;
      return async (tool, input): Promise<ToolRun> => {
        const [owner] = await sql<{ user_id: string | null }[]>`SELECT user_id FROM carts WHERE id = ${cartId}`;
        if (owner !== undefined && owner.user_id !== null) return { ok: false, reason: "invalid_input", issues: ["the buyer has taken this cart"] };
        ctx ??= toolServices({ locale, user: null, cart: { cartId, userId: null } }).then((services) => ({ locale, surface: "mcp" as const, user: null, actor: { key: "agent:ucp", kind: "guest" as const }, services, signal }));
        return runTool(findTool(tool, "mcp")!, await ctx, input);
      };
    },
    newCartId: () => uuidv7(),
    sign: (cartId) => signValue(`${UCP_SIGNING_PREFIX}${cartId}`, cookieSecret()),
    verify: (signed) => {
      const value = verifySignedValue(signed, cookieSecret());
      return value !== null && value.startsWith(UCP_SIGNING_PREFIX) ? value.slice(UCP_SIGNING_PREFIX.length) : null;
    },
    appUrl,
    locale,
  };
}
