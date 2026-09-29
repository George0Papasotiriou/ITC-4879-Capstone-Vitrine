/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * The shop's MCP endpoint: outside AI agents search the catalogue, and with the shopper's key, use their cart and orders.
 */

import { serverEnv } from "@/env";
import { bearerKey } from "@/lib/agents/tokens";
import { MCP_ERRORS, handleMcpPost } from "@/lib/ai/surfaces/mcp/protocol";
import { agentKeys, mcpServerFor } from "@/lib/ai/surfaces/mcp/server";
import { usageStore } from "@/lib/ai/server";
import { clientAddress } from "@/lib/geo/ip-country";
import { sharedRateLimiter } from "@/lib/kv/rate-limit";
import { loggerForRequest } from "@/lib/log";

/**
 * docs/adr/043. Streamable HTTP, revision 2026-07-28, and the earlier
 * `initialize` revisions (src/lib/ai/surfaces/mcp/protocol.ts): one POST, one
 * JSON answer. The admin's kill switch stops it with the rest of the AI.
 * Limited per key, or per address without one, through Redis in production.
 */

export const runtime = "nodejs";

const perCaller = sharedRateLimiter({ name: "mcp", limit: 120, windowMs: 60_000 });
/** One JSON-RPC message is small; anything larger is not one. */
const MAX_BODY_BYTES = 64 * 1024;

const jsonRpcError = (status: number, code: number, message: string, headers: Record<string, string> = {}) =>
  Response.json({ jsonrpc: "2.0", id: null, error: { code, message } }, { status, headers: { "cache-control": "no-store", ...headers } });

export async function POST(request: Request): Promise<Response> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) return jsonRpcError(413, MCP_ERRORS.invalidRequest, "The message is too large");

  // Who the agent speaks for: the owner of a valid key, or nobody. A key that does not work is refused, not ignored.
  const authorization = request.headers.get("authorization");
  let identity = null;
  if (authorization !== null) {
    const key = bearerKey(authorization);
    identity = key === null ? null : await (await agentKeys()).authenticate(key);
    if (identity === null) {
      return jsonRpcError(401, MCP_ERRORS.invalidRequest, "This agent key is not valid: it may be mistyped, revoked or past its date. The shopper can make a new one at /account/agents.", {
        "www-authenticate": 'Bearer error="invalid_token", error_description="Unknown, expired or revoked agent key"',
      });
    }
  }

  const caller = identity !== null ? `key:${identity.keyId}` : `address:${clientAddress(request.headers) ?? "unknown"}`;
  if (!(await perCaller(caller))) return jsonRpcError(429, MCP_ERRORS.invalidRequest, "Too many requests; wait a minute", { "retry-after": "60" });

  // The agent brings its own model, so no budget is spent here; only the kill switch stops it.
  const gate = await (await usageStore()).open();
  if (!gate.ok && gate.reason === "kill_switch") return jsonRpcError(503, MCP_ERRORS.internal, "The shop's AI features are switched off for now");

  const body = await request.text();
  if (Buffer.byteLength(body, "utf8") > MAX_BODY_BYTES) return jsonRpcError(413, MCP_ERRORS.invalidRequest, "The message is too large");

  const locale = (request.headers.get("accept-language") ?? "").trim().toLowerCase().startsWith("el") ? "el" : "en";
  const server = await mcpServerFor({ identity, locale, signal: request.signal });
  const reply = await handleMcpPost(request.headers, body, server, { allowedOrigins: [new URL(serverEnv().APP_URL).origin], signal: request.signal });
  loggerForRequest(request.headers).info({ mcp: { status: reply.status, keyed: identity !== null } }, "mcp request");
  if (reply.body === null) return new Response(null, { status: reply.status });
  return Response.json(reply.body, { status: reply.status, headers: { "cache-control": "no-store" } });
}

/** No sessions and no server-sent stream in this revision: only POST (spec: Earlier Streamable HTTP Revisions). */
function onlyPost(): Response {
  return new Response(null, { status: 405, headers: { allow: "POST" } });
}

export const GET = onlyPost;
export const DELETE = onlyPost;
