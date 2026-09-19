/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Tests the address town line in each country's postal order.
 */

import { describe, expect, it } from "vitest";

import { localityLine } from "@/lib/commerce/address";

describe("localityLine", () => {
  it("writes each country's town line the way its post reads it", () => {
    expect(localityLine({ city: "Athens", postcode: "105 63", country: "GR" })).toBe("105 63 Athens, GR");
    expect(localityLine({ city: "Berlin", postcode: "10117", country: "DE" })).toBe("10117 Berlin, DE");
    expect(localityLine({ city: "Springfield", postcode: "62701", country: "US", region: "IL" })).toBe("Springfield, IL 62701, US");
    expect(localityLine({ city: "Montreal", postcode: "H2X 1Y4", country: "CA", region: "QC" })).toBe("Montreal QC H2X 1Y4, CA");
    expect(localityLine({ city: "Sydney", postcode: "2000", country: "AU", region: "NSW" })).toBe("Sydney NSW 2000, AU");
    expect(localityLine({ city: "London", postcode: "SW1A 1AA", country: "GB" })).toBe("London SW1A 1AA, GB");
    expect(localityLine({ city: "Zürich", postcode: "8001", country: "CH" })).toBe("8001 Zürich, CH");
  });
});
