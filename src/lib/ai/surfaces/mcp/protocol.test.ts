/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Tests for the MCP protocol layer: modern per-request metadata, older initialize clients, headers, origins, errors.
 */

import { describe, expect, it } from "vitest";

import { decodeHeaderValue, handleMcpPost, MCP_ERRORS, type McpServer } from "@/lib/ai/surfaces/mcp/protocol";

const SHOP = "https://vitrine.example";

function server(overrides: Partial<McpServer> = {}): McpServer {
  return {
    info: { name: "vitrine", version: "1.0.0" },
    instructions: "A test shop.",
    personal: false,
    tools: () => [{ name: "search_products", description: "Search.", inputSchema: { type: "object" } }],
    call: async (name, args) => (name === "search_products" ? { content: [{ type: "text", text: JSON.stringify({ ids: [], query: args.query }) }], structuredContent: { ids: [], query: args.query }, isError: false } : null),
    ...overrides,
  };
}

const modernMeta = { "io.modelcontextprotocol/protocolVersion": "2026-07-28", "io.modelcontextprotocol/clientInfo": { name: "test", version: "1" }, "io.modelcontextprotocol/clientCapabilities": {} };

/** A modern request with its headers mirrored as the spec requires. */
function modern(method: string, params: Record<string, unknown> = {}, headers: Record<string, string> = {}) {
  const name: Record<string, string> = typeof params.name === "string" ? { "mcp-name": params.name } : {};
  return {
    headers: new Headers({ "content-type": "application/json", "mcp-protocol-version": "2026-07-28", "mcp-method": method, ...name, ...headers }),
    body: JSON.stringify({ jsonrpc: "2.0", id: 7, method, params: { ...params, _meta: modernMeta } }),
  };
}

const post = (request: { headers: Headers; body: string }, s = server()) => handleMcpPost(request.headers, request.body, s, { allowedOrigins: [SHOP] });

describe("modern requests (2026-07-28)", () => {
  it("discovers the server: versions, tools capability, identity, and how long to keep it", async () => {
    const reply = await post(modern("server/discover"));
    expect(reply.status).toBe(200);
    expect(reply.body).toMatchObject({
      jsonrpc: "2.0",
      id: 7,
      result: {
        resultType: "complete",
        supportedVersions: expect.arrayContaining(["2026-07-28", "2025-11-25", "2025-06-18", "2025-03-26"]),
        capabilities: { tools: { listChanged: false } },
        _meta: { "io.modelcontextprotocol/serverInfo": { name: "vitrine", version: "1.0.0" } },
        cacheScope: "public",
      },
    });
  });

  it("lists tools, private when the list depends on the key", async () => {
    const open = await post(modern("tools/list"));
    expect(open.body).toMatchObject({ result: { resultType: "complete", tools: [{ name: "search_products" }], cacheScope: "public", ttlMs: 300000 } });
    const personal = await post(modern("tools/list"), server({ personal: true }));
    expect(personal.body).toMatchObject({ result: { cacheScope: "private" } });
  });

  it("calls a tool and returns its structured result", async () => {
    const reply = await post(modern("tools/call", { name: "search_products", arguments: { query: "oak table" } }));
    expect(reply.status).toBe(200);
    expect(reply.body).toMatchObject({ result: { resultType: "complete", isError: false, structuredContent: { query: "oak table" } } });
  });

  it("refuses headers that do not match the body with 400 and HeaderMismatch", async () => {
    const noVersion = modern("tools/list");
    noVersion.headers.delete("mcp-protocol-version");
    const wrongMethod = modern("tools/list", {}, { "mcp-method": "tools/call" });
    const wrongName = modern("tools/call", { name: "search_products", arguments: {} }, { "mcp-name": "add_to_cart" });
    const missingName = modern("tools/call", { name: "search_products", arguments: {} });
    missingName.headers.delete("mcp-name");
    for (const request of [noVersion, wrongMethod, wrongName, missingName]) {
      const reply = await post(request);
      expect(reply.status).toBe(400);
      expect(reply.body).toMatchObject({ id: 7, error: { code: MCP_ERRORS.headerMismatch } });
    }
  });

  it("accepts a tool name sent in the Base64 form", async () => {
    const reply = await post(modern("tools/call", { name: "search_products", arguments: {} }, { "mcp-name": `=?base64?${Buffer.from("search_products").toString("base64")}?=` }));
    expect(reply.status).toBe(200);
    expect(decodeHeaderValue("=?base64?SGVsbG8sIOS4lueVjA==?=")).toBe("Hello, 世界");
    expect(decodeHeaderValue("plain")).toBe("plain");
  });

  it("names the versions it serves when asked for one it does not", async () => {
    const request = modern("tools/list", {}, { "mcp-protocol-version": "1900-01-01" });
    request.body = request.body.replace("2026-07-28", "1900-01-01");
    const reply = await post(request);
    expect(reply.status).toBe(400);
    expect(reply.body).toMatchObject({ error: { code: MCP_ERRORS.unsupportedVersion, data: { requested: "1900-01-01", supported: expect.arrayContaining(["2026-07-28"]) } } });
  });

  it("answers an unknown method with 404 and a JSON-RPC body, and an unknown tool as invalid params", async () => {
    const unknownMethod = await post(modern("resources/list"));
    expect(unknownMethod.status).toBe(404);
    expect(unknownMethod.body).toMatchObject({ error: { code: MCP_ERRORS.methodNotFound } });
    const unknownTool = await post(modern("tools/call", { name: "drop_tables", arguments: {} }));
    expect(unknownTool.body).toMatchObject({ error: { code: MCP_ERRORS.invalidParams, message: "Unknown tool: drop_tables" } });
  });
});

