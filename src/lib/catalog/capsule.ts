/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * The Wear capsule: twenty-four pieces, their sizes and size charts, and the flat-lay drawings that stand in for photography.
 */

import type { ColorId } from "@/lib/search/vocabulary";
import { CAPSULE_SIZES, stableUnit, type CapsuleSize } from "@/lib/catalog/taxonomy";

/**
 * The capsule (docs/adr/022).
 *
 * The Fitting Room needs clothes, and the shop's furniture dataset has none.
 * Buying photography is not an option for a student project, and a generated
 * photograph of a person wearing something would be a picture of nobody, so
 * the capsule is **drawn**: each piece is a flat lay built from a few curves,
 * in the fabric's own colour, on the white ground the shop's tiles expect.
 * Every product page says the images are drawings.
 *
 * The data here is the product: title, fabric, colour, price band, and the
 * stock of each size. `scripts/capsule.ts` turns it into images and a
 * catalogue fixture; nothing is fetched and nothing costs anything.
 */

export type CapsuleKind = "TOP" | "SHIRT" | "KNIT" | "TROUSERS" | "SKIRT" | "DRESS" | "COAT" | "JACKET";

export type CapsulePiece = {
  /** Stable id: the slug, the SKU and the image name all come from it. */
  id: string;
  kind: CapsuleKind;
  titleEn: string;
  titleEl: string;
  /**
   * The fabric's own colour (a key of CAPSULE_COLOURS: "ecru", "ink"…). What the
   * catalogue files it under — the word the colour filter and search by photo
   * use — is CAPSULE_COLOUR_WORDS[color].
   */
  color: ColourId;
  colorLabelEn: string;
  colorLabelEl: string;
  /** What it is made of, in the same vocabulary. */
  materials: string[];
  fabricEn: string;
  fabricEl: string;
  fitEn: string;
  fitEl: string;
  careEn: string;
  careEl: string;
  priceCents: number;
  /** Sale price before the reduction, when there is one. */
  compareAtCents: number | null;
};

/** The fabric colours the capsule is dyed in, as they are drawn. */
export const CAPSULE_COLOURS = {
  ecru: { fill: "#eae4d9", shade: "#ded7c8", line: "#c3baa6" },
  oat: { fill: "#d8cdbb", shade: "#cabda8", line: "#ab9c83" },
  clay: { fill: "#c08a6e", shade: "#b07b60", line: "#8e5e46" },
  olive: { fill: "#8a8c6a", shade: "#7c7e5d", line: "#5f6145" },
  slate: { fill: "#6f7a89", shade: "#626d7b", line: "#4a5462" },
  ink: { fill: "#2b3242", shade: "#232939", line: "#161b27" },
  sage: { fill: "#a9b5a4", shade: "#9aa795", line: "#7b8975" },
  rust: { fill: "#a2553c", shade: "#934a33", line: "#6f3624" },
} as const satisfies Readonly<Record<string, { fill: string; shade: string; line: string }>>;

export type ColourId = keyof typeof CAPSULE_COLOURS;

/**
 * Each fabric colour filed under the shop's own colour word
 * (src/lib/search/vocabulary.ts), so the colour filter, search and search by
 * photo find the capsule like everything else. Where the vocabulary already
 * lists the name as a synonym ("slate", "olive", "sage", "rust", "navy") that
 * decides it; ecru and oat are cream tones, filed with beige; clay is a light
 * terracotta, and on screen it reads orange rather than red. The fabric's own
 * name stays the label a shopper sees ("Ecru").
 *
 * Found by evaluation E9: the first import filed the fabric names themselves,
 * which no filter or search could match.
 */
export const CAPSULE_COLOUR_WORDS: Readonly<Record<ColourId, ColorId>> = {
  ecru: "beige",
  oat: "beige",
  clay: "orange",
  olive: "green",
  slate: "grey",
  ink: "blue",
  sage: "green",
  rust: "orange",
};

const piece = (
  id: string,
  kind: CapsuleKind,
  titleEn: string,
  titleEl: string,
  colour: ColourId,
  colorLabelEn: string,
  colorLabelEl: string,
  materials: string[],
  fabricEn: string,
  fabricEl: string,
  fitEn: string,
  fitEl: string,
  careEn: string,
  careEl: string,
  priceCents: number,
  compareAtCents: number | null = null,
): CapsulePiece => ({
  id,
  kind,
  titleEn,
  titleEl,
  color: colour,
  colorLabelEn,
  colorLabelEl,
  materials,
  fabricEn,
  fabricEl,
  fitEn,
  fitEl,
  careEn,
  careEl,
  priceCents,
  compareAtCents,
});

