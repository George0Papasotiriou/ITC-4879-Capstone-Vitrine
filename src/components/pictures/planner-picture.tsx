"use client";

/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * In the room planner: the placed piece made into a photograph of the shopper's room, by AI, at the size the sheet measured.
 */

import { useTranslations } from "next-intl";
import { useEffect, useId, useState } from "react";

import { PictureStage } from "@/components/pictures/picture-stage";
import { usePicture } from "@/components/pictures/use-picture";
import { Button } from "@/components/ui/button";

/**
 * docs/adr/053. The planner already knows where the piece stands and how big
 * it is (the sheet of paper, docs/adr/052); what it cannot do is make the
 * piece look as if it were really in the photograph. This sends the planner's
 * own picture — the photograph with the piece placed, without the grid — to
 * the AI as the guide, and the piece's studio photograph for its looks. The
 * planner keeps the photograph on the device until the shopper ticks the
 * consent line and asks; then it goes through the shop's photo rules.
 */
export function PlannerPicture({ slug, picture }: { slug: string; picture: () => Promise<{ blob: Blob; width: number; height: number } | null> }) {
  const t = useTranslations("pictures");
  const consentId = useId();
  const [consent, setConsent] = useState(false);
  const [source, setSource] = useState<{ url: string; aspect: string } | null>(null);
  const { state, own } = usePicture(null);
  const making = state.phase === "asking" || state.phase === "making";
  const result = state.phase === "done" ? state.picture : null;

  useEffect(() => () => void (source !== null && URL.revokeObjectURL(source.url)), [source]);

  const go = async () => {
    if (!consent || making) return;
    const made = await picture();
    if (made === null) return;
    setSource({ url: URL.createObjectURL(made.blob), aspect: `${made.width} / ${made.height}` });
    await own(slug, "room", made.blob, true);
  };

  const error = state.phase === "refused" || state.phase === "failed" ? state.reason : null;
  return (
    <section className="border-hairline flex flex-col gap-3 border-t pt-5" data-agent-id="room:picture">
      <h3 className="font-display text-xl">{t("planner.title")}</h3>
      <p className="text-slate text-sm">{t("planner.lede")}</p>
      {source === null ? null : (
        <PictureStage
          phase={state.phase}
          source={source.url}
          result={result?.url ?? null}
          compare
          alt={t("plannerAlt")}
          aspect={source.aspect}
          label={result === null ? null : [t("label.ai"), t("label.exact")].join(" · ")}
          since={state.since}
        />
      )}
      {result === null || result.downloadUrl === null ? null : (
        <div className="flex flex-wrap items-center gap-3">
          <a href={result.downloadUrl} download className="text-dusk text-sm font-medium underline-offset-4 hover:underline" data-agent-id="picture:save">
            {t("save")}
          </a>
        </div>
      )}
      <label htmlFor={consentId} className="flex cursor-pointer items-start gap-2 text-sm leading-snug">
        <input id={consentId} type="checkbox" checked={consent} onChange={(event) => setConsent(event.currentTarget.checked)} className="accent-dusk mt-0.5 size-4 shrink-0" data-agent-id="room:picture-consent" />
        <span>{t("planner.consent")}</span>
      </label>
      <div>
        <Button onClick={() => void go()} disabled={!consent || making} data-agent-id="room:picture-go">
          {making ? t("making") : t("planner.go")}
        </Button>
      </div>
      {state.left === null ? null : <p className="text-slate text-xs">{t("left", { count: state.left })}</p>}
      {error === null ? null : (
        <p role="alert" className="text-danger text-sm" data-agent-id="room:picture-error">
          {t.has(`errors.${error}`) ? t(`errors.${error}`) : t("errors.generic")}
        </p>
      )}
    </section>
  );
}
