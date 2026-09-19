/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Unit tests for CSV exports: quoting, formula injection and amounts.
 */

import { describe, expect, it } from "vitest";

import { centsToDecimal, csvCell, toCsv } from "@/lib/admin/csv";

describe("csvCell", () => {
  it("quotes commas, quotes and line breaks", () => {
    expect(csvCell("Ermou 10, Athens")).toBe('"Ermou 10, Athens"');
    expect(csvCell('The "Oslo" chair')).toBe('"The ""Oslo"" chair"');
    expect(csvCell("line one\nline two")).toBe('"line one\nline two"');
  });

  it("disarms text a spreadsheet would run as a formula", () => {
    expect(csvCell("=HYPERLINK(\"http://evil\")")).toBe(`"'=HYPERLINK(""http://evil"")"`);
    expect(csvCell("+30 690 000 0000")).toBe("'+30 690 000 0000");
    expect(csvCell("-2+3")).toBe("'-2+3");
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
  });

  it("writes numbers, booleans, dates and empties plainly", () => {
    expect(csvCell(-12)).toBe("-12");
    expect(csvCell(true)).toBe("true");
    expect(csvCell(new Date("2026-09-19T10:00:00Z"))).toBe("2026-09-19T10:00:00.000Z");
    expect(csvCell(null)).toBe("");
    expect(csvCell(Number.NaN)).toBe("");
  });

  it("keeps Greek text as it is", () => {
    expect(csvCell("Ελένη Παπαδοπούλου")).toBe("Ελένη Παπαδοπούλου");
  });
});

describe("toCsv", () => {
  it("starts with a byte-order mark and ends every line with CRLF", () => {
    const file = toCsv(["number", "total"], [["VT-1", "10.00"], ["VT-2", "5.50"]]);
    expect(file.charCodeAt(0)).toBe(0xfeff);
    expect(file.slice(1)).toBe("number,total\r\nVT-1,10.00\r\nVT-2,5.50\r\n");
  });
});

describe("centsToDecimal", () => {
  it("writes cents as an amount with two decimals", () => {
    expect(centsToDecimal(123450)).toBe("1234.50");
    expect(centsToDecimal(5)).toBe("0.05");
    expect(centsToDecimal(-9990)).toBe("-99.90");
    expect(centsToDecimal(0)).toBe("0.00");
  });
});
