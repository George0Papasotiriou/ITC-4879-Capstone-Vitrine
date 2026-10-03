"use client";

/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * An AI picture asked for in the Concierge, developing in the conversation until it is ready.
 */

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import type { PictureResponse, PictureView } from "@/app/api/pictures/route";
import { PictureStage } from "@/components/pictures/picture-stage";
import type { PicturePhase } from "@/components/pictures/use-picture";
import { SmartLink } from "@/components/ui/smart-link";
import { isSceneStyle } from "@/lib/pictures/pictures";

const FOLLOW_MS = 1500;
const MAX_FOLLOWS = 80;

/**
 * docs/adr/053. `picture_in_room` answers with an id; this follows it — the
 * same darkroom as the product page, smaller — and shows the picture with its
 * label, a Save link and the way back to the piece. The picture's address
 * comes from the shop (a scene's public one, or a short-lived link to the
 * shopper's own), never from the model.
 */
export function ConciergePicture({ pictureId, slug, title, room }: { pictureId: string; slug: string; title: string; room: string }) {
  const t = useTranslations("pictures");
  const [picture, setPicture] = useState<PictureView | null>(null);
  const [gaveUp, setGaveUp] = useState(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      for (let step = 0; step < MAX_FOLLOWS && alive; step += 1) {
        const response = await fetch(`/api/pictures?id=${pictureId}`, { cache: "no-store" }).catch(() => null);
        const body = (await response?.json().catch(() => null)) as PictureResponse | null;
        if (!alive) return;
        if (body?.ok === true && "picture" in body) {
          setPicture(body.picture);
          if (body.picture.status === "done" || body.picture.status === "failed") return;
        }
        await new Promise((resolve) => setTimeout(resolve, FOLLOW_MS));
      }
      if (alive) setGaveUp(true);
    })();
    return () => void (alive = false);
  }, [pictureId]);

  const phase: PicturePhase = picture?.status === "done" ? "done" : picture?.status === "failed" || gaveUp ? "failed" : "making";
  const alt = isSceneStyle(room) ? t("alt", { title, style: t(`styles.${room}`) }) : t("altOwn", { title });
  const done = phase === "done" ? picture : null;

  return (
    <div className="flex flex-col gap-2" data-agent-id={`concierge:picture:${pictureId}`}>
      {phase === "failed" ? (
        <p role="alert" className="text-slate text-sm">
          {t.has(`errors.${picture?.reason ?? "timeout"}`) ? t(`errors.${picture?.reason ?? "timeout"}`) : t("errors.generic")}
        </p>
      ) : (
        <PictureStage phase={phase} source={null} result={done?.url ?? null} compare={false} alt={alt} />
      )}
      {done === null ? null : (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          <span className="border-hairline text-slate rounded-full border px-2 py-0.5" data-agent-id="picture:label">
            {[done.drawn ? t("label.drawn") : t("label.ai"), done.kind === "quick" ? t("label.approximate") : null].filter(Boolean).join(" · ")}
          </span>
          {done.url === null ? null : (
            <a href={done.url} download={`vitrine-${slug}.webp`} className="text-dusk font-medium underline-offset-4 hover:underline">
              {t("save")}
            </a>
          )}
          <SmartLink href={`/p/${slug}`} className="text-dusk underline-offset-4 hover:underline">
            {title}
          </SmartLink>
        </div>
      )}
    </div>
  );
}
