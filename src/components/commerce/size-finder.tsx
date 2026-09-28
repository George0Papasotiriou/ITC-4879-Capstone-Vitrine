"use client";

/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * "Find your size": two body measurements, read against this piece's chart, with the reasoning shown.
 */

import { useLocale, useTranslations } from "next-intl";
import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { DialogContent, DialogRoot, DialogTrigger } from "@/components/ui/dialog";
import type { SizeChart } from "@/lib/catalog/capsule";
import { adviseSize, ASKED_MEASURES, isAdvice, MEASURE_MAX_CM, MEASURE_MIN_CM } from "@/lib/catalog/size-advice";
import type { CapsuleSize } from "@/lib/catalog/taxonomy";
import type { SizeGroup } from "@/lib/prefs/preferences";

/**
 * docs/adr/034. The advice appears as the numbers are typed, with the reason
 * beside it — which measurement decided and what the chart allows — so the
 * shopper can check it rather than take it on trust. Choosing the size fills
 * the picker; keeping it saves it to Your shop (docs/adr/033), the same place
 * the preferences page writes, and only when asked.
 */

type Props = {
  chart: readonly SizeChart[];
  group: SizeGroup;
  /** Sizes with stock, so the advice can say when the suggested one has gone. */
  inStock: ReadonlySet<string>;
  onChoose: (size: CapsuleSize) => void;
};

/** "97,5" is how a Greek keyboard writes 97.5. */
const toNumber = (text: string): number | null => {
  const value = Number.parseFloat(text.replace(",", "."));
  return text.trim() === "" || Number.isNaN(value) ? null : value;
};

export function SizeFinder({ chart, group, inStock, onChoose }: Props) {
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
            ) : advice === null ? (
              <p className="text-slate text-sm">{t("waiting")}</p>
            ) : (
              <div className="border-hairline rounded-plinth flex flex-col gap-2 border bg-white p-4">
                <p className="text-sm">
                  {t("suggested")} <strong className="font-display text-2xl" data-agent-id="sizes:advised">{advice.size}</strong>
                </p>
                <ul className="text-slate flex flex-col gap-1 text-sm">
                  {advice.verdicts.map((verdict) => (
                    <li key={verdict.index}>
                      {verdict.beyondChart
                        ? t("verdictBeyond", { measure: name(verdict.index), cm: verdict.cm, size: verdict.size, upTo: verdict.upToCm })
                        : t("verdict", { measure: name(verdict.index), cm: verdict.cm, size: verdict.size, upTo: verdict.upToCm })}
                    </li>
                  ))}
                </ul>
                {advice.verdicts.length > 1 && advice.apart > 0 ? (
                  <p className="text-sm">{advice.apart >= 2 ? t("farApart", { size: advice.size, measure: lower(advice.decidedBy) }) : t("larger", { size: advice.size, measure: lower(advice.decidedBy) })}</p>
                ) : null}
                {advice.beyondChart ? <p className="text-sm">{t("beyond")}</p> : null}
                {inStock.has(advice.size) ? null : <p className="text-danger text-sm">{t("soldOut", { size: advice.size })}</p>}
              </div>
            )}
          </div>

          <div className="border-hairline flex flex-wrap items-center gap-3 border-t pt-5">
            <Button
              disabled={advice === null || !inStock.has(advice.size)}
              onClick={() => {
                if (advice === null) return;
                onChoose(advice.size);
                setOpen(false);
              }}
              data-agent-id="sizes:choose-advised"
            >
              {advice === null ? t("chooseNone") : t("choose", { size: advice.size })}
            </Button>
            {advice === null ? null : (
              // The garment group can be long ("tops, shirts, knitwear and coats"): the label wraps rather than widening the dialog.
              <Button variant="secondary" className="h-auto min-h-11 py-2 text-left whitespace-normal" disabled={kept === "saving" || kept === "kept"} onClick={() => void keep(advice.size)} data-agent-id="sizes:keep-advised">
                {t("keep", { size: advice.size, group: groups(group).toLocaleLowerCase(locale) })}
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