const WASH_COLD_EN = "Machine wash cold, dry flat.";
const WASH_COLD_EL = "Πλύσιμο στο πλυντήριο σε κρύο νερό, στέγνωμα απλωμένο.";
const WASH_WOOL_EN = "Hand wash cool, dry flat, do not wring.";
const WASH_WOOL_EL = "Πλύσιμο στο χέρι με δροσερό νερό, στέγνωμα απλωμένο, χωρίς στύψιμο.";
const DRY_CLEAN_EN = "Dry clean only.";
const DRY_CLEAN_EL = "Μόνο στεγνό καθάρισμα.";

/** Twenty-four pieces: three in each of the eight kinds, in one colour each. */
export const CAPSULE: readonly CapsulePiece[] = [
  // Tops
  piece("heavy-cotton-tee-ecru", "TOP", "Heavy Cotton Tee", "Βαμβακερό T-shirt", "ecru", "Ecru", "Εκρού", ["cotton"], "Heavy jersey, 240 g/m²", "Βαρύ ζέρσεϊ, 240 g/m²", "Straight, drops at the shoulder", "Ίσια γραμμή, πέφτει στον ώμο", WASH_COLD_EN, WASH_COLD_EL, 4900),
  piece("heavy-cotton-tee-ink", "TOP", "Heavy Cotton Tee", "Βαμβακερό T-shirt", "ink", "Ink", "Μελανί", ["cotton"], "Heavy jersey, 240 g/m²", "Βαρύ ζέρσεϊ, 240 g/m²", "Straight, drops at the shoulder", "Ίσια γραμμή, πέφτει στον ώμο", WASH_COLD_EN, WASH_COLD_EL, 4900),
  piece("linen-vest-sage", "TOP", "Linen Vest", "Λινό αμάνικο", "sage", "Sage", "Φασκόμηλο", ["linen"], "Washed linen, 170 g/m²", "Πλυμένο λινό, 170 g/m²", "Close at the shoulder, easy through the body", "Εφαρμοστό στον ώμο, άνετο στο σώμα", WASH_COLD_EN, WASH_COLD_EL, 5900, 7900),

  // Shirts
  piece("poplin-shirt-ecru", "SHIRT", "Poplin Shirt", "Ποπλίνα πουκάμισο", "ecru", "Ecru", "Εκρού", ["cotton"], "Cotton poplin, 120 g/m²", "Βαμβακερή ποπλίνα, 120 g/m²", "Relaxed, boxy hem", "Άνετο, ίσιο τελείωμα", WASH_COLD_EN, WASH_COLD_EL, 8900),
  piece("linen-shirt-oat", "SHIRT", "Linen Shirt", "Λινό πουκάμισο", "oat", "Oat", "Βρώμη", ["linen"], "Washed linen, 190 g/m²", "Πλυμένο λινό, 190 g/m²", "Relaxed, straight cuff", "Άνετο, ίσια μανσέτα", WASH_COLD_EN, WASH_COLD_EL, 9900),
  piece("overshirt-olive", "SHIRT", "Cotton Overshirt", "Βαμβακερό πουκάμισο-ζακέτα", "olive", "Olive", "Λαδί", ["cotton"], "Brushed cotton twill", "Χνουδωτή βαμβακερή τουίλ", "Roomy, worn over a tee", "Φαρδύ, πάνω από T-shirt", WASH_COLD_EN, WASH_COLD_EL, 12900),

  // Knitwear
  piece("merino-crew-slate", "KNIT", "Merino Crew", "Μερινό πουλόβερ", "slate", "Slate", "Ανθρακί μπλε", ["wool"], "Fine merino, 12 gauge", "Λεπτό μερινό, 12 gauge", "Slim, ribbed cuffs", "Στενή γραμμή, ριμπ μανσέτες", WASH_WOOL_EN, WASH_WOOL_EL, 12900),
  piece("lambswool-jumper-rust", "KNIT", "Lambswool Jumper", "Πουλόβερ lambswool", "rust", "Rust", "Κεραμιδί", ["wool"], "Lambswool, brushed", "Lambswool, χνουδωτό", "Easy, dropped shoulder", "Άνετο, χαμηλός ώμος", WASH_WOOL_EN, WASH_WOOL_EL, 15900),
  piece("cotton-cardigan-ecru", "KNIT", "Cotton Cardigan", "Βαμβακερή ζακέτα", "ecru", "Ecru", "Εκρού", ["cotton"], "Cotton, mid gauge", "Βαμβάκι, μεσαίο gauge", "Straight, hip length", "Ίσια, μέχρι τη μέση", WASH_COLD_EN, WASH_COLD_EL, 13900, 17900),

  // Trousers
  piece("wide-trousers-ink", "TROUSERS", "Wide Trousers", "Φαρδύ παντελόνι", "ink", "Ink", "Μελανί", ["cotton"], "Cotton twill, 300 g/m²", "Βαμβακερή τουίλ, 300 g/m²", "High waist, wide leg", "Ψηλόμεσο, φαρδύ πόδι", WASH_COLD_EN, WASH_COLD_EL, 11900),
  piece("linen-trousers-oat", "TROUSERS", "Linen Trousers", "Λινό παντελόνι", "oat", "Oat", "Βρώμη", ["linen"], "Washed linen, 200 g/m²", "Πλυμένο λινό, 200 g/m²", "Drawstring waist, straight leg", "Λάστιχο με κορδόνι, ίσιο πόδι", WASH_COLD_EN, WASH_COLD_EL, 10900),
  piece("tapered-trousers-olive", "TROUSERS", "Tapered Trousers", "Στενό παντελόνι", "olive", "Olive", "Λαδί", ["cotton"], "Stretch cotton twill", "Ελαστική βαμβακερή τουίλ", "Mid waist, tapered", "Μέση στη μέση, στενό προς τα κάτω", WASH_COLD_EN, WASH_COLD_EL, 12900),

  // Skirts
  piece("bias-skirt-slate", "SKIRT", "Bias Skirt", "Λοξή φούστα", "slate", "Slate", "Ανθρακί μπλε", ["linen"], "Linen blend, bias cut", "Μείγμα λινού, λοξή κοπή", "Falls from the hip, midi", "Πέφτει από τον γοφό, midi", WASH_COLD_EN, WASH_COLD_EL, 9900),
  piece("pleated-skirt-ecru", "SKIRT", "Pleated Skirt", "Πλισέ φούστα", "ecru", "Ecru", "Εκρού", ["cotton"], "Cotton, pressed pleats", "Βαμβάκι, μόνιμες πιέτες", "High waist, midi", "Ψηλόμεσο, midi", DRY_CLEAN_EN, DRY_CLEAN_EL, 11900),
  piece("denim-skirt-clay", "SKIRT", "Twill Skirt", "Φούστα τουίλ", "clay", "Clay", "Κεραμιδί ανοιχτό", ["cotton"], "Cotton twill, 320 g/m²", "Βαμβακερή τουίλ, 320 g/m²", "A-line, above the knee", "Γραμμή Α, πάνω από το γόνατο", WASH_COLD_EN, WASH_COLD_EL, 8900),

  // Dresses
  piece("linen-dress-sage", "DRESS", "Linen Dress", "Λινό φόρεμα", "sage", "Sage", "Φασκόμηλο", ["linen"], "Washed linen, 190 g/m²", "Πλυμένο λινό, 190 g/m²", "Easy through the body, midi", "Άνετο στο σώμα, midi", WASH_COLD_EN, WASH_COLD_EL, 14900),
  piece("shirt-dress-oat", "DRESS", "Shirt Dress", "Σεμιζιέ φόρεμα", "oat", "Oat", "Βρώμη", ["cotton"], "Cotton poplin", "Βαμβακερή ποπλίνα", "Belted, knee length", "Με ζώνη, μέχρι το γόνατο", WASH_COLD_EN, WASH_COLD_EL, 15900),
  piece("knit-dress-ink", "DRESS", "Knit Dress", "Πλεκτό φόρεμα", "ink", "Ink", "Μελανί", ["wool"], "Merino blend", "Μείγμα μερινό", "Close, ribbed", "Εφαρμοστό, ριμπ", WASH_WOOL_EN, WASH_WOOL_EL, 17900, 21900),

  // Coats
  piece("wool-coat-ink", "COAT", "Wool Coat", "Μάλλινο παλτό", "ink", "Ink", "Μελανί", ["wool"], "Wool melton, 700 g/m²", "Μάλλινο melton, 700 g/m²", "Straight, below the knee", "Ίσιο, κάτω από το γόνατο", DRY_CLEAN_EN, DRY_CLEAN_EL, 32900),
  piece("belted-coat-oat", "COAT", "Belted Coat", "Παλτό με ζώνη", "oat", "Oat", "Βρώμη", ["wool"], "Wool and cashmere", "Μαλλί και κασμίρι", "Wrapped, belted at the waist", "Κρουαζέ, με ζώνη στη μέση", DRY_CLEAN_EN, DRY_CLEAN_EL, 36900),
  piece("rain-coat-olive", "COAT", "Rain Coat", "Αδιάβροχο", "olive", "Olive", "Λαδί", ["cotton"], "Waxed cotton", "Κερωμένο βαμβάκι", "Roomy, hooded", "Φαρδύ, με κουκούλα", DRY_CLEAN_EN, DRY_CLEAN_EL, 27900),

  // Jackets
  piece("linen-blazer-ecru", "JACKET", "Linen Blazer", "Λινό σακάκι", "ecru", "Ecru", "Εκρού", ["linen"], "Linen, unlined", "Λινό, χωρίς φόδρα", "Soft shoulder, two buttons", "Μαλακός ώμος, δύο κουμπιά", DRY_CLEAN_EN, DRY_CLEAN_EL, 19900),
  piece("chore-jacket-slate", "JACKET", "Chore Jacket", "Ζακέτα εργασίας", "slate", "Slate", "Ανθρακί μπλε", ["cotton"], "Cotton canvas, 340 g/m²", "Βαμβακερό καραβόπανο, 340 g/m²", "Boxy, three pockets", "Τετράγωνη γραμμή, τρεις τσέπες", WASH_COLD_EN, WASH_COLD_EL, 14900),
  piece("quilted-jacket-clay", "JACKET", "Quilted Jacket", "Καπιτονέ μπουφάν", "clay", "Clay", "Κεραμιδί ανοιχτό", ["cotton"], "Quilted cotton, recycled wadding", "Καπιτονέ βαμβάκι, ανακυκλωμένο γέμισμα", "Short, snap front", "Κοντό, με σούστες", WASH_COLD_EN, WASH_COLD_EL, 16900, 20900),
];

