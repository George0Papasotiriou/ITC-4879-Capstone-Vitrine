/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * A small PDF writer: pages, text in the three standard fonts, rules and filled rectangles.
 */

/**
 * The weekly report is a PDF (docs/adr/020), and this writes it.
 *
 * Why by hand rather than with a PDF library: the report needs text, rules and
 * filled rectangles and nothing else. The three fonts it uses — Helvetica,
 * Helvetica-Bold and Courier — are among the fourteen every PDF reader is
 * required to have, so nothing is embedded and no font file has to survive the
 * worker's bundling. The result is one dependency fewer and a file whose every
 * byte is accounted for here.
 *
 * What it is not: a general PDF library. Text is Latin-1 (the encoding those
 * standard fonts come with), there is no line breaking, no images and no
 * transparency. The report is written in English for that reason; the email
 * that carries it is in the reader's language.
 */

/** A4 in points, the paper the report is read and printed on. */
export const A4 = { width: 595.28, height: 841.89 } as const;

export type PdfFont = "sans" | "sansBold" | "mono";

const FONT_NAMES: Record<PdfFont, string> = { sans: "Helvetica", sansBold: "Helvetica-Bold", mono: "Courier" };
const FONT_KEYS: Record<PdfFont, string> = { sans: "F1", sansBold: "F2", mono: "F3" };

/** Courier is metrically fixed: every glyph is 600/1000 of the point size. */
export const MONO_WIDTH_RATIO = 0.6;

/** Helvetica has no single width; this average only keeps text clear of a box edge. */
const SANS_WIDTH_RATIO = 0.52;

export function textWidth(value: string, size: number, font: PdfFont): number {
  return value.length * size * (font === "mono" ? MONO_WIDTH_RATIO : SANS_WIDTH_RATIO);
}

export type Rgb = readonly [number, number, number];

/** The design tokens the report is drawn in (src/app/globals.css), as PDF colours. */
export const INK = {
  dusk: [0.114, 0.137, 0.188],
  slate: [0.357, 0.384, 0.439],
  hairline: [0.816, 0.827, 0.804],
  plinth: [0.894, 0.902, 0.886],
  white: [1, 1, 1],
} as const satisfies Record<string, Rgb>;

/**
 * Characters the standard fonts cannot show, written the way a reader would
 * expect instead of dropped: catalogue copy is full of dashes and curly
 * quotation marks.
 */
const REPLACEMENTS = new Map<string, string>([
  [String.fromCharCode(0x2013), "-"],
  [String.fromCharCode(0x2014), "-"],
  [String.fromCharCode(0x2018), "'"],
  [String.fromCharCode(0x2019), "'"],
  [String.fromCharCode(0x201c), '"'],
  [String.fromCharCode(0x201d), '"'],
  [String.fromCharCode(0x2026), "..."],
  [String.fromCharCode(0x00d7), "x"],
  [String.fromCharCode(0x2022), "-"],
]);

/** Text as the standard fonts can show it: Latin-1, with anything else spelled out or dropped. */
export function toLatin1(value: string): string {
  let out = "";
  for (const character of value) {
    const replacement = REPLACEMENTS.get(character);
    if (replacement !== undefined) {
      out += replacement;
      continue;
    }
    const code = character.codePointAt(0)!;
    // The euro sign sits at 128 in WinAnsiEncoding, which is what these fonts use.
    if (code === 0x20ac) out += String.fromCharCode(128);
    else if (code === 9) out += " ";
    else if (code >= 32 && code <= 255) out += character;
  }
  return out;
}

/** A string as a PDF literal: the characters that end or nest a literal are escaped. */
export function pdfString(value: string): string {
  return "(" + toLatin1(value).replace(/[\\()]/g, (character) => "\\" + character) + ")";
}

const round = (value: number) => Number(value.toFixed(3));
const colour = (rgb: Rgb) => `${round(rgb[0])} ${round(rgb[1])} ${round(rgb[2])}`;

export type TextOptions = { font?: PdfFont; size?: number; color?: Rgb };
export type LineOptions = { width?: number; color?: Rgb };

/**
 * One document, written in the order things are drawn. Coordinates are points
 * from the top-left corner, which is how a page is read; the PDF's own
 * bottom-left origin is an implementation detail of `save`.
 */
