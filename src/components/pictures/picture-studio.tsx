"use client";

/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * "See it in a room" on a product page: the piece in a showroom of one style, or in the shopper's own room, made by AI.
 */

import { useTranslations } from "next-intl";
import { useId, useMemo, useState } from "react";

import { DropVeil, usePhotoAttachment } from "@/components/concierge/photo-attachment";
import { PictureStage } from "@/components/pictures/picture-stage";
import { usePicture } from "@/components/pictures/use-picture";
import { Button } from "@/components/ui/button";
import { SmartLink } from "@/components/ui/smart-link";
import type { PictureView } from "@/app/api/pictures/route";
import { SCENE_STYLE_IDS, type SceneStyle } from "@/lib/pictures/pictures";
import { cn } from "@/lib/ui/cn";

/**
 * docs/adr/053 (George, 2026-10-03: "some impatient users can simply either
 * paste an image, or view the furniture with just one click and a bit of
 * wait"). Two ways, side by side with the exact one:
 *
 * - "A room like…": four showroom styles. A style someone has already asked
 *   for is ready — shown at once, free, outside any allowance; the first to
 *   ask for one waits about twenty seconds, and every shopper after them sees
 *   it straight away.
 * - "Your room": a photograph pasted, dropped or chosen, with consent; the AI
 *   places the piece, and the picture says its size is approximate.
 * - "Exact, with a sheet of paper" goes to the room planner, where the size is
 *   measured (and from where a picture can be made too).
 */

export type StudioPiece = { slug: string; title: string; image: string | null; canPlace: boolean };

