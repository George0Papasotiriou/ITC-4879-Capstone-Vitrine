"use client";

/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * The comfort panel: text size, spacing, contrast, font, motion, links, targets, the reading guide and shortcuts, changed as you watch.
 */

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { COMFORT_OPEN_EVENT, setComfort, useComfort } from "@/components/comfort/comfort-store";
import { requestNumbers } from "@/components/comfort/point-by-number";
import { Button } from "@/components/ui/button";
import { Checkbox, RadioGroup } from "@/components/ui/choice";
import { DialogContent, DialogRoot } from "@/components/ui/dialog";
import { COMFORT_OPTIONS, DEFAULT_COMFORT, type ComfortKey } from "@/lib/comfort/settings";

/**
 * docs/adr/032. Every change applies the moment it is made, behind the panel,
 * so the shopper sees the result rather than imagining it; nothing needs
 * saving, and "Back to the shop's settings" undoes everything at once. The
 * panel is a dialog: focus stays inside it, Escape closes it, and focus goes
 * back to whatever opened it.
 */

/** The on/off settings: the second value of each is "on". */
const TOGGLES = ["spacing", "contrast", "font", "links", "targets", "guide"] as const satisfies readonly ComfortKey[];

export function ComfortPanel({ startOpen = false }: { startOpen?: boolean }) {
  const t = useTranslations("comfort");
  const comfort = useComfort();
  const [open, setOpen] = useState(startOpen);

  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener(COMFORT_OPEN_EVENT, onOpen);
    return () => window.removeEventListener(COMFORT_OPEN_EVENT, onOpen);
  }, []);

  const changed = (Object.keys(DEFAULT_COMFORT) as ComfortKey[]).some((key) => comfort[key] !== DEFAULT_COMFORT[key]);

  return (
    <DialogRoot open={open} onOpenChange={setOpen}>
      <DialogContent title={t("title")} description={t("description")} className="max-w-xl">
        <div className="flex flex-col gap-6" data-agent-id="comfort:panel">
          <RadioGroup
            legend={t("text.legend")}
            value={comfort.text}
            onValueChange={(text) => setComfort({ text })}
            options={COMFORT_OPTIONS.text.map((value) => ({ value, label: t(`text.options.${value}`) }))}
          />

          <fieldset className="flex flex-col">
            <legend className="mb-1 text-sm font-medium">{t("reading")}</legend>
            {TOGGLES.map((key) => (
              <Checkbox
                key={key}
                label={t(`${key}.label`)}
                hint={t(`${key}.hint`)}
                checked={comfort[key] === COMFORT_OPTIONS[key][1]}
                onCheckedChange={(on) => setComfort({ [key]: COMFORT_OPTIONS[key][on ? 1 : 0] })}
              />
            ))}
          </fieldset>

          <RadioGroup
            legend={t("motion.legend")}
            value={comfort.motion}
            onValueChange={(motion) => setComfort({ motion })}
            options={COMFORT_OPTIONS.motion.map((value) => ({ value, label: t(`motion.options.${value}`), hint: t(`motion.hints.${value}`) }))}
          />

          <fieldset className="flex flex-col">
            <legend className="mb-1 text-sm font-medium">{t("controls")}</legend>
            <Checkbox label={t("shortcuts.label")} hint={t("shortcuts.hint")} checked={comfort.shortcuts === "on"} onCheckedChange={(on) => setComfort({ shortcuts: on ? "on" : "off" })} />
            <div className="flex flex-col gap-1 py-2">
              <Button
                variant="secondary"
                size="sm"
                className="self-start"
                onClick={() => {
                  setOpen(false);
                  // After the dialog has gone, so the numbers land on the page rather than on the panel.
                  window.setTimeout(() => requestNumbers({ show: true }), 200);
                }}
                data-agent-id="comfort:numbers"
              >
                {t("numbers.button")}
              </Button>
              <span className="text-slate text-sm">{t("numbers.hint")}</span>
            </div>
          </fieldset>

          <div className="border-hairline flex flex-wrap items-center gap-3 border-t pt-5">
            <Button onClick={() => setOpen(false)} data-agent-id="comfort:done">
              {t("done")}
            </Button>
            {changed ? (
              <Button variant="tertiary" onClick={() => setComfort({ ...DEFAULT_COMFORT })} data-agent-id="comfort:reset">
                {t("reset")}
              </Button>
            ) : null}
            <p className="text-slate w-full text-xs">{t("kept")}</p>
          </div>
        </div>
      </DialogContent>
    </DialogRoot>
  );
}
