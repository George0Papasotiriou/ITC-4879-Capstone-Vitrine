/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * IP-to-country lookup with binary search over sorted address ranges.
 */

/**
 * Country from an IP address, looked up in a local copy of an IP-to-country
 * database (docs/adr/013).
 *
 * Local on purpose: an IP address is personal data (GDPR), and sending every
 * visitor's address to a free geolocation web service would share it with a
 * third party on every page view. Here the address is looked up in memory, used
 * to pick the prices shown, and never stored or logged.
 *
 * The database is a list of non-overlapping address ranges, each with a
 * country: "1.0.0.0,1.0.0.255,AU" (DB-IP's free "IP to Country Lite" CSV, CC BY
 * 4.0). Ranges are kept sorted in typed arrays and found by binary search:
 * O(log n) per lookup, about 20 comparisons for a million ranges.
 *
 * IPv4 addresses are 32-bit integers; IPv6 addresses are 128 bits, stored as
 * two 64-bit halves and compared high half first.
 */

export type ParsedIp = { version: 4; value: number } | { version: 6; high: bigint; low: bigint };

export function parseIpv4(text: string): number | null {
  const parts = text.split(".");
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const byte = Number(part);
    if (byte > 255) return null;
    value = value * 256 + byte;
  }
  return value;
}

export function parseIpv6(text: string): { high: bigint; low: bigint } | null {
  let address = text.toLowerCase();
  const zone = address.indexOf("%");
  if (zone >= 0) address = address.slice(0, zone);
  // An embedded IPv4 tail (::ffff:1.2.3.4) becomes two hextets.
  const lastColon = address.lastIndexOf(":");
  if (address.includes(".", lastColon)) {
    const v4 = parseIpv4(address.slice(lastColon + 1));
    if (v4 === null) return null;
    address = `${address.slice(0, lastColon + 1)}${(v4 >>> 16).toString(16)}:${(v4 & 0xffff).toString(16)}`;
  }
  const halves = address.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] === "" ? [] : halves[0]!.split(":");
  const tail = halves.length === 2 ? (halves[1] === "" ? [] : halves[1]!.split(":")) : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? head.length !== 8 : missing < 1) return null;
  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill("0"), ...tail];
  let high = 0n;
  let low = 0n;
  for (const [index, group] of groups.entries()) {
    if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
    const value = BigInt(Number.parseInt(group, 16));
    if (index < 4) high = (high << 16n) | value;
    else low = (low << 16n) | value;
  }
  return { high, low };
}

export function parseIp(text: string): ParsedIp | null {
  const trimmed = text.trim().replace(/^\[|\]$/g, "");
  const v4 = parseIpv4(trimmed);
  if (v4 !== null) return { version: 4, value: v4 };
  const v6 = parseIpv6(trimmed);
  if (v6 === null) return null;
  // IPv4-mapped IPv6 (::ffff:a.b.c.d) is an IPv4 address.
  if (v6.high === 0n && v6.low >> 32n === 0xffffn) return { version: 4, value: Number(v6.low & 0xffffffffn) };
  return { version: 6, ...v6 };
}

