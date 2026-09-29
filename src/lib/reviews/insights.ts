/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Review intelligence: what buyers like and dislike, each point linked to the sentences that say it.
 */

import { fold } from "@/lib/search/normalize";

/**
 * docs/adr/041. Extractive and explainable, with no language model: every
 * point on the product page can be traced to the exact sentences that made
 * it, and nothing is said that a buyer did not write.
 *
 * 1. SENTENCES AND CLAUSES. A review (title and body) is split into sentences
 *    at . ! ? and the Greek question mark ;, and each sentence into clauses at
 *    "but", "however", «αλλά», «όμως» — "Solid, but the colour is darker"
 *    holds a pro and a con, and each is judged on its own words.
 * 2. ASPECTS. A clause is about an aspect when one of its words starts with
 *    one of that aspect's stems, in English or Greek, after the same folding
 *    search uses (case, accents, final sigma): "κατασκευή" and "construction"
 *    are both `build`.
 * 3. POLARITY. Each opinion word adds +1 or −1. A negator in the three words
 *    before it flips it ("not comfortable", «δεν είναι άνετο»); an intensifier
 *    just before it makes it count 1.5 ("very sturdy", «πολύ γερό»). A clause
 *    that names an aspect but holds no opinion word takes a half vote from the
 *    review's stars: ≥ 4 for, ≤ 2 against, 3 neither.
 * 4. PER REVIEW, THEN PER PRODUCT. A review's clauses about one aspect are
 *    summed, so a review counts once per aspect, for or against. A point is
 *    shown when at least two reviews make it — or one, while a product has
 *    fewer than five reviews — so a single voice is not presented as what
 *    "buyers" think once there are enough voices to tell.
 *
 * Review text is untrusted: it is only matched against the word lists and
 * quoted back as it was written, never followed.
 */

export const ASPECTS = ["build", "comfort", "size", "colour", "assembly", "delivery", "value"] as const;
export type AspectId = (typeof ASPECTS)[number];

/** Stems, folded; a word belongs to an aspect when it starts with one of them. */
const ASPECT_STEMS: Record<AspectId, readonly string[]> = {
  build: ["quality", "sturdy", "solid", "flimsy", "wobbl", "construct", "build", "built", "made", "craftsman", "frame", "κατασκευ", "ποιοτ", "γερ", "στιβαρ", "κουνιετ", "φτιαγμεν"],
  comfort: ["comfort", "comfy", "soft", "firm", "cushion", "seat", "ανετ", "μαλακ", "σκληρ", "καθισ", "μαξιλαρ"],
  size: ["size", "big", "small", "large", "tall", "fits", "fit", "dimension", "spacious", "μεγεθ", "μεγαλ", "μικρ", "χωρα", "διαστασ", "ψηλ"],
  colour: ["colour", "color", "shade", "look", "photo", "χρωμ", "αποχρωσ", "φωτογραφ", "εμφανισ"],
  assembly: ["assembl", "instruction", "screw", "συναρμολογ", "οδηγι", "βιδ", "στησιμ"],
  delivery: ["deliver", "arriv", "shipping", "shipped", "packag", "packed", "courier", "παραδοσ", "παραδοθ", "ηρθε", "εφτασ", "συσκευασ", "αργησ", "κουριερ"],
  value: ["price", "value", "worth", "money", "expensive", "bargain", "τιμ", "αξιζ", "ακριβ", "λεφτ", "χρηματ"],
};

/** Opinion words (stems, folded) and their direction. */
const POSITIVE = [
  "good", "great", "excellent", "love", "lovely", "beautiful", "gorgeous", "handsome", "solid", "sturdy", "comfortable", "comfy", "easy", "perfect", "nice",
  "quick", "fast", "happy", "recommend", "worth", "prefer", "well", "pleased", "impress", "stunning",
  "καλ", "τελει", "υπεροχ", "ομορφ", "γερ", "στιβαρ", "ανετ", "ευκολ", "γρηγορ", "αξιζ", "ικανοποι", "αγαπ", "εξαιρετ", "προσεγμεν", "ενημερωσ",
];
const NEGATIVE = [
  "bad", "poor", "cheap", "flimsy", "wobbl", "broke", "damag", "scratch", "late", "slow", "difficult", "hard", "uncomfortable", "disappoint", "missing",
  "faulty", "defect", "worse", "worst", "awful", "terrible", "smaller", "darker",
  "κακ", "χαλασ", "σπασ", "αργησ", "δυσκολ", "απογοητ", "ελαττωμ", "κουνιετ", "στραβ", "λειπ", "χειροτερ",
];
const NEGATORS = new Set(["not", "no", "never", "isn", "doesn", "don", "wasn", "aren", "didn", "won", "hasn", "couldn", "nothing", "δεν", "οχι", "μη", "μην", "ουτε"]);
const INTENSIFIERS = new Set(["very", "really", "so", "extremely", "incredibly", "super", "πολυ", "παρα", "τρομερα", "απιστευτα"]);
const CLAUSE_BREAK = /\b(?:but|however|although|though|yet)\b|αλλα|ομως|ωστοσο/u;

