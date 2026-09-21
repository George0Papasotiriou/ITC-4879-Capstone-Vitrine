/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Controlled bilingual vocabulary of colours, materials and categories.
 */

import type { CategorySlug } from "@/lib/catalog/taxonomy";
import { greeklishCandidates } from "@/lib/search/greeklish";
import { scriptOf, tokenize } from "@/lib/search/normalize";

/**
 * The controlled vocabulary shared by query parsing and catalogue indexing
 * (docs/PLAN.md 2.6, A1).
 *
 * A query filter only works if the products were described with the same
 * words. When a shopper types "μαύρη δερμάτινη πολυθρόνα", the parser turns
 * "μαύρη" into the canonical id `black`; when ABO says a chair's colour is
 * "Jet Black", the importer turns that into `black` too. One dictionary,
 * used on both sides, is what makes the two meet.
 *
 * Matching rules. English entries match a whole word, singular or plural.
 * Greek entries are stems: Greek adjectives and nouns inflect ("μαύρος, μαύρη,
 * μαύρο, μαύρα, μαύρες"), so "μαυρ" matching the start of a word covers every
 * form. Stems are kept to four letters or more so they do not match unrelated
 * words; short or indeclinable Greek words ("γκρι", "μπεζ", "ράφι") are listed
 * as exact words instead. All Greek is folded (no accents, σ for ς).
 */

export type Entry = {
  english: readonly string[];
  greekStems: readonly string[];
  greekWords?: readonly string[];
};

export type LabelledEntry = Entry & { labelEn: string; labelEl: string };

export const COLORS = {
  black: { labelEn: "Black", labelEl: "Μαύρο", english: ["black", "ebony", "jet"], greekStems: ["μαυρ"] },
  white: { labelEn: "White", labelEl: "Λευκό", english: ["white"], greekStems: ["ασπρ", "λευκ"] },
  grey: {
    labelEn: "Grey",
    labelEl: "Γκρι",
    english: ["grey", "gray", "charcoal", "graphite", "slate"],
    greekStems: [],
    greekWords: ["γκρι"],
  },
  brown: {
    labelEn: "Brown",
    labelEl: "Καφέ",
    english: ["brown", "espresso", "chocolate", "tan", "cognac"],
    greekStems: ["καφετ"],
    greekWords: ["καφε"],
  },
  beige: {
    labelEn: "Beige",
    labelEl: "Μπεζ",
    english: ["beige", "cream", "ivory", "natural", "sand", "taupe"],
    greekStems: ["κρεμ"],
    greekWords: ["μπεζ"],
  },
  red: { labelEn: "Red", labelEl: "Κόκκινο", english: ["red", "burgundy", "terracotta"], greekStems: ["κοκκιν"] },
  blue: { labelEn: "Blue", labelEl: "Μπλε", english: ["blue", "navy", "teal", "indigo"], greekStems: ["γαλαζ"], greekWords: ["μπλε"] },
  green: { labelEn: "Green", labelEl: "Πράσινο", english: ["green", "olive", "sage", "emerald"], greekStems: ["πρασιν"] },
  yellow: { labelEn: "Yellow", labelEl: "Κίτρινο", english: ["yellow", "mustard", "ochre"], greekStems: ["κιτριν"] },
  orange: { labelEn: "Orange", labelEl: "Πορτοκαλί", english: ["orange", "rust"], greekStems: ["πορτοκαλ"] },
  pink: { labelEn: "Pink", labelEl: "Ροζ", english: ["pink", "blush", "rose"], greekStems: [], greekWords: ["ροζ"] },
  purple: { labelEn: "Purple", labelEl: "Μωβ", english: ["purple", "lavender", "plum"], greekStems: [], greekWords: ["μωβ"] },
  gold: { labelEn: "Gold", labelEl: "Χρυσό", english: ["gold", "golden", "brass"], greekStems: ["χρυσ"] },
  silver: { labelEn: "Silver", labelEl: "Ασημί", english: ["silver", "chrome", "nickel"], greekStems: ["ασημ"] },
} as const satisfies Record<string, LabelledEntry>;

