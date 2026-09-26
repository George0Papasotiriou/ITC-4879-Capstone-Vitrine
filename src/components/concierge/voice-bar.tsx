"use client";

/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * The spoken part of the dock: the microphone, what the Concierge is doing, and the captions.
 */

import { useTranslations } from "next-intl";
import { useEffect, useRef, type RefObject } from "react";

import { useVoice } from "@/components/concierge/use-voice";
import { Button } from "@/components/ui/button";
import { useHydrated } from "@/components/ui/use-hydrated";
import { cn } from "@/lib/ui/cn";
import { prefersReducedMotion } from "@/lib/ui/use-reduced-motion";

/**
 * docs/adr/026. Three things are always on screen while voice is on: what the
 * Concierge is doing, what it heard, and a way to stop it. Captions are not a
 * setting — everything spoken is written, in the conversation above and in the
 * line below, because a shop where the only record of an answer is a sound is
 * a shop some people cannot use.
 */

/**
 * The presence light: the same four states the plan names (idle, listening,
 * thinking, speaking). Listening, it breathes slowly — the shop's one loop
 * (4.5, moment 3). In a live session it follows the voice instead: a ring that
 * swells with how loudly the shopper is speaking, so they can see they are
 * heard (docs/adr/031).
 */
const LIGHT: Record<string, string> = {
  idle: "bg-slate/40",
  listening: "bg-lumen animate-breathe",
  thinking: "bg-lumen/60",
  speaking: "bg-dusk",
};

/** Moves `ring` with the loudness of `stream`, frame by frame, outside React. */
function useVoiceLevel(stream: MediaStream | null, ring: RefObject<HTMLSpanElement | null>) {
  useEffect(() => {
    const element = ring.current;
    if (stream === null || element === null || prefersReducedMotion()) return;
    const context = new AudioContext();
    const analyser = context.createAnalyser();
    analyser.fftSize = 512;
    context.createMediaStreamSource(stream).connect(analyser);
    const samples = new Uint8Array(analyser.fftSize);
    let frame = 0;
    let level = 0;
    const draw = () => {
      analyser.getByteTimeDomainData(samples);
      // Root-mean-square of the waveform around its middle: 0 in silence, about 0.3 for a raised voice.
      let sum = 0;
      for (const sample of samples) sum += ((sample - 128) / 128) ** 2;
      const rms = Math.sqrt(sum / samples.length);
      // Quick to rise, slow to fall, so it reads as a voice rather than a flicker.
      level = Math.max(rms, level * 0.88);
      element.style.transform = `scale(${1 + Math.min(1, level * 4) * 1.4})`;
      element.style.opacity = String(0.25 + Math.min(1, level * 4) * 0.5);
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      element.style.transform = "";
      element.style.opacity = "";
      void context.close();
    };
  }, [stream, ring]);
}

export function VoiceBar() {
  const t = useTranslations("concierge.voice");
  const hydrated = useHydrated();
  const voice = useVoice();
  const on = voice.state !== "idle";
  const ring = useRef<HTMLSpanElement>(null);
  useVoiceLevel(voice.stream, ring);

  return (
    <div className="border-hairline flex flex-col gap-2 border-b px-5 py-3" data-agent-id="voice:bar">
      <div className="flex flex-wrap items-center gap-2">
        <span className="relative inline-flex size-2.5" aria-hidden="true">
          {voice.stream === null ? null : <span ref={ring} className="bg-lumen absolute inset-0 rounded-full opacity-0" data-agent-id="voice:level" />}
          <span className={cn("relative size-2.5 rounded-full transition-colors duration-quick", voice.stream === null ? LIGHT[voice.state] : voice.state === "listening" ? "bg-lumen" : LIGHT[voice.state])} />
        </span>
        <p className="text-sm" data-agent-id="voice:state">
          {t(`states.${voice.state}`)}
        </p>
        {voice.live === null ? null : (
          <span className="text-slate text-xs" data-agent-id="voice:live">
            {t("live", { provider: t(`providers.${voice.live}`) })}
          </span>
        )}
        <span className="flex-1" />

        {!on ? (
          <Button size="sm" variant="secondary" disabled={!hydrated} onClick={voice.start} data-agent-id="voice:start">
            {t("speak")}
          </Button>
        ) : (
          <Button size="sm" variant="tertiary" onClick={voice.stop} data-agent-id="voice:stop">
            {t("stop")}
          </Button>
        )}
      </div>

      {!on ? null : (
        <div className="flex flex-wrap items-center gap-2">
          {/* Hands-free hears a pause as the end of a sentence; hold-to-talk is for a noisy room. */}
          <div className="border-hairline rounded-plinth flex overflow-hidden border text-xs" role="group" aria-label={t("modeLabel")}>
            {(["hands-free", "hold"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                aria-pressed={voice.mode === mode}
                onClick={() => voice.setMode(mode)}
                className={cn("px-3 py-1.5 transition-colors", voice.mode === mode ? "bg-dusk text-glass" : "hover:bg-plinth bg-white")}
                data-agent-id={`voice:mode:${mode}`}
              >
                {t(`modes.${mode}`)}
              </button>
            ))}
          </div>

          {voice.mode === "hold" ? (
            <Button
              size="sm"
              onPointerDown={voice.hold}
              onPointerUp={voice.release}
              onPointerLeave={() => voice.state === "listening" && voice.release()}
              data-agent-id="voice:hold"
            >
              {t("holdToTalk")}
            </Button>
          ) : null}
        </div>
      )}

      {/* Before live voice sends anything the first time, the shopper reads where it goes (docs/adr/030). */}
      {voice.notice === null ? null : (
        <div className="border-hairline rounded-plinth bg-plinth flex flex-col gap-2 border p-3" role="group" aria-labelledby="voice-notice-title" data-agent-id="voice:notice">
          <p id="voice-notice-title" className="text-sm font-medium">
            {t("notice.title")}
          </p>
          <p className="text-slate text-sm">{t("notice.body", { provider: t(`providers.${voice.notice}`) })}</p>
          <div className="flex gap-2">
            <Button size="sm" onClick={voice.acceptNotice} data-agent-id="voice:notice:accept">
              {t("notice.accept")}
            </Button>
            <Button size="sm" variant="secondary" onClick={voice.declineNotice} data-agent-id="voice:notice:decline">
              {t("notice.decline")}
            </Button>
          </div>
        </div>
      )}

      {voice.heard === "" ? null : (
        <p className="text-slate text-sm" aria-live="polite" data-agent-id="voice:caption">
          <span className="sr-only">{t("captionsLabel")} </span>
          {voice.heard}
        </p>
      )}

      {voice.problem === null ? null : (
        <p role="alert" className="text-danger text-sm" data-agent-id="voice:problem">
          {t.has(`errors.${voice.problem}`) ? t(`errors.${voice.problem}`) : t("errors.generic")}
        </p>
      )}

      {on || voice.available ? null : (
        <p className="text-slate text-xs" data-agent-id="voice:unsupported">
          {t("errors.unsupported")}
        </p>
      )}
    </div>
  );
}
