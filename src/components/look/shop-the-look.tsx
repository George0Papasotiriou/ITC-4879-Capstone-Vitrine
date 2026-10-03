"use client";

/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Shop the look: a numbered pin on each piece in the shopper's photograph, and the shop's closest pieces for each.
 */

import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";

import type { LookResponse } from "@/app/api/look/route";
import { changeCart } from "@/components/commerce/cart-client";
import { ProductCards } from "@/components/concierge/concierge-parts";
import { Button } from "@/components/ui/button";
import { useHydrated } from "@/components/ui/use-hydrated";
import { cn } from "@/lib/ui/cn";

/**
 * docs/adr/054. The pins sit where the model found each piece; the words
 * under each are what the shop measured there (its colours) and what the
 * model called it. "Add the look" puts the first match of every pin in the
 * cart — one click by the shopper, nothing chosen for them without it.
 * Without a model the page says the shop read the whole photograph's colours
 * instead of pretending to have found pieces.
 */
export function ShopTheLook({ photoId, photoUrl, colourLabels }: { photoId: string; photoUrl: string; colourLabels: Record<string, string> }) {
  const t = useTranslations("look");
  const locale = useLocale();
  const hydrated = useHydrated();
  const [state, setState] = useState<"idle" | "looking" | "done" | "failed">("idle");
  const [answer, setAnswer] = useState<Extract<LookResponse, { ok: true }> | null>(null);
  const [reason, setReason] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const [added, setAdded] = useState<string | null>(null);

  const look = async () => {
    setState("looking");
    setAdded(null);
    const response = await fetch("/api/look", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ photoId, locale }) }).catch(() => null);
    const body = (await response?.json().catch(() => null)) as LookResponse | null;
    if (body?.ok === true) {
      setAnswer(body);
      setActive(0);
      setState("done");
    } else {
      setReason(body?.ok === false ? body.reason : "failed");
      setState("failed");
    }
  };

  const addLook = async () => {
    if (answer === null) return;
    let count = 0;
    for (const pin of answer.pins) {
      const first = pin.products.find((product) => product.inStock);
      if (first === undefined) continue;
      const result = await changeCart({ action: "add", productId: first.id, quantity: 1, locale });
      if (result.ok) count += 1;
    }
    setAdded(t("added", { count }));
  };

  const pins = answer?.pins ?? [];
  const pin = pins[active];
  return (
    <section aria-labelledby="look-title" className="border-hairline flex flex-col gap-5 border-t pt-8" data-agent-id="look:section">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 id="look-title" className="font-display text-2xl">
            {t("title")}
          </h2>
          <p className="text-slate mt-1 max-w-[60ch] text-sm">{t("lede")}</p>
        </div>
        <Button onClick={() => void look()} disabled={!hydrated} aria-disabled={state === "looking"} data-agent-id="look:go">
          {state === "looking" ? t("looking") : state === "done" ? t("again") : t("go")}
        </Button>
      </div>

      {state === "failed" ? (
        <p role="alert" className="text-danger text-sm" data-agent-id="look:error">
          {t.has(`errors.${reason}`) ? t(`errors.${reason}`) : t("errors.failed")}
        </p>
      ) : null}

      {answer === null ? null : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          <figure className="bg-plinth rounded-plinth relative self-start overflow-hidden" data-agent-id="look:photo">
            {/* The shopper's own photograph, from its short-lived link. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={photoUrl} alt={t("photoAlt")} className="block h-auto w-full" />
            {answer.drawn
              ? null
              : pins.map((entry, index) => (
                  <span key={index} aria-hidden="true" className={cn("pointer-events-none absolute rounded-[6px] border-2 transition-opacity duration-quick", index === active ? "border-gilt opacity-100 shadow-[0_0_0_9999px_color-mix(in_oklab,var(--color-dusk)_28%,transparent)]" : "border-white/70 opacity-0")} style={{ left: `${entry.region.x * 100}%`, top: `${entry.region.y * 100}%`, width: `${entry.region.width * 100}%`, height: `${entry.region.height * 100}%` }} />
                ))}
            {answer.drawn
              ? null
              : pins.map((entry, index) => (
                  <button
                    key={index}
                    type="button"
                    aria-pressed={index === active}
                    aria-label={t("pinLabel", { number: index + 1, kind: entry.kind ?? "" })}
                    onClick={() => setActive(index)}
                    className={cn("absolute grid size-8 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full text-sm font-medium shadow-[0_4px_14px_color-mix(in_oklab,var(--color-black)_35%,transparent)] ring-2 ring-white transition-transform duration-quick hover:scale-110", index === active ? "bg-gilt text-dusk" : "bg-dusk text-white")}
                    style={{ left: `${(entry.region.x + entry.region.width / 2) * 100}%`, top: `${(entry.region.y + entry.region.height / 2) * 100}%` }}
                    data-agent-id={`look:pin:${index + 1}`}
                  >
                    {index + 1}
                  </button>
                ))}
          </figure>

          <div className="flex flex-col gap-4">
            {answer.drawn ? (
              <p className="text-slate text-sm" data-agent-id="look:drawn">
                {t("drawn")}
              </p>
            ) : (
              <ol className="flex flex-wrap gap-2" aria-label={t("piecesLabel")}>
                {pins.map((entry, index) => (
                  <li key={index}>
                    <button type="button" aria-pressed={index === active} onClick={() => setActive(index)} className={cn("rounded-full border px-3 py-1 text-sm transition-colors", index === active ? "border-dusk bg-dusk text-glass" : "border-hairline hover:border-dusk/40")} data-agent-id={`look:piece:${index + 1}`}>
                      {index + 1}. {entry.kind}
                    </button>
                  </li>
                ))}
              </ol>
            )}
            {pin === undefined ? null : (
              <div className="flex flex-col gap-3" data-agent-id="look:matches">
                {pin.colours.length === 0 ? null : <p className="text-slate text-sm">{t("measured", { colours: pin.colours.map((colour) => colourLabels[colour] ?? colour).join(", ") })}</p>}
                {pin.products.length === 0 ? <p className="text-slate text-sm">{t("noMatch")}</p> : <ProductCards products={pin.products} />}
              </div>
            )}
            {pins.some((entry) => entry.products.length > 0) && !answer.drawn ? (
              <div className="flex flex-wrap items-center gap-3">
                <Button variant="secondary" onClick={() => void addLook()} data-agent-id="look:add-all">
                  {t("addLook")}
                </Button>
                {added === null ? null : (
                  <p role="status" className="text-sm" data-agent-id="look:added">
                    {added}
                  </p>
                )}
              </div>
            ) : null}
          </div>
        </div>
      )}
    </section>
  );
}