/**
 * Stock per size, from the piece's id so it never changes between runs: the
 * middle sizes hold more than the ends, and roughly one piece in six has a
 * size that has sold out, which is what makes the size picker worth testing.
 */
export function capsuleStock(id: string, size: CapsuleSize): number {
  const middle = size === "M" || size === "L" ? 1 : size === "S" ? 0.7 : 0.45;
  const draw = stableUnit(`capsule-stock:${id}:${size}`);
  if (draw < 0.08) return 0;
  return Math.max(1, Math.round(draw * 14 * middle));
}

export const capsuleSizes = (id: string) => CAPSULE_SIZES.map((size) => ({ size, stock: capsuleStock(id, size) }));

/**
 * Body measurements in centimetres, by kind. One chart per family rather than
 * per product: the capsule is cut on one block, and a shopper comparing two
 * tops should not have to compare two tables.
 */
export type SizeChart = { measure: { en: string; el: string }; values: Record<CapsuleSize, number> };

const chart = (en: string, el: string, values: [number, number, number, number, number]): SizeChart => ({
  measure: { en, el },
  values: { XS: values[0], S: values[1], M: values[2], L: values[3], XL: values[4] },
});

const UPPER: SizeChart[] = [
  chart("Chest", "Στήθος", [86, 92, 98, 106, 114]),
  chart("Waist", "Μέση", [70, 76, 82, 90, 98]),
  chart("Length from shoulder", "Μήκος από τον ώμο", [64, 66, 68, 70, 72]),
];

