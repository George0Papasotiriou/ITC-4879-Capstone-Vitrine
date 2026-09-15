/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Unit tests for IP parsing and the IP-to-country range index.
 */

import { describe, expect, it } from "vitest";

import { clientAddress, IpCountryIndex, isPrivateAddress, parseIp, parseIpv4, parseIpv6 } from "@/lib/geo/ip-country";

const CSV = [
  "1.0.0.0,1.0.0.255,AU",
  // Out of order on purpose: the index sorts.
  "5.54.0.0,5.55.255.255,GR",
  "2.16.0.0,2.16.255.255,DE",
  '"31.14.0.0","31.14.255.255","CY"',
  "not,a,range",
  "2a02:580::,2a02:587:ffff:ffff:ffff:ffff:ffff:ffff,GR",
  "2001:db8::,2001:db8::ffff,ZZ",
  "2600::,2600:ffff:ffff:ffff:ffff:ffff:ffff:ffff,US",
].join("\n");

describe("parsing addresses", () => {
  it("reads IPv4 as a 32-bit number and rejects malformed ones", () => {
    expect(parseIpv4("0.0.0.0")).toBe(0);
    expect(parseIpv4("255.255.255.255")).toBe(4_294_967_295);
    expect(parseIpv4("5.54.1.2")).toBe(5 * 2 ** 24 + 54 * 2 ** 16 + 258);
    for (const bad of ["256.0.0.1", "1.2.3", "1.2.3.4.5", "a.b.c.d", ""]) expect(parseIpv4(bad)).toBeNull();
  });

  it("reads IPv6 with compression, zones and an IPv4 tail", () => {
    expect(parseIpv6("::1")).toEqual({ high: 0n, low: 1n });
    expect(parseIpv6("2a02:580::1")).toEqual({ high: 0x2a02058000000000n, low: 1n });
    expect(parseIpv6("fe80::1%eth0")).toEqual({ high: 0xfe80000000000000n, low: 1n });
    expect(parseIpv6("::ffff:5.54.1.2")).toEqual({ high: 0n, low: 0xffff05360102n });
    for (const bad of ["1::2::3", "12345::", "1:2:3:4:5:6:7", "g::1"]) expect(parseIpv6(bad)).toBeNull();
  });

  it("treats an IPv4-mapped IPv6 address as IPv4", () => {
    expect(parseIp("::ffff:5.54.1.2")).toEqual({ version: 4, value: parseIpv4("5.54.1.2") });
    expect(parseIp("[2a02:580::1]")).toMatchObject({ version: 6 });
  });

  it("recognises addresses that have no country", () => {
    for (const address of ["127.0.0.1", "10.1.2.3", "172.20.0.5", "192.168.1.10", "169.254.1.1", "::1", "fd12::1", "fe80::1"]) {
      expect(isPrivateAddress(parseIp(address)!), address).toBe(true);
    }
    expect(isPrivateAddress(parseIp("5.54.1.2")!)).toBe(false);
    expect(isPrivateAddress(parseIp("172.32.0.1")!)).toBe(false);
  });
});

describe("country lookup", () => {
  const index = IpCountryIndex.fromCsv(CSV);

  it("loads valid ranges and skips the rest", () => {
    expect(index.size).toBe(7);
  });

  it("finds the country for addresses inside ranges, including the edges", () => {
    expect(index.lookup("5.54.0.0")).toBe("GR");
    expect(index.lookup("5.55.255.255")).toBe("GR");
    expect(index.lookup("2.16.3.4")).toBe("DE");
    expect(index.lookup("31.14.200.1")).toBe("CY");
    expect(index.lookup("::ffff:2.16.3.4")).toBe("DE");
    expect(index.lookup("2a02:585:1234::1")).toBe("GR");
    expect(index.lookup("2600:1f18::1")).toBe("US");
  });

  it("returns nothing between ranges, outside all ranges, and for private addresses", () => {
    expect(index.lookup("1.0.1.0")).toBeNull();
    expect(index.lookup("5.56.0.0")).toBeNull();
    expect(index.lookup("0.0.0.1")).toBeNull();
    expect(index.lookup("2a02:588::1")).toBeNull();
    expect(index.lookup("192.168.1.1")).toBeNull();
    expect(index.lookup("not an address")).toBeNull();
  });

  it("agrees with a linear scan on random public addresses", () => {
    // Ranges from 5.0.0.0 upwards (public space), with gaps between them.
    const BASE = 5 * 2 ** 24;
    const ranges: [number, number, string][] = [];
    let cursor = BASE;
    let seed = 3;
    const next = () => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed;
    };
    const codes = ["GR", "DE", "FR", "IT", "US"];
    for (let i = 0; i < 2_000; i += 1) {
      const start = cursor + (next() % 50);
      const end = start + (next() % 5_000);
      ranges.push([start, end, codes[next() % codes.length]!]);
      cursor = end + 1;
    }
    const toIp = (value: number) => [Math.floor(value / 2 ** 24), (value >>> 16) & 255, (value >>> 8) & 255, value & 255].join(".");
    const big = IpCountryIndex.fromCsv(ranges.map(([s, e, c]) => `${toIp(s)},${toIp(e)},${c}`).join("\n"));
    let matched = 0;
    for (let i = 0; i < 3_000; i += 1) {
      const address = BASE + (next() % (cursor - BASE + 100));
      const expected = ranges.find(([s, e]) => address >= s && address <= e)?.[2] ?? null;
      if (expected !== null) matched += 1;
      expect(big.lookup(toIp(address))).toBe(expected);
    }
    // Most random addresses fall inside a range, so the comparison is not vacuous.
    expect(matched).toBeGreaterThan(2_500);
  });
});

describe("client address from proxy headers", () => {
  const headers = (entries: Record<string, string>) => ({ get: (name: string) => entries[name] ?? null });

  it("takes the first X-Forwarded-For entry, then X-Real-IP", () => {
    expect(clientAddress(headers({ "x-forwarded-for": "5.54.1.2, 10.0.0.1" }))).toBe("5.54.1.2");
    expect(clientAddress(headers({ "x-real-ip": "2.16.3.4" }))).toBe("2.16.3.4");
    expect(clientAddress(headers({}))).toBeNull();
  });
});