export function PictureStudio({ piece, scenes, left, signedIn }: { piece: StudioPiece; scenes: PictureView[]; left: number | null; signedIn: boolean }) {
  const t = useTranslations("pictures");
  const tabsId = useId();
  const consentId = useId();
  const [tab, setTab] = useState<"scenes" | "own">("scenes");
  const [chosen, setChosen] = useState<SceneStyle | "own" | null>(null);
  const { state, scene, own, show } = usePicture(left);
  const photo = usePhotoAttachment();
  // The scenes ready to see: those the page came with, and any made while the shopper is here.
  const [made, setMade] = useState<PictureView[]>(scenes);
  const latest = state.phase === "done" && state.picture?.kind === "scene" && state.picture.style !== null ? state.picture : null;
  if (latest !== null && !made.some((entry) => entry.id === latest.id)) setMade([...made, latest]);
  const ready = useMemo(() => new Map(made.filter((entry) => entry.style !== null).map((entry) => [entry.style!, entry])), [made]);
  const making = state.phase === "asking" || state.phase === "making";

  const pick = (style: SceneStyle) => {
    if (making) return;
    setChosen(style);
    const made = ready.get(style);
    if (made !== undefined) show(made);
    else void scene(piece.slug, style);
  };

  const pictureOwn = async () => {
    // Nothing leaves the device without the tick: the button waits for it, and so does this.
    if (making || photo.attachment === null || !photo.attachment.consent) return;
    setChosen("own");
    await own(piece.slug, "quick", photo.attachment.file, true);
  };

  const result = state.phase === "done" ? state.picture : null;
  const source = chosen === "own" ? (photo.attachment?.preview ?? null) : piece.image;
  const label = result === null ? null : [result.drawn ? t("label.drawn") : t("label.ai"), result.kind === "quick" ? t("label.approximate") : null].filter(Boolean).join(" · ");
  const alt = chosen === "own" ? t("altOwn", { title: piece.title }) : chosen !== null ? t("alt", { title: piece.title, style: t(`styles.${chosen}`) }) : piece.title;
  const error = state.phase === "refused" || state.phase === "failed" ? state.reason : photo.error;

  return (
    <section aria-labelledby={`${tabsId}-title`} className="bg-dusk text-glass mt-20 -mx-6 px-6 py-14 md:mx-0 md:rounded-[14px] md:px-10" data-agent-id="pictures:studio">
      <div className="mx-auto grid max-w-[1440px] gap-10 lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-start">
        <div className="flex flex-col gap-4">
          <div>
            <p className="text-mist text-xs tracking-[0.14em] uppercase">{t("eyebrow")}</p>
            <h2 id={`${tabsId}-title`} className="font-display mt-2 text-3xl text-white">
              {t("title")}
            </h2>
            <p className="text-mist mt-2 max-w-[60ch] text-sm">{t("lede")}</p>
          </div>
          {state.phase === "idle" && chosen === null ? (
            <div className="ring-gilt/30 relative grid aspect-[4/3] w-full place-items-center overflow-hidden rounded-[10px] ring-1" data-agent-id="picture:empty">
              {piece.image === null ? null : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={piece.image} alt="" aria-hidden="true" className="picture-resting absolute inset-0 size-full object-contain opacity-60" />
              )}
              <p className="font-display relative max-w-[26ch] text-center text-xl text-white">{t("empty")}</p>
            </div>
          ) : (
            <PictureStage phase={state.phase} source={source} result={result?.url ?? null} compare={result?.kind === "quick"} alt={alt} />
          )}
          {result === null ? null : (
            <div className="flex flex-wrap items-center gap-3">
              <span className="border-gilt/40 text-gilt-light rounded-full border px-2.5 py-1 text-xs" data-agent-id="picture:label">
                {label}
              </span>
              <span className="flex-1" />
              {result.url === null ? null : (
                <a href={result.url} download={`vitrine-${piece.slug}.webp`} className="rounded-plinth bg-white px-4 py-2 text-sm font-medium text-black transition-opacity hover:opacity-90" data-agent-id="picture:save">
                  {t("save")}
                </a>
              )}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-5 lg:pt-16">
          <div role="tablist" aria-label={t("title")} className="flex gap-1 rounded-full bg-white/8 p-1">
            {(["scenes", "own"] as const).map((name) => (
              <button
                key={name}
                id={`${tabsId}-${name}`}
                role="tab"
                type="button"
                aria-selected={tab === name}
                aria-controls={`${tabsId}-${name}-panel`}
                onClick={() => setTab(name)}
                className={cn("flex-1 rounded-full px-3 py-2 text-sm transition-colors duration-quick", tab === name ? "bg-glass text-dusk font-medium" : "text-mist hover:text-white")}
                data-agent-id={`pictures:tab:${name}`}
              >
                {t(`tabs.${name}`)}
              </button>
            ))}
          </div>

          {tab === "scenes" ? (
            <div id={`${tabsId}-scenes-panel`} role="tabpanel" aria-labelledby={`${tabsId}-scenes`}>
              <ul className="grid grid-cols-2 gap-3">
                {SCENE_STYLE_IDS.map((style) => {
                  const made = ready.get(style);
                  const active = chosen === style;
                  return (
                    <li key={style}>
                      <button
                        type="button"
                        onClick={() => pick(style)}
                        disabled={making && !active}
                        aria-pressed={active}
                        className={cn(
                          "group flex w-full flex-col gap-2 rounded-[10px] p-1.5 text-left transition-colors duration-quick disabled:opacity-40",
                          active ? "bg-white/12 ring-gilt ring-1" : "hover:bg-white/6",
                        )}
                        data-agent-id={`pictures:style:${style}`}
                      >
                        <span className="scene-swatch relative block aspect-[4/3] w-full overflow-hidden rounded-[7px]" data-style={style}>
                          {made?.url == null ? null : (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={made.url} alt="" className="absolute inset-0 size-full object-cover transition-transform duration-[var(--duration-stage)] group-hover:scale-[1.03]" />
                          )}
                        </span>
                        <span className="px-1 text-sm text-white">{t(`styles.${style}`)}</span>
                        <span className="text-mist px-1 pb-1 text-xs">{made !== undefined ? t("ready") : active && making ? t("making") : t("make")}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : (
            <div id={`${tabsId}-own-panel`} role="tabpanel" aria-labelledby={`${tabsId}-own`} className="flex flex-col gap-3">
              <p className="text-mist text-sm">{t("ownLede")}</p>
              <label
                {...photo.bind}
                className={cn(
                  "relative flex min-h-36 cursor-pointer flex-col items-center justify-center gap-2 overflow-hidden rounded-[10px] border border-dashed border-white/25 p-4 text-center text-sm transition-colors hover:border-white/50",
                  photo.dragging && "border-gilt",
                )}
                data-agent-id="pictures:drop"
              >
                <DropVeil show={photo.dragging} label={t("drop")} />
                {photo.attachment === null ? (
                  <span className="text-white">{t("choose")}</span>
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={photo.attachment.preview} alt={t("yourPhoto")} className="max-h-40 rounded-[6px] object-contain" />
                )}
                <input
                  type="file"
                  accept="image/*"
                  className="sr-only"
                  onChange={(event) => {
                    const file = event.currentTarget.files?.[0];
                    if (file !== undefined) photo.attach(file);
                    event.currentTarget.value = "";
                  }}
                  data-agent-id="pictures:file"
                />
              </label>
              {photo.attachment === null ? null : (
                <>
                  <label htmlFor={consentId} className="flex cursor-pointer items-start gap-2 text-sm leading-snug">
                    <input id={consentId} type="checkbox" checked={photo.attachment.consent} onChange={(event) => photo.setConsent(event.currentTarget.checked)} className="accent-gilt mt-0.5 size-4 shrink-0" data-agent-id="pictures:consent" />
                    <span>{t("consent")}</span>
                  </label>
                  <Button onClick={() => void pictureOwn()} disabled={making || !photo.attachment.consent} className="bg-glass text-dusk hover:bg-white" data-agent-id="pictures:own-go">
                    {t("ownGo")}
                  </Button>
                </>
              )}
              {piece.canPlace ? (
                <SmartLink href={`/room?product=${piece.slug}`} className="text-mist text-sm underline-offset-4 hover:text-white" data-agent-id="pictures:exact">
                  {t("exact")} →
                </SmartLink>
              ) : null}
            </div>
          )}

          <p className="text-mist text-xs" data-agent-id="pictures:left">
            {state.left === null ? t("leftGuest") : t("left", { count: state.left })}
            {!signedIn && state.left !== null ? ` ${t("leftAccounts")}` : ""}
          </p>
          {error === null ? null : (
            <p role="alert" className="text-sm text-white" data-agent-id="pictures:error">
              {t.has(`errors.${error}`) ? t(`errors.${error}`) : t("errors.generic")}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
