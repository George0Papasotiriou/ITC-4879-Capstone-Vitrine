"use client";

/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * "Picture it" on a product page: the piece photographed into a showroom or the shopper's own room, and the decision made from the picture.
 */

import { useTranslations } from "next-intl";
import { useId, useMemo, useState } from "react";

import { AddToBoard } from "@/components/boards/add-to-board";
import { AddToCart } from "@/components/commerce/add-to-cart";
import { DropVeil, usePhotoAttachment } from "@/components/concierge/photo-attachment";
import { PictureStage } from "@/components/pictures/picture-stage";
import { usePicture } from "@/components/pictures/use-picture";
import { Button } from "@/components/ui/button";
import { SmartLink } from "@/components/ui/smart-link";
import { useHydrated } from "@/components/ui/use-hydrated";
import type { PictureView } from "@/app/api/pictures/route";
import { SCENE_STYLE_IDS, type SceneStyle } from "@/lib/pictures/pictures";
import { cn } from "@/lib/ui/cn";

/**
 * docs/adr/053, docs/adr/060 (George, 2026-10-04: "hyper realistic pictures
 * ONLY … and I want this to make furniture selection seamless").
 *
 * The picture is where the shopper decides, so everything to decide with is
 * under it: the piece's price and stock (from the database, as everywhere),
 * Add to cart, Add to a board, Save, and a link to the piece. Around it:
 *
 * - A room like…: four showroom styles, shown by their own room photographs
 *   where they are made. A style someone has already pictured this piece in
 *   is ready — shown at once, free, outside any allowance.
 * - Your room: a photograph pasted, dropped or chosen, with consent; or, while
 *   the last one the shopper gave lives (a day), that room again in one tap,
 *   on this piece or any other.
 * - Try another in this room: pieces of the same kind, nearest in price; one
 *   tap pictures that piece in the same room or style.
 * - This visit: every picture made here, to go back to, and two side by side
 *   to compare, each with its own price and Add to cart.
 *
 * New pictures are offered only when they can be made (PICTURES_PROVIDER, a
 * key, the kill switch, the day's budget); otherwise only the ready ones show.
 */

export type StudioPiece = { id: string; slug: string; title: string; image: string | null; canPlace: boolean; price: string; inStock: boolean };
export type StudioRoom = { uploadId: string; url: string; expiresAt: string };

type Context = { kind: "style"; style: SceneStyle } | { kind: "own"; uploadId: string | null; preview: string };
type Shot = { picture: PictureView; piece: StudioPiece; context: Context };

const hoursLeft = (expiresAt: string) => Math.max(1, Math.round((new Date(expiresAt).getTime() - Date.now()) / 3_600_000));

