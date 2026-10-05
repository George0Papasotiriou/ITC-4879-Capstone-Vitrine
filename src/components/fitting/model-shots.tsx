"use client";

/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * "On a model like you": pick the model closest to you and see the piece worn — made once, then free for everyone.
 */

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";

import type { ModelShotsResponse } from "@/app/api/model-shots/route";
import { Button } from "@/components/ui/button";
import { useHydrated } from "@/components/ui/use-hydrated";
import { CREDIT_COSTS } from "@/lib/ai/usage";
import { MODEL_PRESETS, type ModelPreset } from "@/lib/fitting/presets";
import type { ModelShotView } from "@/lib/fitting/server";
import { cn } from "@/lib/ui/cn";

/**
 * docs/adr/063. Four models to pick from — build and skin tone, no face of
 * the shopper's — and FASHN's Product to Model puts the piece on the one
 * picked. A shot someone already had made shows at once, for nothing; the
 * first shopper to ask pays once. Every shot is labelled an AI picture.
 */

/** The shots a piece has, and whether new ones can be made; null when the shop cannot be reached. */
async function fetchShots(slug: string): Promise<{ shots: ModelShotView[]; available: boolean } | null> {
  const response = await fetch(`/api/model-shots?product=${encodeURIComponent(slug)}`, { cache: "no-store" }).catch(() => null);
  const result = (await response?.json().catch(() => null)) as ModelShotsResponse | null;
  return result !== null && result.ok && "shots" in result ? { shots: result.shots, available: result.available } : null;
}

const POLL_MS = 2_000;
const POLL_FOR_MS = 3 * 60_000;

export function ModelShots({ slug, title, department }: { slug: string; title: string; department: "women" | "men" | null }) {
  const t = useTranslations("product.modelShots");
  const hydrated = useHydrated();
  const [shots, setShots] = useState<ModelShotView[]>([]);
  const [available, setAvailable] = useState(false);
  const [chosen, setChosen] = useState<ModelPreset>(MODEL_PRESETS[0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    (cancelled?: () => boolean) =>
      void fetchShots(slug).then((result) => {
        if (result === null || cancelled?.() === true) return;
        setShots(result.shots);
        setAvailable(result.available);
      }),
    [slug],
  );

  useEffect(() => {
    let cancelled = false;
    load(() => cancelled);
    return () => {
      cancelled = true;
    };
  }, [load]);

  const shot = shots.find((entry) => entry.preset === chosen) ?? null;
  const making = shot !== null && (shot.status === "queued" || shot.status === "running");
  useEffect(() => {
    if (!making) return;
    const started = Date.now();
    const timer = window.setInterval(() => {
      if (Date.now() - started > POLL_FOR_MS) window.clearInterval(timer);
      else load();
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [making, load]);

  // Without the service nothing can be made, and nothing has been: the panel stays away.
  if (!available && shots.every((entry) => entry.status !== "done")) return null;

  const make = async () => {
    setBusy(true);
    const response = await fetch("/api/model-shots", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ productSlug: slug, preset: chosen }) }).catch(() => null);
    const result = (await response?.json().catch(() => null)) as ModelShotsResponse | null;
    setBusy(false);
    if (result === null || !result.ok || !("shot" in result)) {
      const reason = result !== null && "reason" in result ? result.reason : "failed";
      setError(t.has(`errors.${reason}`) ? t(`errors.${reason}`) : t("errors.failed"));
      return;
    }
    setError(null);
    setShots((current) => [...current.filter((entry) => entry.preset !== chosen), result.shot]);
  };

  const label = (preset: ModelPreset) => t(`presets.${preset}.${department === "men" ? "men" : "women"}`);

  return (
    <section aria-labelledby="model-shots-heading" className="border-hairline mt-16 border-t pt-10" data-agent-id="product:model-shots">
      <h2 id="model-shots-heading" className="font-display text-2xl">
        {t("title")}
      </h2>
      <p className="text-slate mt-2 max-w-[65ch] text-sm">{t("lede")}</p>
      <div className="mt-6 grid gap-8 md:grid-cols-[minmax(0,28rem)_minmax(0,20rem)]">
        <div className="bg-plinth rounded-plinth relative flex aspect-[3/4] max-w-md items-center justify-center overflow-hidden" data-agent-id="model-shots:stage">
          {shot?.status === "done" && shot.url !== null ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={shot.url} alt={t("alt", { title, model: label(chosen) })} className="h-full w-full object-cover" data-agent-id="model-shots:image" />
              <span className="bg-glass/90 text-dusk absolute right-3 bottom-3 rounded-full px-3 py-1 text-xs">{t("aiLabel")}</span>
            </>
          ) : (
            <p className="text-slate p-6 text-center text-sm" role="status">
              {making ? t("making") : shot?.status === "failed" ? t("failed") : t("none")}
            </p>
          )}
        </div>
        <div className="flex flex-col gap-4">
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-sm font-medium">{t("pick")}</legend>
            {MODEL_PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                aria-pressed={chosen === preset}
                disabled={!hydrated}
                onClick={() => {
                  setChosen(preset);
                  setError(null);
                }}
                className={cn("rounded-plinth press min-h-11 cursor-pointer border px-4 py-2 text-left text-sm", chosen === preset ? "bg-dusk text-glass border-dusk" : "border-hairline text-dusk hover:border-dusk/35")}
                data-agent-id={`model-shots:preset:${preset}`}
              >
                {label(preset)}
              </button>
            ))}
          </fieldset>
          {shot?.status === "done" || making ? null : available ? (
            <div className="flex flex-col gap-2">
              <Button disabled={!hydrated} aria-disabled={busy} onClick={() => void make()} data-agent-id="action:make-model-shot">
                {busy ? t("asking") : t("make")}
              </Button>
              <p className="text-slate text-xs">{t("cost", { credits: CREDIT_COSTS.model_shot })}</p>
            </div>
          ) : null}
          {error === null ? null : (
            <p role="alert" className="text-danger text-sm" data-agent-id="model-shots:error">
              {error}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
