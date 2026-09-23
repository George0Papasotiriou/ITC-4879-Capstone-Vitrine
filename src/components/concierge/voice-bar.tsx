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

import { useVoice } from "@/components/concierge/use-voice";
import { Button } from "@/components/ui/button";
import { useHydrated } from "@/components/ui/use-hydrated";
import { cn } from "@/lib/ui/cn";

/**
 * docs/adr/026. Three things are always on screen while voice is on: what the
 * Concierge is doing, what it heard, and a way to stop it. Captions are not a
 * setting — everything spoken is written, in the conversation above and in the
 * line below, because a shop where the only record of an answer is a sound is
 * a shop some people cannot use.
 */

/** The presence light: the same four states the plan names (idle, listening, thinking, speaking). */
const LIGHT: Record<string, string> = {
  idle: "bg-slate/40",
  listening: "bg-lumen animate-pulse",
  thinking: "bg-lumen/60",
  speaking: "bg-dusk",
};

export function VoiceBar() {
  const t = useTranslations("concierge.voice");
  const hydrated = useHydrated();
  const voice = useVoice();
  const on = voice.state !== "idle";

  return (
    <div className="border-hairline flex flex-col gap-2 border-b px-5 py-3" data-agent-id="voice:bar">
      <div className="flex flex-wrap items-center gap-2">
        <span className={cn("size-2.5 rounded-full", LIGHT[voice.state])} aria-hidden="true" />
        <p className="text-sm" data-agent-id="voice:state">
          {t(`states.${voice.state}`)}
        </p>
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