export type ReviewForInsights = { id: string; rating: number; title: string | null; body: string; authorName: string };

export type Evidence = { reviewId: string; author: string; sentence: string };
export type InsightPoint = { aspect: AspectId; polarity: "pro" | "con"; reviews: number; evidence: Evidence[] };
export type ReviewInsights = { reviewed: number; pros: InsightPoint[]; cons: InsightPoint[] };

const MAX_EVIDENCE = 3;

/** Sentences of a review as written (for quoting), each with its folded clauses (for reading). */
export function sentencesOf(text: string): { sentence: string; clauses: string[][] }[] {
  return text
    .split(/(?<=[.!?;])\s+|\n+/u)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0)
    .map((sentence) => ({
      sentence,
      clauses: fold(sentence)
        .split(CLAUSE_BREAK)
        .map((clause) => clause.match(/[\p{L}\p{N}]+/gu) ?? [])
        .filter((words) => words.length > 0),
    }));
}

const startsWithAny = (word: string, stems: readonly string[]) => stems.some((stem) => word.startsWith(stem));

export function aspectsOf(words: readonly string[]): AspectId[] {
  return ASPECTS.filter((aspect) => words.some((word) => startsWithAny(word, ASPECT_STEMS[aspect])));
}

/** The opinion in a clause: the sum of its opinion words, with negation and intensity; 0 when it holds none. */
export function polarityOf(words: readonly string[]): number {
  let score = 0;
  words.forEach((word, index) => {
    const direction = startsWithAny(word, POSITIVE) ? 1 : startsWithAny(word, NEGATIVE) ? -1 : 0;
    if (direction === 0) return;
    const before = words.slice(Math.max(0, index - 3), index);
    const negated = before.some((previous) => NEGATORS.has(previous));
    const intense = index > 0 && INTENSIFIERS.has(words[index - 1]!);
    score += direction * (negated ? -1 : 1) * (intense ? 1.5 : 1);
  });
  return score;
}

export function reviewInsights(reviews: readonly ReviewForInsights[]): ReviewInsights {
  const tally = new Map<string, { aspect: AspectId; polarity: "pro" | "con"; reviews: number; evidence: Evidence[] }>();
  for (const review of reviews) {
    const perAspect = new Map<AspectId, { score: number; sentences: string[] }>();
    for (const { sentence, clauses } of sentencesOf([review.title, review.body].filter((part) => part !== null && part !== "").join(". "))) {
      for (const words of clauses) {
        const aspects = aspectsOf(words);
        if (aspects.length === 0) continue;
        const opinion = polarityOf(words);
        const score = opinion !== 0 ? opinion : review.rating >= 4 ? 0.5 : review.rating <= 2 ? -0.5 : 0;
        for (const aspect of aspects) {
          const entry = perAspect.get(aspect) ?? { score: 0, sentences: [] };
          entry.score += score;
          if (score !== 0 && !entry.sentences.includes(sentence)) entry.sentences.push(sentence);
          perAspect.set(aspect, entry);
        }
      }
    }
    for (const [aspect, { score, sentences }] of perAspect) {
      if (score === 0) continue;
      const polarity = score > 0 ? "pro" : "con";
      const key = `${aspect}:${polarity}`;
      const point = tally.get(key) ?? { aspect, polarity, reviews: 0, evidence: [] };
      point.reviews += 1;
      if (point.evidence.length < MAX_EVIDENCE && sentences[0] !== undefined) point.evidence.push({ reviewId: review.id, author: review.authorName, sentence: sentences[0] });
      tally.set(key, point);
    }
  }
  const minimum = reviews.length < 5 ? 1 : 2;
  const points = [...tally.values()].filter((point) => point.reviews >= minimum).sort((a, b) => b.reviews - a.reviews || ASPECTS.indexOf(a.aspect) - ASPECTS.indexOf(b.aspect));
  return { reviewed: reviews.length, pros: points.filter((point) => point.polarity === "pro"), cons: points.filter((point) => point.polarity === "con") };
}
