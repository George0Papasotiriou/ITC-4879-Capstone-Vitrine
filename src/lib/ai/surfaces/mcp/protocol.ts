/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * The Model Context Protocol over Streamable HTTP: one POST, one JSON-RPC message, one answer — for new and older clients.
 */

/**
 * docs/adr/043. Written from the specification (revision 2026-07-28,
 * modelcontextprotocol.io/specification/2026-07-28), not from the SDK, whose
 * server pulls in a web framework the shop does not need. The protocol part is
 * small and is all here, with no Next.js and no database, so it is tested
 * directly:
 *
 * - Every message is its own POST to /api/mcp and gets one JSON answer; a
 *   notification gets 202 and no body. There are no sessions: GET and DELETE
 *   are refused by the route (405), `Mcp-Session-Id` and `Last-Event-ID` are
 *   ignored.
 * - A MODERN request (2026-07-28) carries its protocol version in
 *   `params._meta["io.modelcontextprotocol/protocolVersion"]` and mirrors it,
 *   the method and the tool's name in headers; a mismatch is refused with 400
 *   and HeaderMismatch (-32020), an unknown version with 400 and
 *   UnsupportedProtocolVersion (-32022) naming the versions served.
 * - A LEGACY client (2025-03-26 to 2025-11-25) opens with `initialize`; the
 *   answer names the newest legacy version it asked for or below, and its
 *   later requests are served the same way, statelessly (the spec's "dual-era"
 *   server).
 * - An `Origin` header from anywhere but the shop itself is refused with 403,
 *   against DNS rebinding.
 */

export const MODERN_VERSIONS = ["2026-07-28"] as const;
export const LEGACY_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26"] as const;
export const SUPPORTED_VERSIONS: readonly string[] = [...MODERN_VERSIONS, ...LEGACY_VERSIONS];

export const MCP_ERRORS = {
  parse: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internal: -32603,
  headerMismatch: -32020,
  unsupportedVersion: -32022,
} as const;

const META_VERSION = "io.modelcontextprotocol/protocolVersion";

type Id = string | number;
type Era = "modern" | "legacy";

export type McpToolDefinition = {
  name: string;
  title?: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: { title?: string; readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint?: boolean };
};

