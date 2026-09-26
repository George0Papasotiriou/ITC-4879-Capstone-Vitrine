/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * A passage split into sentences for reading aloud, and each sentence found again in the page to highlight it.
 */

/**
 * docs/adr/032. Reading aloud a sentence at a time keeps the highlighted
 * sentence and the spoken one together, and lets a long passage be stopped
 * between sentences. English and Greek end sentences with . ! ? and Greek also
 * with ; (its question mark). Abbreviations with a full stop ("cm.", "e.g.")
 * would split a sentence early; product copy rarely has them, so the simple
 * rule stands, and a sentence is never shorter than a few letters.
 */

export type SentenceSpan = { start: number; end: number; text: string };

/** Where each sentence starts and ends in `text`, whitespace trimmed. */
export function sentenceSpans(text: string): SentenceSpan[] {
  const spans: SentenceSpan[] = [];
  const ending = /[.!?;·…]+["'»”)\]]*(?=\s|$)|\n{2,}/g;
  let from = 0;
  const push = (start: number, end: number) => {
    const raw = text.slice(start, end);
    const lead = raw.length - raw.trimStart().length;
    const trimmed = raw.trim();
    if (trimmed.replace(/[^\p{L}\p{N}]/gu, "").length < 2) return;
    spans.push({ start: start + lead, end: start + lead + trimmed.length, text: trimmed.replace(/\s+/g, " ") });
  };
  for (const match of text.matchAll(ending)) {
    const end = match.index + match[0].length;
    push(from, end);
    from = end;
  }
  push(from, text.length);
  return spans;
}

/** The sentences of an element, each with a DOM range covering it (it may cross inline elements). */
export function sentenceRanges(container: Element): { text: string; range: Range }[] {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const nodes: { node: Text; start: number }[] = [];
  let text = "";
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    // Text a person cannot see is not read out.
    if ((node.parentElement?.closest("[aria-hidden='true'], .sr-only, script, style") ?? null) !== null) continue;
    nodes.push({ node: node as Text, start: text.length });
    text += node.textContent ?? "";
  }
  const locate = (offset: number): { node: Text; offset: number } | null => {
    for (let index = nodes.length - 1; index >= 0; index -= 1) {
      const entry = nodes[index]!;
      if (offset >= entry.start) return { node: entry.node, offset: Math.min(offset - entry.start, entry.node.length) };
    }
    return null;
  };
  return sentenceSpans(text).flatMap((span) => {
    const start = locate(span.start);
    const end = locate(span.end);
    if (start === null || end === null) return [];
    const range = document.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
    return [{ text: span.text, range }];
  });
}