export function PictureStudio({
  piece,
  scenes,
  mine,
  tiles,
  canMake,
  left,
  signedIn,
  room,
  alternatives,
}: {
  piece: StudioPiece;
  /** Showroom pictures of this piece already made, free to see. */
  scenes: PictureView[];
  /** This shopper's own pictures of this piece from the last day. */
  mine: PictureView[];
  /** Each style's room photograph, where made. */
  tiles: Partial<Record<SceneStyle, string>>;
  /** Whether new pictures can be made right now. */
  canMake: boolean;
  left: number | null;
  signedIn: boolean;
  /** The room photograph the shopper last gave, while it lives. */
  room: StudioRoom | null;
  /** Pieces of the same kind to try in the same room. */
  alternatives: StudioPiece[];
}) {
  const t = useTranslations("pictures");
  const tabsId = useId();
  const consentId = useId();
  const [tab, setTab] = useState<"scenes" | "own">("scenes");
  const [subject, setSubject] = useState<StudioPiece>(piece);
  const [context, setContext] = useState<Context | null>(null);
  const { state, scene, own, again, show } = usePicture(left, { resume: piece.slug });
  const photo = usePhotoAttachment();
  // Inert until the page can act on a click, as the shop's other controls are: a tap before then would be lost.
  const hydrated = useHydrated();
  const making = !hydrated || state.phase === "asking" || state.phase === "making";
  const waiting = state.phase === "asking" || state.phase === "making";

  // Every picture of this visit, newest first: those the page came with, and each one made or shown here.
  // Their own room behind each, where the page still has it to compare with.
  const initial = useMemo<Shot[]>(
    () =>
      mine
        .filter((entry) => entry.status === "done")
        .map((entry) => ({ picture: entry, piece, context: { kind: "own", uploadId: entry.uploadId, preview: room !== null && room.uploadId === entry.uploadId ? room.url : "" } })),
    [mine, piece, room],
  );
  const [shots, setShots] = useState<Shot[]>(initial);
  const [current, setCurrent] = useState<Shot | null>(initial[0] ?? null);
  const [comparing, setComparing] = useState(false);
  const [other, setOther] = useState<string | null>(null);
  // The scenes ready to see for the page's piece: those the page came with, and any made while the shopper is here.
  const [ready, setReady] = useState(() => new Map(scenes.filter((entry) => entry.style !== null).map((entry) => [entry.style!, entry])));

  // A picture that has just arrived becomes the current one, and joins the visit (adjusted while rendering).
  const arrived = state.phase === "done" ? state.picture : null;
  if (arrived !== null && current?.picture.id !== arrived.id) {
    // A picture resumed after the shopper came back has no room chosen on this page yet: its own says which.
    const where: Context =
      context ?? (arrived.kind === "scene" && arrived.style !== null ? { kind: "style", style: arrived.style } : { kind: "own", uploadId: arrived.uploadId, preview: room !== null && room.uploadId === arrived.uploadId ? room.url : "" });
    if (context === null) setContext(where);
    const shot: Shot = { picture: arrived, piece: subject, context: arrived.kind === "quick" && where.kind === "own" ? { ...where, uploadId: arrived.uploadId ?? where.uploadId } : where };
    setCurrent(shot);
    setShots([shot, ...shots.filter((entry) => entry.picture.id !== arrived.id)].slice(0, 8));
    if (arrived.kind === "scene" && arrived.style !== null && subject.id === piece.id && !ready.has(arrived.style)) setReady(new Map(ready).set(arrived.style, arrived));
  }

  /** Pictures `who` in `where`: a ready scene at once, anything else asked for. */
  const picture = async (who: StudioPiece, where: Context, file?: File) => {
    if (making) return;
    setSubject(who);
    setContext(where);
    setComparing(false);
    if (where.kind === "style") {
      const made = who.id === piece.id ? ready.get(where.style) : undefined;
      if (made !== undefined) return show(made);
      return scene(who.slug, where.style);
    }
    if (file !== undefined) return own(who.slug, "quick", file, true);
    if (where.uploadId !== null) return again(who.slug, where.uploadId);
  };

  const pictureOwn = () => {
    // Nothing leaves the device without the tick: the button waits for it, and so does this.
    if (photo.attachment === null || !photo.attachment.consent) return;
    void picture(subject, { kind: "own", uploadId: null, preview: photo.attachment.preview }, photo.attachment.file);
  };

  const shownPiece = waiting || current === null ? subject : current.piece;
  const result = waiting ? null : (current?.picture ?? null);
  // While a picture is made, the room it is being made in rests in the frame; once shown, the room it was made from.
  const behind = waiting || current === null ? context : current.context;
  const source = behind?.kind === "own" && behind.preview !== "" ? behind.preview : (shownPiece.image ?? null);
  const labelFor = (view: PictureView) => [t("label.ai"), view.kind === "quick" ? t("label.approximate") : view.kind === "room" ? t("label.exact") : null].filter(Boolean).join(" · ");
  const altFor = (shot: { picture: PictureView; piece: StudioPiece }) =>
    shot.picture.kind === "scene" && shot.picture.style !== null ? t("alt", { title: shot.piece.title, style: t(`styles.${shot.picture.style}`) }) : t("altOwn", { title: shot.piece.title });
  const error = state.phase === "refused" || state.phase === "failed" ? state.reason : photo.error;
  const compareWith = comparing ? (shots.find((entry) => entry.picture.id === other) ?? shots.find((entry) => entry.picture.id !== current?.picture.id) ?? null) : null;
  const ownRoom = context?.kind === "own" && context.uploadId !== null ? context : room === null ? null : ({ kind: "own", uploadId: room.uploadId, preview: room.url } as const);

  return (
    <section aria-labelledby={`${tabsId}-title`} className="bg-dusk text-glass mt-20 -mx-6 px-6 py-14 md:mx-0 md:rounded-[14px] md:px-10" data-agent-id="pictures:studio">
      <div className="mx-auto grid max-w-[1440px] gap-10 lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-start">
        <div className="flex min-w-0 flex-col gap-5">
          <div>
            <p className="text-mist text-xs tracking-[0.14em] uppercase">{t("eyebrow")}</p>
            <h2 id={`${tabsId}-title`} className="font-display mt-2 text-3xl text-white">
              {t("title")}
            </h2>
            <p className="text-mist mt-2 max-w-[60ch] text-sm">{canMake ? t("lede") : t("ledeReady")}</p>
          </div>

          {compareWith !== null && current !== null ? (
            <div className="grid gap-4 sm:grid-cols-2" data-agent-id="pictures:compare-view">
              {[current, compareWith].map((shot) => (
                <figure key={shot.picture.id} className="flex flex-col gap-2">
                  <div className="ring-gilt/30 relative aspect-[4/3] overflow-hidden rounded-[10px] ring-1">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={shot.picture.url ?? ""} alt={altFor(shot)} className="size-full object-cover" />
                    <span className="pointer-events-none absolute bottom-2 left-2 rounded-full bg-black/40 px-2 py-0.5 text-[11px] text-white/90 backdrop-blur-sm">{t("label.ai")}</span>
                  </div>
                  <figcaption className="flex flex-wrap items-center gap-x-3 gap-y-2">
                    <span className="min-w-0 flex-1 truncate text-sm text-white">{shot.piece.title}</span>
                    <span className="text-gilt-light text-sm tabular-nums">{shot.piece.price}</span>
                  </figcaption>
                  <AddToCart productId={shot.piece.id} inStock={shot.piece.inStock} agentId={`picture:compare-add:${shot.picture.id}`} tone="dark" />
                </figure>
              ))}
            </div>
          ) : state.phase === "idle" && current === null ? (
            <div className="ring-gilt/30 relative grid aspect-[4/3] w-full place-items-center overflow-hidden rounded-[10px] ring-1" data-agent-id="picture:empty">
              {piece.image === null ? null : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={piece.image} alt="" aria-hidden="true" className="picture-resting absolute inset-0 size-full object-contain opacity-60" />
              )}
              <p className="font-display relative max-w-[26ch] text-center text-xl text-white">
                {/* The rooms are beside the picture on a wide screen, under it on a phone. */}
                <span className="hidden lg:inline">{t("empty")}</span>
                <span className="lg:hidden">{t("emptyBelow")}</span>
              </p>
            </div>
          ) : (
            <PictureStage
              phase={waiting ? state.phase : result === null ? state.phase : "done"}
              source={source}
              result={result?.url ?? null}
              full={result?.url ?? null}
              compare={result?.kind === "quick" && behind?.kind === "own" && behind.preview !== ""}
              alt={current === null ? piece.title : altFor(current)}
              label={result === null ? null : labelFor(result)}
              since={state.since}
            />
          )}

          {result === null || current === null || comparing ? null : (
            <div className="flex flex-col gap-4 rounded-[12px] bg-white/[0.06] p-4 sm:flex-row sm:items-center" data-agent-id="picture:decide">
              <div className="min-w-0 flex-1">
                <p className="truncate text-white">{current.piece.title}</p>
                <p className="text-mist mt-0.5 text-sm">
                  <span className="text-gilt-light tabular-nums">{current.piece.price}</span> · {current.piece.inStock ? t("inStock") : t("outOfStock")}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <AddToCart productId={current.piece.id} inStock={current.piece.inStock} agentId="picture:add-to-cart" flightSource='[data-agent-id="picture:result"]' tone="dark" />
                <AddToBoard productId={current.piece.id} title={current.piece.title} place="picture" tone="dark" />
                {result.downloadUrl === null ? null : (
                  <a href={result.downloadUrl} download className="min-h-11 content-center rounded-full px-3 text-sm text-white underline-offset-4 hover:underline" data-agent-id="picture:save">
                    {t("save")}
                  </a>
                )}
                {current.piece.id === piece.id ? null : (
                  <SmartLink href={`/p/${current.piece.slug}`} className="text-mist min-h-11 content-center px-1 text-sm underline-offset-4 hover:text-white hover:underline" data-agent-id="picture:open-piece">
                    {t("openPiece")}
                  </SmartLink>
                )}
              </div>
            </div>
          )}

          {alternatives.length === 0 || !canMake || context === null || (context.kind === "own" && ownRoom === null) ? null : (
            <section aria-labelledby={`${tabsId}-others`} className="flex flex-col gap-3" data-agent-id="pictures:alternatives">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 id={`${tabsId}-others`} className="font-display text-xl text-white">
                  {t("others.title")}
                </h3>
                <p className="text-mist text-xs">{context.kind === "style" ? t("others.style", { style: t(`styles.${context.style}`) }) : t("others.own")}</p>
              </div>
              <ul className="-mx-1 flex snap-x gap-3 overflow-x-auto px-1 pb-2">
                {[piece, ...alternatives.filter((entry) => entry.id !== piece.id)].map((entry) => {
                  const active = subject.id === entry.id;
                  return (
                    <li key={entry.id} className="w-36 shrink-0 snap-start">
                      <button
                        type="button"
                        disabled={making}
                        aria-pressed={active}
                        onClick={() => void picture(entry, context.kind === "style" ? context : ownRoom!)}
                        className={cn("group flex w-full flex-col gap-2 rounded-[10px] p-1.5 text-left transition-colors duration-quick disabled:opacity-40", active ? "ring-gilt bg-white/10 ring-1" : "hover:bg-white/6")}
                        data-agent-id={`pictures:try:${entry.slug}`}
                      >
                        <span className="block aspect-square overflow-hidden rounded-[7px] bg-white">
                          {entry.image === null ? null : (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={entry.image} alt="" className="size-full object-contain transition-transform duration-[var(--duration-stage)] group-hover:scale-[1.04]" loading="lazy" />
                          )}
                        </span>
                        <span className="line-clamp-2 px-1 text-xs leading-snug text-white">{entry.title}</span>
                        <span className="text-gilt-light px-1 pb-1 text-xs tabular-nums">{entry.price}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {shots.length < 2 ? null : (
            <section aria-labelledby={`${tabsId}-visit`} className="flex flex-col gap-3" data-agent-id="pictures:visit">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 id={`${tabsId}-visit`} className="font-display text-xl text-white">
                  {t("visit.title")}
                </h3>
                <button
                  type="button"
                  aria-pressed={comparing}
                  onClick={() => setComparing((value) => !value)}
                  className="min-h-11 rounded-full bg-white/10 px-4 text-sm text-white transition-colors hover:bg-white/20"
                  data-agent-id="pictures:compare"
                >
                  {comparing ? t("visit.done") : t("visit.compare")}
                </button>
              </div>
              <ul className="-mx-1 flex snap-x gap-3 overflow-x-auto px-1 pb-2">
                {shots.map((shot) => {
                  const shown = comparing ? shot.picture.id === compareWith?.picture.id || shot.picture.id === current?.picture.id : shot.picture.id === current?.picture.id;
                  return (
                    <li key={shot.picture.id} className="w-40 shrink-0 snap-start">
                      <button
                        type="button"
                        aria-pressed={shown}
                        onClick={() => {
                          if (comparing && shot.picture.id !== current?.picture.id) return setOther(shot.picture.id);
                          setCurrent(shot);
                          setSubject(shot.piece);
                          setContext(shot.context);
                          show(shot.picture);
                        }}
                        className={cn("flex w-full flex-col gap-1.5 rounded-[10px] p-1.5 text-left transition-colors", shown ? "ring-gilt bg-white/10 ring-1" : "hover:bg-white/6")}
                        data-agent-id={`pictures:shot:${shot.picture.id}`}
                      >
                        <span className="block aspect-[4/3] overflow-hidden rounded-[7px] bg-black/30">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={shot.picture.previewUrl ?? shot.picture.url ?? ""} alt={altFor(shot)} className="size-full object-cover" loading="lazy" />
                        </span>
                        <span className="truncate px-1 text-xs text-white">{shot.piece.title}</span>
                        <span className="text-mist px-1 pb-0.5 text-xs">{shot.context.kind === "style" ? t(`styles.${shot.context.style}`) : t("tabs.own")}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
        </div>

        <div className="flex flex-col gap-5 lg:pt-16">
          {canMake ? (
            <div role="tablist" aria-label={t("title")} className="flex gap-1 rounded-full bg-white/8 p-1">
              {(["scenes", "own"] as const).map((name) => (
                <button
                  key={name}
                  id={`${tabsId}-${name}`}
                  role="tab"
                  type="button"
                  aria-selected={tab === name}
                  aria-controls={`${tabsId}-${name}-panel`}
                  disabled={!hydrated}
                  onClick={() => setTab(name)}
                  className={cn("min-h-11 flex-1 rounded-full px-3 py-2 text-sm transition-colors duration-quick", tab === name ? "bg-glass text-dusk font-medium" : "text-mist hover:text-white")}
                  data-agent-id={`pictures:tab:${name}`}
                >
                  {t(`tabs.${name}`)}
                </button>
              ))}
            </div>
          ) : null}

          {tab === "scenes" || !canMake ? (
            <div id={`${tabsId}-scenes-panel`} role={canMake ? "tabpanel" : undefined} aria-labelledby={canMake ? `${tabsId}-scenes` : undefined}>
              <ul className="grid grid-cols-2 gap-3">
                {SCENE_STYLE_IDS.map((style) => {
                  const made = ready.get(style);
                  const active = context?.kind === "style" && context.style === style;
                  const available = made !== undefined || canMake;
                  const tile = made?.previewUrl ?? made?.url ?? tiles[style] ?? null;
                  return (
                    <li key={style}>
                      <button
                        type="button"
                        onClick={() => void picture(piece, { kind: "style", style })}
                        disabled={!available || (making && !active)}
                        aria-pressed={active}
                        className={cn(
                          "group flex w-full flex-col gap-2 rounded-[10px] p-1.5 text-left transition-colors duration-quick disabled:opacity-40",
                          active ? "ring-gilt bg-white/12 ring-1" : "hover:bg-white/6",
                        )}
                        data-agent-id={`pictures:style:${style}`}
                      >
                        <span className="scene-swatch relative block aspect-[4/3] w-full overflow-hidden rounded-[7px]" data-style={style}>
                          {tile === null ? null : (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={tile} alt="" className="absolute inset-0 size-full object-cover transition-transform duration-[var(--duration-stage)] group-hover:scale-[1.03]" loading="lazy" />
                          )}
                        </span>
                        <span className="px-1 text-sm text-white">{t(`styles.${style}`)}</span>
                        <span className="text-mist px-1 pb-1 text-xs">{made !== undefined ? t("ready") : !canMake ? t("unavailable") : active && waiting ? t("making") : t("make")}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : (
            <div id={`${tabsId}-own-panel`} role="tabpanel" aria-labelledby={`${tabsId}-own`} className="flex flex-col gap-3">
              <p className="text-mist text-sm">{t("ownLede")}</p>
              {room === null ? null : (
                <div className="flex items-center gap-3 rounded-[10px] bg-white/[0.06] p-2" data-agent-id="pictures:remembered">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={room.url} alt={t("yourPhoto")} className="size-16 shrink-0 rounded-[6px] object-cover" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-white">{t("remembered.title")}</p>
                    <p className="text-mist text-xs">{t("remembered.left", { hours: hoursLeft(room.expiresAt) })}</p>
                  </div>
                  <Button size="sm" onClick={() => void picture(subject, { kind: "own", uploadId: room.uploadId, preview: room.url })} disabled={making} className="bg-glass text-dusk hover:bg-white" data-agent-id="pictures:remembered-go">
                    {t("remembered.go")}
                  </Button>
                </div>
              )}
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
                  <span className="text-white">{room === null ? t("choose") : t("chooseAnother")}</span>
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
                  <Button onClick={pictureOwn} disabled={making || !photo.attachment.consent} className="bg-glass text-dusk hover:bg-white" data-agent-id="pictures:own-go">
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

          {canMake ? (
            <p className="text-mist text-xs" data-agent-id="pictures:left">
              {state.left === null ? t("leftGuest") : t("left", { count: state.left })}
              {!signedIn && state.left !== null ? ` ${t("leftAccounts")}` : ""}
            </p>
          ) : (
            <p className="text-mist text-xs" data-agent-id="pictures:paused">
              {t("paused")}
            </p>
          )}
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
