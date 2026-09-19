/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Unit tests for signed cookie values, access tokens and order numbers.
 */

import { describe, expect, it } from "vitest";

import { hashToken, newAccessToken, newOrderNumber, orderLinkToken, signValue, tokenMatches, verifySignedValue } from "@/lib/commerce/tokens";

const SECRET = "s".repeat(32);

describe("signed cookie values", () => {
  it("round-trips a value signed with the same secret", () => {
    const signed = signValue("0191e2c4-5b6a-7c8d-9e0f-a1b2c3d4e5f6", SECRET);
    expect(verifySignedValue(signed, SECRET)).toBe("0191e2c4-5b6a-7c8d-9e0f-a1b2c3d4e5f6");
  });

  it("rejects a tampered value, a tampered signature, another secret, and junk", () => {
    const signed = signValue("cart-a", SECRET);
    const [, signature] = signed.split(".");
    expect(verifySignedValue(`cart-b.${signature}`, SECRET)).toBeNull();
    expect(verifySignedValue(`${signed}x`, SECRET)).toBeNull();
    expect(verifySignedValue(signed, "t".repeat(32))).toBeNull();
    expect(verifySignedValue("no-signature", SECRET)).toBeNull();
    expect(verifySignedValue(".abc", SECRET)).toBeNull();
    expect(verifySignedValue(undefined, SECRET)).toBeNull();
  });

  it("refuses to sign a value that would be ambiguous to split", () => {
    expect(() => signValue("a.b", SECRET)).toThrow(RangeError);
  });
});

describe("order access tokens", () => {
  it("are long, random and URL-safe, and only their hash is compared", () => {
    const token = newAccessToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(newAccessToken()).not.toBe(token);
    const stored = hashToken(token);
    expect(stored).toMatch(/^[0-9a-f]{64}$/);
    expect(tokenMatches(token, stored)).toBe(true);
    expect(tokenMatches(newAccessToken(), stored)).toBe(false);
  });
});

describe("order numbers", () => {
  it("are formatted VT-XXXX-XXXX in Crockford base 32", () => {
    for (let i = 0; i < 200; i += 1) expect(newOrderNumber()).toMatch(/^VT-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
  });

  it("encode all 40 random bits deterministically", () => {
    expect(newOrderNumber(() => new Uint8Array([0, 0, 0, 0, 0]))).toBe("VT-0000-0000");
    expect(newOrderNumber(() => new Uint8Array([255, 255, 255, 255, 255]))).toBe("VT-ZZZZ-ZZZZ");
    expect(newOrderNumber(() => new Uint8Array([0, 0, 0, 0, 33]))).toBe("VT-0000-0011");
  });
});

describe("orderLinkToken", () => {
  const secret = "s".repeat(40);
  const id = "01890000-0000-7000-8000-000000000001";

  it("gives the same link for the same order, so an email can rebuild it later", () => {
    expect(orderLinkToken(id, secret)).toBe(orderLinkToken(id, secret));
    expect(tokenMatches(orderLinkToken(id, secret), hashToken(orderLinkToken(id, secret)))).toBe(true);
  });

  it("differs for another order or another secret, and is 256 bits in URL-safe form", () => {
    const token = orderLinkToken(id, secret);
    expect(token).not.toBe(orderLinkToken("01890000-0000-7000-8000-000000000002", secret));
    expect(token).not.toBe(orderLinkToken(id, "t".repeat(40)));
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});
