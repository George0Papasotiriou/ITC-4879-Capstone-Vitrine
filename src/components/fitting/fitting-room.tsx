"use client";

/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * The Fitting Room: giving the shop a photograph, trying pieces on it, and deleting it when you are done.
 */

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";

import type { PhotoResponse, PhotoView } from "@/app/api/photos/route";
import type { TryOnResponse, TryOnView } from "@/app/api/try-on/route";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { useHydrated } from "@/components/ui/use-hydrated";
import { ACCEPTED_TYPES, MAX_UPLOAD_BYTES } from "@/lib/photos/photos";

/**
 * The privacy promise is the feature (docs/adr/023): the photograph is given
 * for one purpose, kept for a day, deletable at any moment, and never shown to
 * anyone else. So the page says all of that before it asks for anything, the
 * consent box is unticked, and the count-down is on screen the whole time.
 *
 * Without a paid key the result is a composition of the piece over the
 * photograph rather than a fitting, and every result says which it is.
 */

export type TryOnPiece = { slug: string; title: string; image: string | null; kindLabel: string | null };

/** What the shop is holding for this shopper right now: the photograph and its try-ons. */
async function currentState(): Promise<{ photo: PhotoView | null; tryOns: TryOnView[] }> {
  const [photos, tryOns] = await Promise.all([
    fetch("/api/photos", { cache: "no-store" })
      .then((response) => response.json() as Promise<PhotoResponse>)
      .catch(() => null),
    fetch("/api/try-on", { cache: "no-store" })
      .then((response) => response.json() as Promise<TryOnResponse>)
      .catch(() => null),
  ]);
  return {
    photo: photos !== null && photos.ok && "photos" in photos ? (photos.photos.find((entry) => entry.kind === "try_on") ?? null) : null,
    tryOns: tryOns !== null && tryOns.ok && "tryOns" in tryOns ? tryOns.tryOns : [],
  };
}

const POLL_MS = 2_000;
const POLL_FOR_MS = 90_000;