export const MATERIALS = {
  oak: { labelEn: "Oak", labelEl: "Δρυς", english: ["oak"], greekStems: ["δρυιν", "βελανιδ"], greekWords: ["δρυσ"] },
  walnut: { labelEn: "Walnut", labelEl: "Καρυδιά", english: ["walnut"], greekStems: ["καρυδ"] },
  wood: {
    labelEn: "Wood",
    labelEl: "Ξύλο",
    english: ["wood", "wooden", "timber", "hardwood", "plywood", "pine", "acacia", "mango", "teak", "bamboo"],
    greekStems: ["ξυλιν"],
    greekWords: ["ξυλο", "ξυλα"],
  },
  metal: {
    labelEn: "Metal",
    labelEl: "Μέταλλο",
    english: ["metal", "metallic", "steel", "iron", "aluminum", "aluminium"],
    greekStems: ["μεταλλ", "ατσαλ", "σιδερ"],
  },
  glass: { labelEn: "Glass", labelEl: "Γυαλί", english: ["glass"], greekStems: ["γυαλ"] },
  leather: { labelEn: "Leather", labelEl: "Δέρμα", english: ["leather", "leathersoft"], greekStems: ["δερμα"] },
  fabric: {
    labelEn: "Fabric",
    labelEl: "Ύφασμα",
    english: ["fabric", "upholstered", "polyester", "microfiber", "boucle", "chenille"],
    greekStems: ["υφασμ"],
  },
  velvet: { labelEn: "Velvet", labelEl: "Βελούδο", english: ["velvet"], greekStems: ["βελουδ"] },
  linen: { labelEn: "Linen", labelEl: "Λινό", english: ["linen"], greekStems: [], greekWords: ["λινο", "λινη", "λινα", "λινεσ"] },
  cotton: { labelEn: "Cotton", labelEl: "Βαμβάκι", english: ["cotton"], greekStems: ["βαμβακ"] },
  marble: { labelEn: "Marble", labelEl: "Μάρμαρο", english: ["marble"], greekStems: ["μαρμαρ"] },
  ceramic: {
    labelEn: "Ceramic",
    labelEl: "Κεραμικό",
    english: ["ceramic", "stoneware", "porcelain", "earthenware"],
    greekStems: ["κεραμ", "πορσελαν"],
  },
  rattan: {
    labelEn: "Rattan",
    labelEl: "Ψάθα",
    english: ["rattan", "wicker", "jute", "seagrass"],
    greekStems: ["ψαθιν", "ρατταν"],
    greekWords: ["ψαθα"],
  },
  wool: { labelEn: "Wool", labelEl: "Μαλλί", english: ["wool", "woolen", "woollen"], greekStems: ["μαλλιν"], greekWords: ["μαλλι"] },
} as const satisfies Record<string, LabelledEntry>;

/** Words that name a category, keyed by the catalogue slug. */
export const CATEGORY_TERMS: Record<CategorySlug, Entry> = {
  seating: {
    english: ["chair", "armchair", "sofa", "couch", "stool", "bench", "ottoman", "seating", "loveseat", "recliner", "sectional"],
    greekStems: ["καρεκλ", "πολυθρον", "καναπ", "σκαμπ", "σκαμν", "παγκ", "πουφ", "καθισμ"],
  },
  tables: {
    english: ["table", "desk", "nightstand", "console"],
    greekStems: ["τραπεζ", "γραφει", "κομοδιν"],
  },
  lighting: {
    // Not "light": in "light blue sofa" it describes a colour, not a lamp.
    english: ["lamp", "lighting", "pendant", "sconce", "chandelier", "lantern"],
    greekStems: ["φωτιστικ", "φωτισμ", "λαμπ", "πολυελαι", "απλικ"],
  },
  rugs: {
    english: ["rug", "carpet", "runner"],
    greekStems: ["χαλακ"],
    greekWords: ["χαλι", "χαλια"],
  },
  storage: {
    english: ["cabinet", "shelf", "shelves", "shelving", "bookcase", "bookshelf", "dresser", "drawer", "basket", "hamper", "rack", "sideboard", "storage"],
    greekStems: ["ντουλαπ", "βιβλιοθηκ", "συρταρ", "καλαθ", "κρεμαστρ", "αποθηκ"],
    greekWords: ["ραφι", "ραφια"],
  },
  bedroom: {
    english: ["bed", "headboard", "pillow", "cushion", "bedroom"],
    greekStems: ["κρεβατ", "κεφαλαρ", "μαξιλαρ", "υπνοδωματ"],
  },
  "wall-decor": {
    english: ["art", "print", "painting", "poster", "mirror", "clock", "frame", "canvas"],
    greekStems: ["πινακ", "καθρεφτ", "καθρεπτ", "ρολογ", "κορνιζ", "αφισ"],
    greekWords: ["ρολοι"],
  },
  accents: {
    english: ["vase", "planter", "pot", "candle", "accent", "accents", "decor"],
    greekStems: ["γλαστρ", "διακοσμητ"],
    greekWords: ["βαζο", "βαζα", "κερι", "κερια"],
  },
  // The Wear capsule (docs/adr/022): a shopper looking for clothes says so in
  // either language, and "wear" is also how the category is named in the shop.
  wear: {
    english: ["wear", "clothes", "clothing", "shirt", "top", "tee", "knit", "jumper", "sweater", "trousers", "skirt", "dress", "coat", "jacket", "capsule"],
    greekStems: ["ρουχ", "μπλουζ", "πουκαμισ", "πλεκτ", "παντελον", "φουστ", "φορεμ", "παλτ", "σακακ"],
  },
};

