"use client";

/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * The Fitting Room: giving the shop a photograph, trying pieces and whole outfits on it, seeing a try-on move, and deleting it all when you are done.
 */

import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { PhotoResponse, PhotoView } from "@/app/api/photos/route";
import type { VideoResponse } from "@/app/api/try-on/[id]/video/route";
import type { TryOnResponse, TryOnView } from "@/app/api/try-on/route";
import { Button, ButtonLink } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { useHydrated } from "@/components/ui/use-hydrated";
import { CREDIT_COSTS } from "@/lib/ai/usage";
import { MAX_OUTFIT, planOutfit, slotOf } from "@/lib/fitting/engines";
import { ACCEPTED_TYPES, MAX_UPLOAD_BYTES } from "@/lib/photos/photos";
import { cn } from "@/lib/ui/cn";

/**
 * The privacy promise is the feature (docs/adr/023): the photograph is given
 * for one purpose, kept for a day, deletable at any moment, and never shown to
 * anyone else. So the page says all of that before it asks for anything, the
 * consent box is unticked, and the count-down is on screen the whole time.
 *
 * docs/adr/063: clothes, shoes, bags and accessories can all be tried on, one
 * at a time or as an outfit of up to four put on in dressing order; a
 * finished try-on can be made to move for five seconds. Without the service's
 * key the result is the photograph beside the piece, and says so.
 */

export type TryOnPiece = { slug: string; title: string; image: string | null; kind: string };
export type TryOnGroup = { id: string; title: string; pieces: TryOnPiece[] };

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
/** A video can take a few minutes; the page keeps asking that long. */
const POLL_FOR_MS = 5 * 60_000;

/** What the results show: a single try-on, or an outfit as its last finished step with its progress. */
type Shown = { key: string; view: TryOnView; outfit: { count: number; done: number; failed: boolean } | null };

function shownResults(tryOns: readonly TryOnView[]): Shown[] {
  const shown: Shown[] = [];
  const outfits = new Map<string, TryOnView[]>();
  for (const tryOn of tryOns) {
    if (tryOn.outfitId === null) {
      shown.push({ key: tryOn.id, view: tryOn, outfit: null });
      continue;
    }
    const steps = outfits.get(tryOn.outfitId) ?? [];
    if (steps.length === 0) shown.push({ key: tryOn.outfitId, view: tryOn, outfit: null });
    steps.push(tryOn);
    outfits.set(tryOn.outfitId, steps);
  }
  return shown.map((entry) => {
    const steps = entry.view.outfitId === null ? null : outfits.get(entry.view.outfitId)!;
    if (steps === null) return entry;
    const ordered = [...steps].sort((a, b) => (a.outfitPosition ?? 0) - (b.outfitPosition ?? 0));
    const done = ordered.filter((step) => step.status === "done").length;
    const failed = ordered.some((step) => step.status === "failed");
    // The outfit is its last step: the picture with every piece on.
    return { key: entry.key, view: ordered.at(-1)!, outfit: { count: ordered.length, done, failed } };
  });
}