export type McpCallResult = {
  content: { type: "text"; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError: boolean;
};

/** What the protocol serves: built per request by the route, for whoever is asking. */
export type McpServer = {
  info: { name: string; version: string; title?: string };
  instructions: string;
  /** The tools this caller may use, always in the same order. */
  tools(): McpToolDefinition[];
  /** True when the list depends on the key presented, so it must not be shared between callers. */
  personal: boolean;
  /** Runs a tool; null when there is no such tool. */
  call(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<McpCallResult | null>;
};

export type HttpReply = { status: number; body: unknown };

export type McpRequestOptions = {
  /** Origins allowed to call from a browser; a request with no Origin (an agent on a server) is always let through. */
  allowedOrigins: readonly string[];
  signal?: AbortSignal;
};

const errorBody = (id: Id | null, code: number, message: string, data?: unknown) => ({ jsonrpc: "2.0", id, error: data === undefined ? { code, message } : { code, message, data } });
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** A mirrored header value, with the Base64 form `=?base64?…?=` decoded (spec: Value Encoding). */
export function decodeHeaderValue(value: string): string {
  const match = /^=\?base64\?([A-Za-z0-9+/=]*)\?=$/.exec(value);
  return match === null ? value : Buffer.from(match[1]!, "base64").toString("utf8");
}

/** The field a method's `Mcp-Name` header mirrors. */
const NAMED_METHODS: Record<string, "name" | "uri"> = { "tools/call": "name", "prompts/get": "name", "resources/read": "uri" };

export async function handleMcpPost(headers: Headers, rawBody: string, server: McpServer, options: McpRequestOptions): Promise<HttpReply> {
  const origin = headers.get("origin");
  if (origin !== null && !options.allowedOrigins.includes(origin)) return { status: 403, body: errorBody(null, MCP_ERRORS.invalidRequest, "Origin not allowed") };

  let message: unknown;
  try {
    message = JSON.parse(rawBody);
  } catch {
    return { status: 400, body: errorBody(null, MCP_ERRORS.parse, "Parse error: the body is not JSON") };
  }
  if (Array.isArray(message)) return { status: 400, body: errorBody(null, MCP_ERRORS.invalidRequest, "Send one JSON-RPC message per request; batches are not supported") };
  if (!isRecord(message) || message.jsonrpc !== "2.0" || typeof message.method !== "string") {
    return { status: 400, body: errorBody(null, MCP_ERRORS.invalidRequest, "Invalid request: expected a JSON-RPC 2.0 request or notification") };
  }
  const method = message.method;
  const params = message.params === undefined ? {} : message.params;
  if (!isRecord(params)) return { status: 400, body: errorBody(null, MCP_ERRORS.invalidRequest, "params must be an object") };

  // A notification (no id) is accepted and needs no answer: notifications/initialized from older clients, for one.
  if (!("id" in message)) return { status: 202, body: null };
  const id = message.id;
  if (typeof id !== "string" && typeof id !== "number") return { status: 400, body: errorBody(null, MCP_ERRORS.invalidRequest, "id must be a string or a number") };

  const headerVersion = headers.get("mcp-protocol-version");
  const meta = isRecord(params._meta) ? params._meta : null;
  const bodyVersion = meta !== null && typeof meta[META_VERSION] === "string" ? (meta[META_VERSION] as string) : null;

  if (method === "initialize") return { status: 200, body: { jsonrpc: "2.0", id, result: initializeResult(params, server) } };

  let era: Era;
  if (bodyVersion !== null) {
    if (headerVersion !== bodyVersion) return mismatch(id, `MCP-Protocol-Version header ${headerVersion === null ? "is missing" : `'${headerVersion}'`}; the body's _meta says '${bodyVersion}'`);
    if (!(MODERN_VERSIONS as readonly string[]).includes(bodyVersion)) return unsupported(id, bodyVersion);
    const methodHeader = headers.get("mcp-method");
    if (methodHeader !== method) return mismatch(id, `Mcp-Method header ${methodHeader === null ? "is missing" : `'${methodHeader}'`}; the body's method is '${method}'`);
    const namedField = NAMED_METHODS[method];
    if (namedField !== undefined) {
      const nameHeader = headers.get("mcp-name");
      const bodyName = params[namedField];
      if (nameHeader === null || typeof bodyName !== "string" || decodeHeaderValue(nameHeader) !== bodyName) {
        return mismatch(id, `Mcp-Name header ${nameHeader === null ? "is missing" : "does not match"} the body's ${namedField}`);
      }
    }
    era = "modern";
  } else {
    if (headerVersion !== null && (MODERN_VERSIONS as readonly string[]).includes(headerVersion)) {
      return mismatch(id, `MCP-Protocol-Version header says '${headerVersion}' but the body carries no _meta.${META_VERSION}`);
    }
    // No header at all is a 2025-03-26 client, which had none (spec: Protocol Version Header).
    if (headerVersion !== null && !(LEGACY_VERSIONS as readonly string[]).includes(headerVersion)) return unsupported(id, headerVersion);
    era = "legacy";
  }

  try {
    return await dispatch(id, method, params, era, server, options.signal);
  } catch {
    // What went wrong stays in the server's log; the client learns only that it did.
    return { status: 500, body: errorBody(id, MCP_ERRORS.internal, "Internal error") };
  }
}

function mismatch(id: Id, detail: string): HttpReply {
  return { status: 400, body: errorBody(id, MCP_ERRORS.headerMismatch, `Header mismatch: ${detail}`) };
}

function unsupported(id: Id, requested: string): HttpReply {
  return { status: 400, body: errorBody(id, MCP_ERRORS.unsupportedVersion, "Unsupported protocol version", { supported: SUPPORTED_VERSIONS, requested }) };
}

function initializeResult(params: Record<string, unknown>, server: McpServer) {
  const asked = typeof params.protocolVersion === "string" ? params.protocolVersion : null;
  // The version the client asked for when it is one of ours, else the newest legacy one (older revisions: Version Negotiation).
  const protocolVersion = asked !== null && (LEGACY_VERSIONS as readonly string[]).includes(asked) ? asked : LEGACY_VERSIONS[0];
  return {
    protocolVersion,
    capabilities: { tools: { listChanged: false } },
    serverInfo: server.info,
    // Legacy clients cannot move forward on their own; say plainly what else is served (spec: Backward Compatibility).
    instructions: `${server.instructions} This server also speaks MCP ${MODERN_VERSIONS.join(", ")} with per-request metadata.`,
  };
}

async function dispatch(id: Id, method: string, params: Record<string, unknown>, era: Era, server: McpServer, signal?: AbortSignal): Promise<HttpReply> {
  const ok = (result: Record<string, unknown>) => ({ status: 200, body: { jsonrpc: "2.0", id, result: era === "modern" ? { resultType: "complete", ...result } : result } });
  // A request the protocol understood but whose parameters are wrong: a JSON-RPC error in an ordinary 200, as JSON-RPC over HTTP does.
  const invalid = (text: string) => ({ status: 200, body: errorBody(id, MCP_ERRORS.invalidParams, text) });

  switch (method) {
    case "server/discover":
      if (era !== "modern") break;
      return ok({
        supportedVersions: SUPPORTED_VERSIONS,
        capabilities: { tools: { listChanged: false } },
        _meta: { "io.modelcontextprotocol/serverInfo": server.info },
        instructions: server.instructions,
        ttlMs: 60 * 60 * 1000,
        cacheScope: "public",
      });
    case "ping":
      return ok({});
    case "tools/list": {
      // Every tool fits one page, so no cursor is ever issued; one the server did not give is refused.
      if (params.cursor !== undefined) return invalid("Unknown cursor: this list has one page");
      const tools = server.tools();
      return ok(era === "modern" ? { tools, ttlMs: 5 * 60 * 1000, cacheScope: server.personal ? "private" : "public" } : { tools });
    }
    case "tools/call": {
      if (typeof params.name !== "string") return invalid("tools/call needs params.name");
      if (params.arguments !== undefined && !isRecord(params.arguments)) return invalid("params.arguments must be an object");
      const result = await server.call(params.name, (params.arguments as Record<string, unknown> | undefined) ?? {}, signal);
      if (result === null) return invalid(`Unknown tool: ${params.name}`);
      return ok(result);
    }
  }
  // Unknown methods: 404 with a JSON-RPC body in the modern era, so a client can tell this server from a missing endpoint.
  return { status: era === "modern" ? 404 : 200, body: errorBody(id, MCP_ERRORS.methodNotFound, `Method not found: ${method}`) };
}