export type ColorId = keyof typeof COLORS;
export type MaterialId = keyof typeof MATERIALS;

export const STOPWORDS: ReadonlySet<string> = new Set([
  // English
  "a", "an", "the", "for", "with", "in", "of", "and", "or", "to", "my", "me", "i", "want", "need",
  "looking", "show", "find", "some", "something", "please", "like", "that", "is", "on",
  // Greek (folded)
  "για", "με", "σε", "το", "τα", "τη", "την", "τον", "ο", "η", "οι", "ενα", "μια", "ενασ", "και",
  "θελω", "ψαχνω", "δειξε", "βρεσ", "κατι", "απο", "στο", "στη", "στην", "στα", "του", "τησ", "των",
  "που", "ειναι", "μου",
  // Greeklish
  "gia", "thelo", "psaxno", "kati", "sto", "stin", "kai",
]);

function englishForms(token: string): string[] {
  const forms = [token];
  if (token.endsWith("es") && token.length > 4) forms.push(token.slice(0, -2));
  if (token.endsWith("s") && token.length > 3) forms.push(token.slice(0, -1));
  return forms;
}

function matchesGreek(token: string, entry: Entry): boolean {
  return (entry.greekWords ?? []).includes(token) || entry.greekStems.some((stem) => token.startsWith(stem));
}

/**
 * The canonical id a single folded token names in a dictionary, or null.
 *
 * With `greeklish` on, a Latin word that is not an English entry is also tried
 * through its cheapest Greek readings, so "mavri" finds `black`. Catalogue
 * indexing turns this off: ABO text is English, and an English word must never
 * be reinterpreted as Greek.
 */
export function lookup<Id extends string>(
  token: string,
  dictionary: Readonly<Record<Id, Entry>>,
  { greeklish = true }: { greeklish?: boolean } = {},
): Id | null {
  const entries = Object.entries(dictionary) as [Id, Entry][];
  const script = scriptOf(token);
  for (const [id, entry] of entries) {
    if (script === "latin" && englishForms(token).some((form) => entry.english.includes(form))) return id;
    if (script === "greek" && matchesGreek(token, entry)) return id;
  }
  if (greeklish && script === "latin") {
    for (const reading of greeklishCandidates(token, 16)) {
      for (const [id, entry] of entries) {
        if (matchesGreek(reading, entry)) return id;
      }
    }
  }
  return null;
}

/** Every canonical id named anywhere in a text, in order of first mention. */
export function extractTerms<Id extends string>(
  text: string,
  dictionary: Readonly<Record<Id, Entry>>,
  options: { greeklish?: boolean } = {},
): Id[] {
  const found: Id[] = [];
  for (const token of tokenize(text)) {
    const id = lookup(token, dictionary, options);
    if (id !== null && !found.includes(id)) found.push(id);
  }
  return found;
}

export function colorLabel(id: string, locale: string): string {
  const entry = (COLORS as Record<string, LabelledEntry>)[id];
  if (entry === undefined) return id;
  return locale === "el" ? entry.labelEl : entry.labelEn;
}

export function materialLabel(id: string, locale: string): string {
  const entry = (MATERIALS as Record<string, LabelledEntry>)[id];
  if (entry === undefined) return id;
  return locale === "el" ? entry.labelEl : entry.labelEn;
}
