"use client";

/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Search by photo: give the shop a picture, see what it saw, and what it has like it.
 */

import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";

import type { PhotoResponse, PhotoView } from "@/app/api/photos/route";
import type { SnapResponse } from "@/app/api/snap/route";
import { ProductCards } from "@/components/concierge/concierge-parts";
import { Button } from "@/components/ui/button";
import { SmartLink } from "@/components/ui/smart-link";
import { useHydrated } from "@/components/ui/use-hydrated";
import type { ProductBrief } from "@/lib/ai/tools/briefs";
import { ACCEPTED_TYPES, MAX_UPLOAD_BYTES } from "@/lib/photos/photos";

/**
 * The same photograph rules as the Fitting Room (docs/adr/023): consent, a
 * day, "delete now". What is different is what happens to it — it is measured,
 * not sent anywhere (docs/adr/024) — and the page says which colours it found,
 * so the results are never a mystery.
 */

export type SnapSeen = { color: string; label: string; share: number };

export function SnapToShop({ colourLabels }: { colourLabels: Record<string, string> }) {
  const t = useTranslations("snap");
  const locale = useLocale();
  const hydrated = useHydrated();
  const [consent, setConsent] = useState(false);
  const [photo, setPhoto] = useState<PhotoView | null>(null);
  const [saw, setSaw] = useState<SnapSeen[]>([]);
  const [found, setFound] = useState<ProductBrief[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const search = async (photoId: string) => {
    const response = await fetch("/api/snap", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ photoId, locale }),
    }).catch(() => null);
    const result = (await response?.json().catch(() => null)) as SnapResponse | null;
    if (result === null || !result.ok) {
      setError(t("errors.failed"));
      return;
    }
    setSaw(result.saw.map((entry) => ({ ...entry, label: colourLabels[entry.color] ?? entry.color })));
    setFound(result.products);
  };

  const upload = async (chosen: File) => {
    if (!consent) {
      setError(t("errors.no_consent"));
      return;
    }
    if (chosen.size > MAX_UPLOAD_BYTES) {
      setError(t("errors.too_large"));
      return;
    }
    setBusy(true);
    const form = new FormData();
    form.set("file", chosen);
    form.set("kind", "snap");
    form.set("consent", "yes");
    const response = await fetch("/api/photos", { method: "POST", body: form }).catch(() => null);
    const result = (await response?.json().catch(() => null)) as PhotoResponse | null;
    if (result === null || !result.ok || !("photo" in result)) {
      setBusy(false);
      const reason = result !== null && "reason" in result ? result.reason : "failed";
      setError(t.has(`errors.${reason}`) ? t(`errors.${reason}`) : t("errors.failed"));
      return;
    }
    setError(null);
    setPhoto(result.photo);
    await search(result.photo.id);
    setBusy(false);
  };

  return (
    <div className="mt-8 flex flex-col gap-5" data-agent-id="snap:form">
      <label className="flex max-w-[65ch] items-start gap-3 text-sm">
        {/* Inert until the page wakes up, so a tick always counts (docs/adr/023). */}
        <input
          type="checkbox"
          checked={consent}
          disabled={!hydrated}
          onChange={(event) => setConsent(event.target.checked)}
          className="border-hairline mt-1 size-4 rounded-sm border"
          data-agent-id="snap:consent"
        />
        <span>{t("consent")}</span>
      </label>

      <div className="flex flex-wrap items-center gap-3" hidden={!consent}>
        <label htmlFor="snap-file" className="text-sm font-medium">
          {t("choosePhoto")}
        </label>
        <input
          id="snap-file"
          type="file"
          accept={ACCEPTED_TYPES.join(",")}
          capture="environment"
          disabled={!hydrated}
          onChange={(event) => {
            const chosen = event.target.files?.[0];
            if (chosen !== undefined) void upload(chosen);
          }}
          className="text-dusk text-sm file:border-hairline file:rounded-plinth file:text-dusk file:mr-3 file:border file:bg-white file:px-4 file:py-2 file:text-sm"
          data-agent-id="snap:file"
        />
        {busy ? <span className="text-slate text-sm">{t("looking")}</span> : null}
      </div>

      {photo === null ? null : (
        <div className="flex flex-wrap items-start gap-6">
          <div className="bg-plinth rounded-plinth w-[180px] overflow-hidden">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={photo.url} alt={t("yourPhotoAlt")} className="h-auto w-full" data-agent-id="snap:photo" />
          </div>
          {saw.length === 0 ? null : (
            <div className="flex flex-col gap-2" data-agent-id="snap:saw">
              <p className="text-sm font-medium">{t("sawTitle")}</p>
              <ul className="flex flex-wrap gap-2">
                {saw.map((entry) => (
                  <li key={entry.color} className="border-hairline rounded-plinth flex items-center gap-2 border px-3 py-1 text-sm">
                    {entry.label} · {Math.round(entry.share * 100)}%
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {error === null ? null : (
        <p role="alert" className="text-danger text-sm" data-agent-id="snap:error">
          {error}
        </p>
      )}

      {/* The results stay on this page, beside the colours that found them: a
          shopper who disagrees with the reading can see both at once. */}
      {found === null ? null : (
        <section aria-labelledby="snap-results" className="flex flex-col gap-4">
          <h2 id="snap-results" className="font-display text-xl">
            {t("resultsTitle")}
          </h2>
          {found.length === 0 ? (
            <p className="text-slate text-sm" data-agent-id="snap:nothing">
              {t("nothing")}
            </p>
          ) : (
            <>
              <div data-agent-id="snap:results">
                <ProductCards products={found} />
              </div>
              <p className="text-sm">
                <SmartLink href={`/search?q=${encodeURIComponent(saw.map((entry) => entry.label).join(" "))}`} className="underline underline-offset-4" data-agent-id="snap:refine">
                  {t("refine")}
                </SmartLink>
              </p>
            </>
          )}
        </section>
      )}

      {photo === null ? null : (
        <div>
          <Button
            variant="tertiary"
            disabled={!hydrated}
            onClick={() => {
              void fetch(`/api/photos/${photo.id}`, { method: "DELETE" }).then(() => {
                setPhoto(null);
                setSaw([]);
                setFound(null);
              });
            }}
            data-agent-id="action:delete-snap"
          >
            {t("deleteNow")}
          </Button>
        </div>
      )}
    </div>
  );
}