export class PdfDocument {
  readonly width: number;
  readonly height: number;
  private readonly pages: string[][] = [];

  constructor({ width = A4.width, height = A4.height }: { width?: number; height?: number } = {}) {
    this.width = width;
    this.height = height;
    this.addPage();
  }

  get pageCount(): number {
    return this.pages.length;
  }

  addPage(): void {
    this.pages.push([]);
  }

  private get current(): string[] {
    return this.pages[this.pages.length - 1]!;
  }

  /** Text with its baseline `y` points from the top of the page. */
  text(value: string, x: number, y: number, { font = "sans", size = 10, color = INK.dusk }: TextOptions = {}): void {
    this.current.push(
      `BT ${colour(color)} rg /${FONT_KEYS[font]} ${round(size)} Tf 1 0 0 1 ${round(x)} ${round(this.height - y)} Tm ${pdfString(value)} Tj ET`,
    );
  }

  /** Text whose right edge sits at `right`: exact for the mono font, near enough for a label. */
  textRight(value: string, right: number, y: number, options: TextOptions = {}): void {
    const font = options.font ?? "mono";
    const size = options.size ?? 10;
    this.text(value, right - textWidth(value, size, font), y, { ...options, font, size });
  }

  rect(x: number, y: number, width: number, height: number, color: Rgb = INK.plinth): void {
    this.current.push(`${colour(color)} rg ${round(x)} ${round(this.height - y - height)} ${round(width)} ${round(height)} re f`);
  }

  line(x1: number, y1: number, x2: number, y2: number, { width = 0.5, color = INK.hairline }: LineOptions = {}): void {
    this.current.push(`${colour(color)} RG ${round(width)} w ${round(x1)} ${round(this.height - y1)} m ${round(x2)} ${round(this.height - y2)} l S`);
  }

  /** The finished file. */
  save(): Uint8Array {
    const objects: string[] = [];
    const fontObjectNumbers: Record<PdfFont, number> = { sans: 3, sansBold: 4, mono: 5 };
    const firstPageObject = 6;
    // Each page is two objects: the page itself and its content stream.
    const pageNumbers = this.pages.map((_, index) => firstPageObject + index * 2);

    objects.push("<< /Type /Catalog /Pages 2 0 R >>");
    objects.push(`<< /Type /Pages /Kids [${pageNumbers.map((number) => `${number} 0 R`).join(" ")}] /Count ${this.pages.length} >>`);
    for (const font of ["sans", "sansBold", "mono"] as const) {
      objects.push(`<< /Type /Font /Subtype /Type1 /BaseFont /${FONT_NAMES[font]} /Encoding /WinAnsiEncoding >>`);
    }
    const resources = `<< /Font << ${(["sans", "sansBold", "mono"] as const).map((font) => `/${FONT_KEYS[font]} ${fontObjectNumbers[font]} 0 R`).join(" ")} >> >>`;

    this.pages.forEach((content, index) => {
      const stream = content.join("\n");
      objects.push(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${round(this.width)} ${round(this.height)}] /Resources ${resources} /Contents ${pageNumbers[index]! + 1} 0 R >>`,
      );
      objects.push(`<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`);
    });

    const chunks: Buffer[] = [];
    let offset = 0;
    const write = (text: string) => {
      const buffer = Buffer.from(text, "latin1");
      chunks.push(buffer);
      offset += buffer.length;
    };

    write("%PDF-1.7\n");
    // A comment of high bytes, which marks the file as binary for anything that
    // would otherwise transfer it as text.
    write(`%${String.fromCharCode(226, 227, 207, 211)}\n`);

    const offsets: number[] = [];
    objects.forEach((body, index) => {
      offsets.push(offset);
      write(`${index + 1} 0 obj\n${body}\nendobj\n`);
    });

    // The cross-reference table: where each object starts, so a reader can jump
    // to any of them. Every entry is exactly twenty bytes, by the specification.
    const xrefOffset = offset;
    const entries = ["0".repeat(10) + " 65535 f \n", ...offsets.map((value) => `${String(value).padStart(10, "0")} 00000 n \n`)];
    write(`xref\n0 ${objects.length + 1}\n${entries.join("")}`);
    write(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);

    return new Uint8Array(Buffer.concat(chunks));
  }
}
