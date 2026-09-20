/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Tests for the PDF writer: a readable file, honest cross-references, and text a standard font can show.
 */

import { describe, expect, it } from "vitest";

import { PdfDocument, pdfString, textWidth, toLatin1 } from "@/lib/report/pdf";

const text = (bytes: Uint8Array) => Buffer.from(bytes).toString("latin1");

describe("toLatin1", () => {
  it("keeps what the standard fonts can show", () => {
    expect(toLatin1("Canova 3-seater, oak & linen")).toBe("Canova 3-seater, oak & linen");
    expect(toLatin1("Ekstrøm")).toBe("Ekstrøm");
  });

  it("writes the characters they cannot, the way a reader expects", () => {
    expect(toLatin1(`Sofa ${String.fromCharCode(0x2014)} ${String.fromCharCode(0x201c)}Linen${String.fromCharCode(0x201d)}`)).toBe('Sofa - "Linen"');
    expect(toLatin1(`2 ${String.fromCharCode(0x00d7)} 3`)).toBe("2 x 3");
    expect(toLatin1(String.fromCharCode(0x20ac) + "519")).toBe(String.fromCharCode(128) + "519");
  });

  it("drops what it cannot write at all, rather than writing nonsense", () => {
    // Greek is why the report is in English (docs/adr/020).
    expect(toLatin1("Καναπές")).toBe("");
  });
});

describe("pdfString", () => {
  it("escapes the characters that would end or nest a literal", () => {
    expect(pdfString("Sofa (oak)")).toBe("(Sofa \\(oak\\))");
    expect(pdfString("a\\b")).toBe("(a\\\\b)");
  });
});

describe("textWidth", () => {
  it("is exact for the fixed-width font", () => {
    expect(textWidth("1234", 10, "mono")).toBeCloseTo(24, 6);
  });
});

describe("PdfDocument", () => {
  const sample = () => {
    const pdf = new PdfDocument();
    pdf.text("Vitrine", 56, 80, { font: "sansBold", size: 20 });
    pdf.text("Weekly report", 56, 104);
    pdf.textRight("1.234,50", 539, 104);
    pdf.rect(56, 120, 100, 8);
    pdf.line(56, 140, 539, 140);
    pdf.addPage();
    pdf.text("Page two", 56, 80);
    return pdf;
  };

  it("writes a file a reader can open", () => {
    const file = text(sample().save());
    expect(file.startsWith("%PDF-1.7")).toBe(true);
    expect(file.endsWith("%%EOF\n")).toBe(true);
    expect(file).toContain("/Type /Catalog");
    expect(file).toContain("/Count 2");
    expect(file).toContain("/BaseFont /Helvetica-Bold");
  });

  it("points at every object where the object really is", () => {
    const file = text(sample().save());
    const start = file.indexOf("xref\n");
    const [, count] = /xref\n0 (\d+)\n/.exec(file.slice(start))!;
    const entries = file
      .slice(start + `xref\n0 ${count}\n`.length)
      .slice(0, Number(count) * 20)
      .match(/.{20}/gs)!;

    expect(entries).toHaveLength(Number(count));
    expect(entries[0]).toContain("65535 f");
    entries.slice(1).forEach((entry, index) => {
      const offset = Number(entry.slice(0, 10));
      expect(file.slice(offset, offset + `${index + 1} 0 obj`.length)).toBe(`${index + 1} 0 obj`);
    });

    // And the trailer points at the table itself.
    const xrefOffset = Number(/startxref\n(\d+)\n/.exec(file)![1]);
    expect(file.slice(xrefOffset, xrefOffset + 4)).toBe("xref");
  });

  it("declares the true length of each content stream", () => {
    const file = text(sample().save());
    for (const match of file.matchAll(/<< \/Length (\d+) >>\nstream\n([\s\S]*?)\nendstream/g)) {
      expect(Buffer.byteLength(match[2]!, "latin1")).toBe(Number(match[1]));
    }
  });

  it("turns page coordinates the right way up", () => {
    const pdf = new PdfDocument({ width: 200, height: 100 });
    pdf.text("x", 10, 30);
    pdf.rect(0, 0, 10, 10);
    const file = text(pdf.save());
    // 30 points from the top of a 100 point page is 70 from the bottom.
    expect(file).toContain("1 0 0 1 10 70 Tm");
    // A rectangle at the very top sits with its lower edge at 90.
    expect(file).toContain("0 90 10 10 re f");
  });
});