const LOWER: SizeChart[] = [
  chart("Waist", "Μέση", [66, 72, 78, 86, 94]),
  chart("Hip", "Γοφοί", [90, 96, 102, 110, 118]),
  chart("Inside leg", "Εσωτερικό πόδι", [76, 77, 78, 79, 80]),
];

const DRESS_CHART: SizeChart[] = [
  chart("Chest", "Στήθος", [84, 90, 96, 104, 112]),
  chart("Waist", "Μέση", [68, 74, 80, 88, 96]),
  chart("Length from shoulder", "Μήκος από τον ώμο", [108, 110, 112, 114, 116]),
];

const SKIRT_CHART: SizeChart[] = [
  chart("Waist", "Μέση", [66, 72, 78, 86, 94]),
  chart("Hip", "Γοφοί", [90, 96, 102, 110, 118]),
  chart("Length", "Μήκος", [66, 67, 68, 69, 70]),
];

export function sizeChartFor(kind: string): SizeChart[] | null {
  if (kind === "TOP" || kind === "SHIRT" || kind === "KNIT" || kind === "JACKET" || kind === "COAT") return UPPER;
  if (kind === "TROUSERS") return LOWER;
  if (kind === "SKIRT") return SKIRT_CHART;
  if (kind === "DRESS") return DRESS_CHART;
  return null;
}

/**
 * A size for a body, from the chart: the smallest size whose chest (or waist,
 * for what is worn below) is at least the measurement given. Bigger than the
 * chart's largest is XL with a note; the caller decides how to say it.
 */
export function suggestSize(kind: string, measurementCm: number): { size: CapsuleSize; beyondChart: boolean } | null {
  const chartForKind = sizeChartFor(kind);
  if (chartForKind === null) return null;
  const first = chartForKind[0]!;
  for (const size of CAPSULE_SIZES) {
    if (measurementCm <= first.values[size]) return { size, beyondChart: false };
  }
  return { size: "XL", beyondChart: true };
}
