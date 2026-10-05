"use client";

/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * "Find your size": two body measurements, read against this piece's chart by the Fit Engine, with the reasoning shown.
 */

import { useLocale, useTranslations } from "next-intl";
import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { DialogContent, DialogRoot, DialogTrigger } from "@/components/ui/dialog";
import type { SizeChart } from "@/lib/catalog/capsule";
import { adviseSize, ASKED_MEASURES, engineAdvice, isAdvice, MEASURE_MAX_CM, MEASURE_MIN_CM } from "@/lib/catalog/size-advice";
import type { CapsuleSize } from "@/lib/catalog/taxonomy";
import type { ProductFit } from "@/lib/fit/size/store";
import type { SizeGroup } from "@/lib/prefs/preferences";

/**
 * docs/adr/034. The advice appears as the numbers are typed, with the reason
 * beside it — which measurement decided and what the chart allows — so the
 * shopper can check it rather than take it on trust. Choosing the size fills
 * the picker; keeping it saves it to Your shop (docs/adr/033), the same place
 * the preferences page writes, and only when asked.
 *
 * The Fit Engine (docs/adr/064) chooses the size: how likely each size is to
 * fit this body, allowing for how this piece runs and how forgiving it is
 * (`fit`, learned on the server from its reviews and the shop's returns).
 * The dialog says how sure it is, the size next most likely when it is
 * close, how each measured zone will sit, and which way the piece runs. The
 * chart's own reading of each measurement stays beside it, so the advice can
 * still be checked by hand.
 */

type Props = {
  chart: readonly SizeChart[];
  group: SizeGroup;
  /** Sizes with stock, so the advice can say when the suggested one has gone. */
  inStock: ReadonlySet<string>;
  onChoose: (size: CapsuleSize) => void;
  /** How this piece fits, from the server; without it the engine knows nothing about the piece. */
  fit?: ProductFit;
};

const percent = (p: number) => Math.round(p * 100);

/** "97,5" is how a Greek keyboard writes 97.5. */
const toNumber = (text: string): number | null => {
  const value = Number.parseFloat(text.replace(",", "."));
  return text.trim() === "" || Number.isNaN(value) ? null : value;
};