/** Loopback, private and link-local addresses say nothing about a country. */
export function isPrivateAddress(ip: ParsedIp): boolean {
  if (ip.version === 4) {
    const a = ip.value >>> 24;
    const b = (ip.value >>> 16) & 0xff;
    return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || a === 0;
  }
  const first = Number(ip.high >> 48n);
  const loopback = ip.high === 0n && ip.low === 1n;
  return loopback || (first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80 || (ip.high === 0n && ip.low === 0n);
}

export class IpCountryIndex {
  private constructor(
    private readonly v4Start: Uint32Array,
    private readonly v4End: Uint32Array,
    private readonly v4Country: Uint16Array,
    private readonly v6Start: BigUint64Array,
    private readonly v6End: BigUint64Array,
    private readonly v6Country: Uint16Array,
    private readonly countries: string[],
  ) {}

  get size(): number {
    return this.v4Start.length + this.v6Start.length / 2;
  }

  /**
   * Builds the index from CSV text: one range per line, "start,end,CC". Lines
   * that do not parse are skipped. Ranges are sorted here, so the file's order
   * does not matter.
   */
  static fromCsv(text: string): IpCountryIndex {
    const countries: string[] = [];
    const countryIndex = new Map<string, number>();
    const indexOf = (code: string) => {
      let index = countryIndex.get(code);
      if (index === undefined) {
        index = countries.length;
        countries.push(code);
        countryIndex.set(code, index);
      }
      return index;
    };
    const v4: [number, number, number][] = [];
    const v6: [bigint, bigint, bigint, bigint, number][] = [];

    for (const line of text.split(/\r?\n/)) {
      const [startText, endText, codeText] = line.split(",");
      const code = codeText?.trim().replace(/"/g, "").toUpperCase();
      if (startText === undefined || endText === undefined || code === undefined || !/^[A-Z]{2}$/.test(code)) continue;
      const start = parseIp(startText.replace(/"/g, ""));
      const end = parseIp(endText.replace(/"/g, ""));
      if (start === null || end === null || start.version !== end.version) continue;
      if (start.version === 4 && end.version === 4) v4.push([start.value, end.value, indexOf(code)]);
      else if (start.version === 6 && end.version === 6) v6.push([start.high, start.low, end.high, end.low, indexOf(code)]);
    }

    v4.sort((a, b) => a[0] - b[0]);
    v6.sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0) : a[0] < b[0] ? -1 : 1));

    const v6Start = new BigUint64Array(v6.length * 2);
    const v6End = new BigUint64Array(v6.length * 2);
    v6.forEach(([sh, sl, eh, el], i) => {
      v6Start[2 * i] = sh;
      v6Start[2 * i + 1] = sl;
      v6End[2 * i] = eh;
      v6End[2 * i + 1] = el;
    });

    return new IpCountryIndex(
      Uint32Array.from(v4, (row) => row[0]),
      Uint32Array.from(v4, (row) => row[1]),
      Uint16Array.from(v4, (row) => row[2]),
      v6Start,
      v6End,
      Uint16Array.from(v6, (row) => row[4]),
      countries,
    );
  }

  lookup(address: string): string | null {
    const ip = parseIp(address);
    if (ip === null || isPrivateAddress(ip)) return null;
    if (ip.version === 4) {
      // The last range starting at or before the address; it matches if it has not ended.
      let lo = 0;
      let hi = this.v4Start.length - 1;
      let found = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (this.v4Start[mid]! <= ip.value) {
          found = mid;
          lo = mid + 1;
        } else {
          hi = mid - 1;
        }
      }
      return found >= 0 && ip.value <= this.v4End[found]! ? this.countries[this.v4Country[found]!]! : null;
    }

    const before = (h1: bigint, l1: bigint, h2: bigint, l2: bigint) => h1 < h2 || (h1 === h2 && l1 <= l2);
    let lo = 0;
    let hi = this.v6Country.length - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (before(this.v6Start[2 * mid]!, this.v6Start[2 * mid + 1]!, ip.high, ip.low)) {
        found = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    if (found < 0) return null;
    return before(ip.high, ip.low, this.v6End[2 * found]!, this.v6End[2 * found + 1]!) ? this.countries[this.v6Country[found]!]! : null;
  }
}

/**
 * The client's address from proxy headers. Behind Railway (and most hosts) the
 * first entry of X-Forwarded-For is the visitor; anyone can forge it, which is
 * acceptable here because it only changes the prices shown while browsing:
 * the VAT charged follows the delivery address.
 */
export function clientAddress(headers: { get(name: string): string | null }): string | null {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded !== null) {
    const first = forwarded.split(",")[0]?.trim();
    if (first !== undefined && first !== "") return first;
  }
  return headers.get("x-real-ip");
}
