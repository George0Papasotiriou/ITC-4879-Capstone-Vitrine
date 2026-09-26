"use client";

/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Listen: a passage read aloud by the browser's own voice, with the sentence being read highlighted.
 */

import { useLocale, useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { useHydrated } from "@/components/ui/use-hydrated";
import { sentenceRanges } from "@/lib/comfort/sentences";
import { voiceLocale } from "@/lib/ai/surfaces/voice/session";

/**
 * docs/adr/032. For someone who reads slowly, or not at all, and for anyone
 * whose eyes are tired: the browser reads the passage in the page's language,
 * a sentence at a time, and the sentence being read is highlighted in place
 * (the CSS Custom Highlight API, so the page itself is not changed). Free: the
 * browser's own speech, the same the keyless Concierge uses. Where the browser
 * cannot speak, the button is not shown.
 */

const HIGHLIGHT = "vitrine-reading";

type Highlights = { set: (name: string, highlight: unknown) => void; delete: (name: string) => void };
type HighlightConstructor = new (...ranges: Range[]) => unknown;

function highlights(): { registry: Highlights; Highlight: HighlightConstructor } | null {
  const registry = (CSS as unknown as { highlights?: Highlights }).highlights;
  const Highlight = (window as unknown as { Highlight?: HighlightConstructor }).Highlight;
  return registry === undefined || Highlight === undefined ? null : { registry, Highlight };
}

/**
 * `targets` are element ids, read in order. Each is read in its own language
 * (the nearest `lang`), so English copy on a Greek page is read in English.
 */
export function ListenButton({ targets, className }: { targets: readonly string[]; className?: string }) {
  const t = useTranslations("comfort.listen");
  const locale = useLocale();
  const hydrated = useHydrated();
  const [reading, setReading] = useState(false);
  const run = useRef(0);

  useEffect(
    () => () => {
      window.speechSynthesis?.cancel();
      highlights()?.registry.delete(HIGHLIGHT);
    },
    [],
  );

  if (!hydrated || !("speechSynthesis" in window)) return null;

  const stop = () => {
    run.current += 1;
    window.speechSynthesis.cancel();
    highlights()?.registry.delete(HIGHLIGHT);
    setReading(false);
  };

  const read = () => {
    const sentences = targets.flatMap((id) => {
      const container = document.getElementById(id);
      if (container === null) return [];
      const lang = container.closest("[lang]")?.getAttribute("lang") ?? locale;
      return sentenceRanges(container).map((sentence) => ({ ...sentence, lang }));
    });
    if (sentences.length === 0) return;
    const current = ++run.current;
    const marks = highlights();
    setReading(true);
    window.speechSynthesis.cancel();

    const speak = (index: number) => {
      if (current !== run.current) return;
      const sentence = sentences[index];
      if (sentence === undefined) {
        marks?.registry.delete(HIGHLIGHT);
        setReading(false);
        return;
      }
      if (marks !== null) marks.registry.set(HIGHLIGHT, new marks.Highlight(sentence.range));
      const utterance = new SpeechSynthesisUtterance(sentence.text);
      utterance.lang = voiceLocale(sentence.lang.slice(0, 2));
      utterance.onend = () => speak(index + 1);
      utterance.onerror = () => {
        if (current === run.current) stop();
      };
      window.speechSynthesis.speak(utterance);
    };
    speak(0);
  };

  return (
    <Button variant="secondary" size="sm" className={className} onClick={reading ? stop : read} data-agent-id={`listen:${targets[0] ?? ""}`}>
      <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
        {reading ? <path d="M7 6h3v12H7zM14 6h3v12h-3z" strokeLinejoin="round" /> : <path d="M4 9v6h4l5 4V5L8 9H4zM16 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11" strokeLinecap="round" strokeLinejoin="round" />}
      </svg>
      {reading ? t("stop") : t("start")}
    </Button>
  );
}