export function FittingRoom({ groups, focus, signedIn, canMove }: { groups: readonly TryOnGroup[]; focus: string | null; signedIn: boolean; canMove: boolean }) {
  const t = useTranslations("fitting");
  const locale = useLocale();
  const toast = useToast();
  const hydrated = useHydrated();
  const file = useRef<HTMLInputElement>(null);
  const [consent, setConsent] = useState(false);
  const [photo, setPhoto] = useState<PhotoView | null>(null);
  const [tryOns, setTryOns] = useState<TryOnView[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outfit, setOutfit] = useState<TryOnPiece[]>([]);

  // What the shopper has done since a request went out. An answer that left
  // before they gave a photograph describes a room they have already changed,
  // so it is dropped rather than painted over what is now on screen.
  const changes = useRef(0);

  const load = useCallback((cancelled?: () => boolean) => {
    const asked = changes.current;
    void currentState().then((state) => {
      if (cancelled?.() === true || changes.current !== asked) return;
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

  // While something is being made — a try-on, an outfit's next piece, a video — ask how it is getting on, and stop asking.
  const waiting = tryOns.some((tryOn) => tryOn.status === "queued" || tryOn.status === "running" || tryOn.video?.status === "queued" || tryOn.video?.status === "running");
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

  const fail = (reason: string, scope: "errors" | "outfit.errors" | "move.errors" = "errors") =>
    setError(t.has(`${scope}.${reason}`) ? t(`${scope}.${reason}`) : t.has(`errors.${reason}`) ? t(`errors.${reason}`) : t("errors.failed"));

  const upload = async (chosen: File) => {
    if (!consent) return fail("no_consent");
    if (chosen.size > MAX_UPLOAD_BYTES) return fail("too_large");
    setBusy("upload");
    const form = new FormData();
    form.set("file", chosen);
    form.set("kind", "try_on");
    form.set("consent", "yes");
    const response = await fetch("/api/photos", { method: "POST", body: form }).catch(() => null);
    const result = (await response?.json().catch(() => null)) as PhotoResponse | null;
    setBusy(null);
    if (result === null || !result.ok || !("photo" in result)) return fail(result !== null && "reason" in result ? result.reason : "failed");
    setError(null);
    changes.current += 1;
    setPhoto(result.photo);
    toast({ title: t("uploaded"), tone: "success" });
  };

  const remove = async () => {
    if (photo === null) return;
    setBusy("delete");
    const response = await fetch(`/api/photos/${photo.id}`, { method: "DELETE" }).catch(() => null);
    setBusy(null);
    if (response?.ok !== true) return fail("failed");
    changes.current += 1;
    setPhoto(null);
    setTryOns([]);
    setOutfit([]);
    if (file.current !== null) file.current.value = "";
    toast({ title: t("deleted"), tone: "success" });
  };

  const ask = async (body: Record<string, unknown>, busyKey: string, scope: "errors" | "outfit.errors") => {
    if (photo === null) return false;
    setBusy(busyKey);
    const response = await fetch("/api/try-on", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ photoId: photo.id, ...body }) }).catch(() => null);
    const result = (await response?.json().catch(() => null)) as TryOnResponse | null;
    setBusy(null);
    if (result === null || !result.ok) {
      fail(result !== null && "reason" in result ? result.reason : "failed", scope);
      return false;
    }
    setError(null);
    changes.current += 1;
    const added = "tryOn" in result ? [result.tryOn] : "outfit" in result ? result.outfit.steps : [];
    setTryOns((current) => [...added, ...current]);
    return true;
  };

  const tryOn = (piece: TryOnPiece) => void ask({ productSlug: piece.slug }, piece.slug, "errors");

  const plan = useMemo(() => planOutfit(outfit.map((piece) => ({ id: piece.slug, kind: piece.kind }))), [outfit]);
  const toggleOutfit = (piece: TryOnPiece) => {
    setError(null);
    setOutfit((current) => (current.some((entry) => entry.slug === piece.slug) ? current.filter((entry) => entry.slug !== piece.slug) : current.length >= MAX_OUTFIT ? current : [...current, piece]));
  };
  const tryOutfit = async () => {
    if (!plan.ok) return fail(plan.reason, "outfit.errors");
    if (await ask({ productSlugs: plan.pieces.map((piece) => piece.id) }, "outfit", "outfit.errors")) setOutfit([]);
  };

  const move = async (view: TryOnView) => {
    setBusy(`move:${view.id}`);
    const response = await fetch(`/api/try-on/${view.id}/video`, { method: "POST" }).catch(() => null);
    const result = (await response?.json().catch(() => null)) as VideoResponse | null;
    setBusy(null);
    if (result === null || !result.ok) return fail(result !== null && "reason" in result ? result.reason : "failed", "move.errors");
    setError(null);
    changes.current += 1;
    setTryOns((current) => current.map((entry) => (entry.id === view.id ? { ...entry, video: { status: "queued", url: null, reason: null }, canAnimate: false } : entry)));
  };

  const shown = shownResults(tryOns);
  const locked = !hydrated || photo === null;

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
              {/* Inert until the page wakes up: a box ticked before then would be
                  unticked again by the first render, and the shop would refuse
                  a photograph the shopper believes they agreed to. */}
              <input
                type="checkbox"
                checked={consent}
                disabled={!hydrated}
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

      {/* ---- The outfit being put together: up to four pieces, one per place on the body ---- */}
      <section aria-labelledby="outfit" className="border-hairline rounded-plinth flex flex-col gap-3 border p-4" data-agent-id="fitting:outfit">
        <h2 id="outfit" className="font-display text-xl">
          {t("outfit.title")}
        </h2>
        <p className="text-slate max-w-[65ch] text-sm">{t("outfit.lede", { max: MAX_OUTFIT })}</p>
        {outfit.length === 0 ? (
          <p className="text-slate text-sm">{t("outfit.empty")}</p>
        ) : (
          <ol className="flex flex-wrap gap-2" data-agent-id="fitting:outfit-pieces">
            {(plan.ok ? plan.pieces.map((entry) => outfit.find((piece) => piece.slug === entry.id)!) : outfit).map((piece, index) => (
              <li key={piece.slug} className="bg-plinth rounded-plinth flex items-center gap-2 px-3 py-1.5 text-sm">
                {plan.ok ? <span className="text-slate tabular">{index + 1}.</span> : null}
                <span>{piece.title}</span>
                <button type="button" className="text-dusk min-h-6 cursor-pointer underline underline-offset-4" onClick={() => toggleOutfit(piece)} data-agent-id={`fitting:outfit-remove:${piece.slug}`}>
                  {t("outfit.remove")}
                </button>
              </li>
            ))}
          </ol>
        )}
        {outfit.length > 1 && !plan.ok ? (
          <p className="text-slate text-sm" data-agent-id="fitting:outfit-problem">
            {t(`outfit.errors.${plan.reason}`)}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-3">
          <Button disabled={locked || !plan.ok} aria-disabled={busy !== null} onClick={() => void tryOutfit()} data-agent-id="action:try-outfit">
            {busy === "outfit" ? t("asking") : t("outfit.tryOn", { count: outfit.length })}
          </Button>
          {plan.ok ? <span className="text-slate text-sm">{t("outfit.cost", { credits: outfit.length * CREDIT_COSTS.try_on, per: CREDIT_COSTS.try_on })}</span> : null}
        </div>
      </section>

      <section aria-labelledby="pieces" className="flex flex-col gap-4">
        <h2 id="pieces" className="font-display text-xl">
          {t("piecesTitle")}
        </h2>
        <p className="text-slate max-w-[65ch] text-sm">{photo === null ? t("piecesLocked") : t("piecesLede")}</p>
        {groups.map((group) => (
          <div key={group.id} className="flex flex-col gap-3" data-agent-id={`fitting:group:${group.id}`}>
            <h3 className="text-sm font-medium">{group.title}</h3>
            <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4" data-agent-id="fitting:pieces">
              {/* No fading while a piece is locked: dimmed text falls below the contrast the shop keeps. */}
              {group.pieces.map((piece) => {
                const inOutfit = outfit.some((entry) => entry.slug === piece.slug);
                return (
                  <li key={piece.slug} className={cn("border-hairline rounded-plinth flex flex-col gap-2 border p-3", piece.slug === focus && "border-dusk")} data-agent-id={`fitting:piece:${piece.slug}`}>
                    <span className="bg-plinth rounded-plinth relative aspect-square overflow-hidden">
                      {piece.image === null ? null : (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={piece.image} alt="" width={300} height={300} className="h-full w-full object-contain mix-blend-multiply" loading="lazy" />
                      )}
                    </span>
                    <span className="text-sm">{piece.title}</span>
                    <Button variant="tertiary" disabled={locked} aria-disabled={busy !== null} onClick={() => tryOn(piece)} data-agent-id={`action:try-on:${piece.slug}`}>
                      {busy === piece.slug ? t("asking") : t("tryIt")}
                    </Button>
                    {slotOf(piece.kind) === null ? null : (
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={!hydrated || (!inOutfit && outfit.length >= MAX_OUTFIT)}
                        aria-pressed={inOutfit}
                        onClick={() => toggleOutfit(piece)}
                        data-agent-id={`action:outfit:${piece.slug}`}
                      >
                        {inOutfit ? t("outfit.inIt") : t("outfit.add")}
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </section>

      {shown.length === 0 ? null : (
        <section aria-labelledby="results" className="flex flex-col gap-4">
          <h2 id="results" className="font-display text-xl">
            {t("resultsTitle")}
          </h2>
          <p className="text-slate max-w-[65ch] text-sm">{shown[0]?.view.drawn === true ? t("drawnNote") : t("resultsLede")}</p>
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3" data-agent-id="fitting:results">
            {shown.map(({ key, view, outfit: steps }) => {
              const status = steps === null ? view.status : steps.failed ? "failed" : steps.done === steps.count ? "done" : "running";
              return (
                <li key={key} className="border-hairline rounded-plinth flex flex-col gap-2 border p-3" data-agent-id={`fitting:result:${status}`}>
                  <span className="bg-plinth rounded-plinth relative flex aspect-[3/4] items-center justify-center overflow-hidden">
                    {view.video?.status === "done" && view.video.url !== null ? (
                      <video src={view.video.url} className="h-full w-full object-contain" controls loop muted playsInline aria-label={t("move.videoLabel")} data-agent-id="fitting:video" />
                    ) : status === "done" && view.url !== null ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={view.url} alt={t("resultAlt")} className="h-full w-full object-contain" />
                    ) : (
                      <span className="text-slate p-3 text-center text-sm" role="status">
                        {status === "failed" ? t("failed") : steps !== null ? t("outfit.progress", { step: Math.min(steps.done + 1, steps.count), count: steps.count }) : t("making")}
                      </span>
                    )}
                  </span>
                  <span className="text-slate text-xs">
                    {steps === null ? null : `${t("outfit.label", { count: steps.count })} · `}
                    {view.drawn ? t("drawnLabel") : t("tryOnLabel")}
                  </span>
                  {/* "See it move": only a finished try-on, only with the service, and the shopper knows the price first. */}
                  {status !== "done" || view.drawn || !canMove ? null : view.video?.status === "queued" || view.video?.status === "running" ? (
                    <p className="text-slate text-sm" role="status" data-agent-id="fitting:moving">
                      {t("move.making")}
                    </p>
                  ) : view.video?.status === "done" ? null : !signedIn ? (
                    <ButtonLink href={`/account/sign-in?next=/${locale}/fitting-room`} variant="tertiary" size="sm" data-agent-id="fitting:move-sign-in">
                      {t("move.signIn")}
                    </ButtonLink>
                  ) : (
                    <div className="flex flex-col gap-1">
                      <Button variant="secondary" size="sm" disabled={!hydrated || !view.canAnimate} aria-disabled={busy !== null} onClick={() => void move(view)} data-agent-id={`action:see-it-move:${view.id}`}>
                        {busy === `move:${view.id}` ? t("asking") : t("move.button")}
                      </Button>
                      <span className="text-slate text-xs">{view.video?.status === "failed" ? t("move.failed") : t("move.note", { credits: CREDIT_COSTS.animate })}</span>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