export function FittingRoom({ pieces }: { pieces: readonly TryOnPiece[] }) {
  const t = useTranslations("fitting");
  const toast = useToast();
  const hydrated = useHydrated();
  const file = useRef<HTMLInputElement>(null);
  const [consent, setConsent] = useState(false);
  const [photo, setPhoto] = useState<PhotoView | null>(null);
  const [tryOns, setTryOns] = useState<TryOnView[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback((cancelled?: () => boolean) => {
    void currentState().then((state) => {
      if (cancelled?.() === true) return;
      setPhoto(state.photo);
      setTryOns(state.tryOns);
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    load(() => cancelled);
    return () => {
      cancelled = true;
    };
  }, [load]);

  // While something is being made, ask how it is getting on — and stop asking.
  const waiting = tryOns.some((tryOn) => tryOn.status === "queued" || tryOn.status === "running");
  useEffect(() => {
    if (!waiting) return;
    let cancelled = false;
    const started = Date.now();
    const timer = window.setInterval(() => {
      if (Date.now() - started > POLL_FOR_MS) {
        window.clearInterval(timer);
        return;
      }
      load(() => cancelled);
    }, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [waiting, load]);

  const upload = async (chosen: File) => {
    if (!consent) {
      setError(t("errors.no_consent"));
      return;
    }
    if (chosen.size > MAX_UPLOAD_BYTES) {
      setError(t("errors.too_large"));
      return;
    }
    setBusy("upload");
    const form = new FormData();
    form.set("file", chosen);
    form.set("kind", "try_on");
    form.set("consent", "yes");
    const response = await fetch("/api/photos", { method: "POST", body: form }).catch(() => null);
    const result = (await response?.json().catch(() => null)) as PhotoResponse | null;
    setBusy(null);
    if (result === null || !result.ok || !("photo" in result)) {
      const reason = result !== null && "reason" in result ? result.reason : "failed";
      setError(t.has(`errors.${reason}`) ? t(`errors.${reason}`) : t("errors.failed"));
      return;
    }
    setError(null);
    setPhoto(result.photo);
    toast({ title: t("uploaded"), tone: "success" });
  };

  const remove = async () => {
    if (photo === null) return;
    setBusy("delete");
    const response = await fetch(`/api/photos/${photo.id}`, { method: "DELETE" }).catch(() => null);
    setBusy(null);
    if (response?.ok !== true) {
      setError(t("errors.failed"));
      return;
    }
    setPhoto(null);
    setTryOns([]);
    if (file.current !== null) file.current.value = "";
    toast({ title: t("deleted"), tone: "success" });
  };

  const tryOn = async (piece: TryOnPiece) => {
    if (photo === null) return;
    setBusy(piece.slug);
    const response = await fetch("/api/try-on", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ photoId: photo.id, productSlug: piece.slug }),
    }).catch(() => null);
    const result = (await response?.json().catch(() => null)) as TryOnResponse | null;
    setBusy(null);
    if (result === null || !result.ok || !("tryOn" in result)) {
      const reason = result !== null && "reason" in result ? result.reason : "failed";
      setError(t.has(`errors.${reason}`) ? t(`errors.${reason}`) : t("errors.failed"));
      return;
    }
    setError(null);
    setTryOns((current) => [result.tryOn, ...current]);
  };

  return (
    <div className="mt-10 flex flex-col gap-10" data-agent-id="fitting:room">
      <section aria-labelledby="your-photo" className="flex flex-col gap-4">
        <h2 id="your-photo" className="font-display text-xl">
          {t("photoTitle")}
        </h2>

        {photo === null ? (
          <>
            <p className="text-slate max-w-[65ch] text-sm">{t("photoLede")}</p>
            <label className="flex max-w-[65ch] items-start gap-3 text-sm">
              <input
                type="checkbox"
                checked={consent}
                onChange={(event) => setConsent(event.target.checked)}
                className="border-hairline mt-1 size-4 rounded-sm border"
                data-agent-id="fitting:consent"
              />
              <span>{t("consent")}</span>
            </label>
            {/* The file input appears once consent is given: nothing disabled and greyed, and no way to choose a photograph before agreeing. */}
            <div className="flex flex-wrap items-center gap-3" hidden={!consent}>
              <label htmlFor="fitting-file" className="text-sm font-medium">
                {t("choosePhoto")}
              </label>
              <input
                id="fitting-file"
                ref={file}
                type="file"
                accept={ACCEPTED_TYPES.join(",")}
                disabled={!hydrated}
                onChange={(event) => {
                  const chosen = event.target.files?.[0];
                  if (chosen !== undefined) void upload(chosen);
                }}
                className="text-dusk text-sm file:border-hairline file:rounded-plinth file:text-dusk file:mr-3 file:border file:bg-white file:px-4 file:py-2 file:text-sm"
                data-agent-id="fitting:file"
              />
              {busy === "upload" ? <span className="text-slate text-sm">{t("uploading")}</span> : null}
            </div>
          </>
        ) : (
          <div className="flex flex-wrap items-start gap-6">
            <div className="bg-plinth rounded-plinth relative w-[220px] overflow-hidden">
              {/* The shopper's own photograph, from a link that expires: never a public URL. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photo.url} alt={t("yourPhotoAlt")} width={photo.width ?? 220} height={photo.height ?? 293} className="h-auto w-full" data-agent-id="fitting:photo" />
            </div>
            <div className="flex flex-col gap-3">
              <p className="text-slate text-sm" data-agent-id="fitting:countdown">
                {t("countdown", { minutes: photo.minutesLeft })}
              </p>
              <Button variant="tertiary" disabled={!hydrated} aria-disabled={busy !== null} onClick={() => void remove()} data-agent-id="action:delete-photo">
                {t("deleteNow")}
              </Button>
            </div>
          </div>
        )}

        {error === null ? null : (
          <p role="alert" className="text-danger text-sm" data-agent-id="fitting:error">
            {error}
          </p>
        )}
      </section>

      <section aria-labelledby="pieces" className="flex flex-col gap-4">
        <h2 id="pieces" className="font-display text-xl">
          {t("piecesTitle")}
        </h2>
        <p className="text-slate max-w-[65ch] text-sm">{photo === null ? t("piecesLocked") : t("piecesLede")}</p>
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4" data-agent-id="fitting:pieces">
          {pieces.map((piece) => (
            {/* No fading while it is locked: dimmed text falls below the contrast the shop keeps. */}
            <li key={piece.slug} className="border-hairline rounded-plinth flex flex-col gap-2 border p-3">
              <span className="bg-plinth rounded-plinth relative aspect-square overflow-hidden">
                {piece.image === null ? null : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={piece.image} alt="" width={300} height={300} className="h-full w-full object-contain mix-blend-multiply" />
                )}
              </span>
              <span className="text-sm">{piece.title}</span>
              <Button
                variant="tertiary"
                disabled={!hydrated || photo === null}
                aria-disabled={busy !== null}
                onClick={() => void tryOn(piece)}
                data-agent-id={`action:try-on:${piece.slug}`}
              >
                {busy === piece.slug ? t("asking") : t("tryIt")}
              </Button>
            </li>
          ))}
        </ul>
      </section>

      {tryOns.length === 0 ? null : (
        <section aria-labelledby="results" className="flex flex-col gap-4">
          <h2 id="results" className="font-display text-xl">
            {t("resultsTitle")}
          </h2>
          <p className="text-slate max-w-[65ch] text-sm">{tryOns[0]?.drawn === true ? t("drawnNote") : t("resultsLede")}</p>
          <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3" data-agent-id="fitting:results">
            {tryOns.map((result) => (
              <li key={result.id} className="border-hairline rounded-plinth flex flex-col gap-2 border p-3" data-agent-id={`fitting:result:${result.status}`}>
                <span className="bg-plinth rounded-plinth relative flex aspect-[3/4] items-center justify-center overflow-hidden">
                  {result.url === null ? (
                    <span className="text-slate p-3 text-center text-sm">{result.status === "failed" ? t("failed") : t("making")}</span>
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={result.url} alt={t("resultAlt")} className="h-full w-full object-contain" />
                  )}
                </span>
                <span className="text-slate text-xs">{result.drawn ? t("drawnLabel") : t("tryOnLabel")}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