export function SizeFinder({ chart, group, inStock, onChoose, fit }: Props) {
  const t = useTranslations("product.sizes.finder");
  const groups = useTranslations("prefs.sizes.groups");
  const locale = useLocale();
  const ids = useId();
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<string[]>(() => Array.from({ length: ASKED_MEASURES }, () => ""));
  const [kept, setKept] = useState<"idle" | "saving" | "kept" | "failed">("idle");

  const rows = chart.slice(0, ASKED_MEASURES);
  const name = (index: number) => (locale === "el" ? rows[index]!.measure.el : rows[index]!.measure.en);
  const lower = (index: number) => name(index).toLocaleLowerCase(locale);
  const numbers = values.map(toNumber);
  const result = adviseSize(rows, numbers);
  const advice = isAdvice(result) ? result : null;
  const engine = advice === null ? null : engineAdvice(rows, numbers, fit?.item);
  // The engine decides; the chart's size stands only if the engine has nothing to say.
  const advised: CapsuleSize | null = advice === null ? null : ((engine?.best.size as CapsuleSize | undefined) ?? advice.size);
  const zoneName = (zone: string) => {
    const index = rows.findIndex((row) => row.measure.en === zone);
    return index < 0 ? zone : name(index);
  };

  const keep = async (size: CapsuleSize) => {
    setKept("saving");
    const response = await fetch("/api/preferences", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sizes: { [group]: size } }),
    }).catch(() => null);
    setKept(response?.ok === true ? "kept" : "failed");
  };

  return (
    <DialogRoot
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setKept("idle");
      }}
    >
      <DialogTrigger asChild>
        <button type="button" className="text-dusk min-h-6 cursor-pointer self-start text-sm underline underline-offset-4" data-agent-id="sizes:finder">
          {t("open")}
        </button>
      </DialogTrigger>
      <DialogContent title={t("title")} description={t("description")}>
        <div className="flex flex-col gap-5" data-agent-id="sizes:finder-dialog">
          <div className="grid gap-4 sm:grid-cols-2">
            {rows.map((row, index) => (
              <div key={row.measure.en} className="flex flex-col gap-2">
                <label htmlFor={`${ids}-${index}`} className="text-sm font-medium">
                  {t("measureLabel", { measure: name(index) })}
                </label>
                <div className="relative">
                  <input
                    id={`${ids}-${index}`}
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    value={values[index]}
                    onChange={(event) => {
                      const next = [...values];
                      next[index] = event.target.value.slice(0, 6);
                      setValues(next);
                      setKept("idle");
                    }}
                    aria-describedby={`${ids}-hint`}
                    aria-invalid={"problem" in result && result.problem === "out_of_range" && result.index === index ? true : undefined}
                    data-agent-id={`sizes:measure-${index}`}
                    className="border-hairline text-dusk rounded-plinth h-11 w-full border bg-white px-3 pr-12 tabular-nums"
                  />
                  <span className="text-slate pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-sm" aria-hidden="true">
                    cm
                  </span>
                </div>
              </div>
            ))}
          </div>
          <p id={`${ids}-hint`} className="text-slate -mt-2 text-xs">
            {t("hint", { min: MEASURE_MIN_CM, max: MEASURE_MAX_CM })}
          </p>

          <div role="status" aria-live="polite" className="min-h-[5.5rem]" data-agent-id="sizes:advice">
            {"problem" in result && result.problem === "out_of_range" ? (
              <p className="text-danger text-sm">{t("outOfRange", { measure: lower(result.index), min: MEASURE_MIN_CM, max: MEASURE_MAX_CM })}</p>
            ) : advice === null || advised === null ? (
              <p className="text-slate text-sm">{t("waiting")}</p>
            ) : (
              <div className="border-hairline rounded-plinth flex flex-col gap-2 border bg-white p-4">
                <p className="text-sm">
                  {t("suggested")} <strong className="font-display text-2xl" data-agent-id="sizes:advised">{advised}</strong>
                </p>
                {engine === null || advice.beyondChart ? null : (
                  <p className="text-sm" data-agent-id="sizes:chance">
                    {engine.verdict === "between" && engine.runnerUp !== null
                      ? t("between", {
                          size: engine.best.size,
                          percent: percent(engine.best.probabilities.fit),
                          other: engine.runnerUp.size,
                          otherPercent: percent(engine.runnerUp.probabilities.fit),
                          roomier: engine.best.index > engine.runnerUp.index ? "yes" : "no",
                        })
                      : engine.verdict === "likely" && engine.runnerUp !== null
                        ? t("likely", { percent: percent(engine.best.probabilities.fit), other: engine.runnerUp.size, otherPercent: percent(engine.runnerUp.probabilities.fit) })
                        : t("sure", { percent: percent(engine.best.probabilities.fit) })}
                  </p>
                )}
                <ul className="text-slate flex flex-col gap-1 text-sm">
                  {advice.verdicts.map((verdict) => (
                    <li key={verdict.index}>
                      {verdict.beyondChart
                        ? t("verdictBeyond", { measure: name(verdict.index), cm: verdict.cm, size: verdict.size, upTo: verdict.upToCm })
                        : t("verdict", { measure: name(verdict.index), cm: verdict.cm, size: verdict.size, upTo: verdict.upToCm })}
                    </li>
                  ))}
                </ul>
                {engine === null || advice.beyondChart ? null : (
                  <ul className="flex flex-col gap-1 text-sm" data-agent-id="sizes:zones">
                    {engine.zones.map((zone) => (
                      <li key={zone.zone}>{t(`zone.${zone.word}`, { measure: zoneName(zone.zone), size: engine.best.size })}</li>
                    ))}
                  </ul>
                )}
                {advice.verdicts.length > 1 && advice.apart > 0 && advised === advice.size ? (
                  <p className="text-sm">{advice.apart >= 2 ? t("farApart", { size: advice.size, measure: lower(advice.decidedBy) }) : t("larger", { size: advice.size, measure: lower(advice.decidedBy) })}</p>
                ) : null}
                {fit === undefined || (fit.lean === "true" && fit.cut === "usual") ? null : (
                  <p className="text-sm" data-agent-id="sizes:lean">
                    {[fit.lean === "true" ? null : t(`lean.${fit.lean}`, { source: fit.outcomes === 0 ? "reviews" : fit.remarks === 0 ? "returns" : "both" }), fit.cut === "usual" ? null : t(`cut.${fit.cut}`)].filter((line) => line !== null).join(" ")}
                  </p>
                )}
                {fit === undefined || fit.remarks + fit.outcomes === 0 ? null : (
                  <p className="text-slate text-xs" data-agent-id="sizes:evidence">
                    {t("evidence", { remarks: fit.remarks, outcomes: fit.outcomes })}
                  </p>
                )}
                {advice.beyondChart ? <p className="text-sm">{t("beyond")}</p> : null}
                {inStock.has(advised) ? null : <p className="text-danger text-sm">{t("soldOut", { size: advised })}</p>}
              </div>
            )}
          </div>

          <div className="border-hairline flex flex-wrap items-center gap-3 border-t pt-5">
            <Button
              disabled={advised === null || !inStock.has(advised)}
              onClick={() => {
                if (advised === null) return;
                onChoose(advised);
                setOpen(false);
              }}
              data-agent-id="sizes:choose-advised"
            >
              {advised === null ? t("chooseNone") : t("choose", { size: advised })}
            </Button>
            {advised === null ? null : (
              // The garment group can be long ("tops, shirts, knitwear and coats"): the label wraps rather than widening the dialog.
              <Button variant="secondary" className="h-auto min-h-11 py-2 text-left whitespace-normal" disabled={kept === "saving" || kept === "kept"} onClick={() => void keep(advised)} data-agent-id="sizes:keep-advised">
                {t("keep", { size: advised, group: groups(group).toLocaleLowerCase(locale) })}
              </Button>
            )}
            <p className="text-slate w-full text-xs" role="status">
              {kept === "kept" ? t("kept") : kept === "failed" ? t("keepFailed") : t("private")}
            </p>
          </div>
        </div>
      </DialogContent>
    </DialogRoot>
  );
}
