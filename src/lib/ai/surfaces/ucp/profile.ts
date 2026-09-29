/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * The shop's UCP business profile, served at /.well-known/ucp: where its MCP endpoint is and what it supports.
 */

import { UCP_CHECKOUT, UCP_VERSION } from "@/lib/ai/surfaces/ucp/checkout";

/**
 * docs/adr/043. Only what the shop really does is declared: the shopping
 * service over MCP, and the checkout capability, which always hands the buyer
 * to the shop's own page. No payment handlers, because no agent ever pays
 * here, and no signing keys, because this shop does not sign its messages
 * (UCP recommends both; the ADR says why they are left out).
 */
export function ucpProfile(appUrl: string) {
  const spec = (path: string) => `https://ucp.dev/${UCP_VERSION}/${path}`;
  return {
    ucp: {
      version: UCP_VERSION,
      services: {
        "dev.ucp.shopping": [
          {
            version: UCP_VERSION,
            spec: spec("specification/overview"),
            transport: "mcp",
            schema: spec("services/shopping/mcp.openrpc.json"),
            endpoint: new URL("/api/mcp", appUrl).toString(),
          },
        ],
      },
      capabilities: {
        [UCP_CHECKOUT]: [{ version: UCP_VERSION, spec: spec("specification/shopping/checkout"), schema: spec("schemas/shopping/checkout.json") }],
      },
      payment_handlers: {},
    },
  };
}