describe("older clients (initialize, 2025-03-26 to 2025-11-25)", () => {
  const legacy = (body: unknown, headers: Record<string, string> = {}) => ({ headers: new Headers({ "content-type": "application/json", ...headers }), body: JSON.stringify(body) });

  it("answers initialize with the version asked for, or the newest legacy one", async () => {
    const asked = await post(legacy({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "old", version: "1" } } }));
    expect(asked.body).toMatchObject({ result: { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "vitrine" } } });
    const unknown = await post(legacy({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05" } }));
    expect(unknown.body).toMatchObject({ result: { protocolVersion: "2025-11-25" } });
    expect(JSON.stringify(unknown.body)).toContain("2026-07-28");
  });

  it("accepts notifications with 202 and no body", async () => {
    const reply = await post(legacy({ jsonrpc: "2.0", method: "notifications/initialized" }));
    expect(reply).toEqual({ status: 202, body: null });
  });

  it("serves tools/list and tools/call without per-request metadata, with or without the version header", async () => {
    const list = await post(legacy({ jsonrpc: "2.0", id: 2, method: "tools/list" }, { "mcp-protocol-version": "2025-11-25" }));
    expect(list.body).toEqual({ jsonrpc: "2.0", id: 2, result: { tools: [expect.objectContaining({ name: "search_products" })] } });
    const call = await post(legacy({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "search_products", arguments: { query: "lamp" } } }));
    expect(call.body).toMatchObject({ result: { isError: false, structuredContent: { query: "lamp" } } });
    expect(call.body).not.toHaveProperty("result.resultType");
  });

  it("refuses a modern version header without the modern metadata, and a version it does not know", async () => {
    const half = await post(legacy({ jsonrpc: "2.0", id: 4, method: "tools/list" }, { "mcp-protocol-version": "2026-07-28" }));
    expect(half.status).toBe(400);
    expect(half.body).toMatchObject({ error: { code: MCP_ERRORS.headerMismatch } });
    const old = await post(legacy({ jsonrpc: "2.0", id: 5, method: "tools/list" }, { "mcp-protocol-version": "2024-11-05" }));
    expect(old.status).toBe(400);
    expect(old.body).toMatchObject({ error: { code: MCP_ERRORS.unsupportedVersion } });
  });
});

describe("the envelope", () => {
  const raw = (body: string, headers: Record<string, string> = {}) => ({ headers: new Headers(headers), body });

  it("refuses a browser from another origin with 403, and lets the shop's own and server agents through", async () => {
    const list = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    expect((await post(raw(list, { origin: "https://evil.example" }))).status).toBe(403);
    expect((await post(raw(list, { origin: SHOP }))).status).toBe(200);
    expect((await post(raw(list))).status).toBe(200);
  });

  it("refuses what is not one JSON-RPC request", async () => {
    expect(await post(raw("{not json"))).toMatchObject({ status: 400, body: { id: null, error: { code: MCP_ERRORS.parse } } });
    expect(await post(raw("[]"))).toMatchObject({ status: 400, body: { error: { code: MCP_ERRORS.invalidRequest } } });
    expect(await post(raw(JSON.stringify({ jsonrpc: "1.0", id: 1, method: "ping" })))).toMatchObject({ status: 400 });
    expect(await post(raw(JSON.stringify({ jsonrpc: "2.0", id: null, method: "ping" })))).toMatchObject({ status: 400 });
    expect(await post(raw(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: { cursor: "x" } })))).toMatchObject({ body: { error: { code: MCP_ERRORS.invalidParams } } });
  });

  it("hides what went wrong inside a tool behind a plain internal error", async () => {
    const failing = server({ call: async () => { throw new Error("database password is hunter2"); } });
    const reply = await post(modern("tools/call", { name: "search_products", arguments: {} }), failing);
    expect(reply.status).toBe(500);
    expect(JSON.stringify(reply.body)).not.toContain("hunter2");
  });
});
