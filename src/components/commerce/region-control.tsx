"use client";

/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Shows which country prices are for and lets the shopper change it.
 */

import { useLocale, useTranslations } from "next-intl";
import { useEffect, useId, useMemo, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { DialogContent, DialogRoot, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { useRouter } from "@/i18n/navigation";
import { EU_COUNTRIES, formatVatRate, isEuCountry, vatRatePerMille } from "@/lib/commerce/vat";

/**
 * Where prices are shown for, and a way to change it (docs/adr/013).
 *
 * The country is detected from the request, which is often wrong (VPNs,
 * travel, office networks), so the shopper can always correct it. Changing it
 * re-renders the page with the new country's prices; checkout still charges
 * the VAT of the delivery address, and the dialog says so.
 */

export const REGION_EVENT = "vitrine:region";

/** Countries outside the EU that people commonly shop from here; any detected country is added too. */
const ELSEWHERE = ["AL", "AU", "CA", "CH", "GB", "IL", "IS", "JP", "ME", "MK", "NO", "RS", "TR", "UA", "US"];

type RegionState = { country: string; source: "choice" | "location" | "default"; vatRatePerMille: number; inEu: boolean };

function useCountryNames(locale: string) {
  return useMemo(() => {
    const names = new Intl.DisplayNames([locale], { type: "region" });
    return (code: string) => names.of(code) ?? code;
  }, [locale]);
}

export function RegionDialog({ country, children }: { country: string; children: React.ReactNode }) {
  const t = useTranslations("region");
  const locale = useLocale();
  const name = useCountryNames(locale);
  const router = useRouter();
  const toast = useToast();
  const selectId = useId();
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState(country);
  const [pending, startTransition] = useTransition();

  const sortByName = (codes: readonly string[]) => [...codes].sort((a, b) => name(a).localeCompare(name(b), locale));
  const eu = sortByName(EU_COUNTRIES);
  const elsewhere = sortByName([...new Set([...ELSEWHERE, ...(isEuCountry(country) ? [] : [country])])]);

  const save = () =>
    startTransition(async () => {
      const response = await fetch("/api/region", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ country: choice }),
      }).catch(() => null);
      if (response === null || !response.ok) {
        toast({ title: t("failed"), tone: "danger" });
        return;
      }
      setOpen(false);
      window.dispatchEvent(new Event(REGION_EVENT));
      router.refresh();
      toast({ title: t("saved", { country: name(choice) }), tone: "success" });
    });

  return (
    <DialogRoot
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setChoice(country);
      }}
    >
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent title={t("dialogTitle")} description={t("dialogBody")}>
        <div className="flex flex-col gap-5" data-agent-id="region:dialog">
          <div className="flex flex-col gap-2">
            <label htmlFor={selectId} className="text-sm font-medium">
              {t("country")}
            </label>
            <select
              id={selectId}
              value={choice}
              onChange={(event) => setChoice(event.currentTarget.value)}
              className="border-hairline text-dusk hover:border-dusk/35 rounded-plinth h-11 w-full cursor-pointer border bg-white px-3 transition-colors"
            >
              <optgroup label={t("eu")}>
                {eu.map((code) => (
                  <option key={code} value={code}>
                    {name(code)}
                  </option>
                ))}
              </optgroup>
              <optgroup label={t("elsewhere")}>
                {elsewhere.map((code) => (
                  <option key={code} value={code}>
                    {name(code)}
                  </option>
                ))}
              </optgroup>
            </select>
            <p className="text-slate text-sm" aria-live="polite">
              {isEuCountry(choice)
                ? t("vatPreview", { rate: formatVatRate(vatRatePerMille(choice), locale), country: name(choice) })
                : t("noVatPreview", { country: name(choice) })}
            </p>
          </div>
          <div className="flex justify-end gap-3">
            <Button onClick={save} aria-disabled={pending || undefined} data-agent-id="action:save-region">
              {t("save")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </DialogRoot>
  );
}

/** The sentence under a price or in a summary: "Prices for Greece include 24% VAT. Change". */
export function RegionNote({ country, className }: { country: string; className?: string }) {
  const t = useTranslations("region");
  const locale = useLocale();
  const name = useCountryNames(locale);
  const inEu = isEuCountry(country);
  return (
    <p className={className} data-agent-id="region:note">
      {inEu ? t("vatIncludedFor", { rate: formatVatRate(vatRatePerMille(country), locale), country: name(country) }) : t("noVatFor", { country: name(country) })}{" "}
      <RegionDialog country={country}>
        <button type="button" className="text-dusk cursor-pointer underline underline-offset-4">
          {t("change")}
        </button>
      </RegionDialog>
    </p>
  );
}

/** For the footer, which is shared by cached pages: asks the server which country applies. */
export function RegionFooter() {
  const t = useTranslations("region");
  const locale = useLocale();
  const name = useCountryNames(locale);
  const [region, setRegion] = useState<RegionState | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      fetch("/api/region", { cache: "no-store" })
        .then((response) => (response.ok ? (response.json() as Promise<RegionState>) : null))
        .then((data) => {
          if (!cancelled && data !== null) setRegion(data);
        })
        .catch(() => {});
    void load();
    window.addEventListener(REGION_EVENT, load);
    return () => {
      cancelled = true;
      window.removeEventListener(REGION_EVENT, load);
    };
  }, []);

  if (region === null) return <p className="text-slate text-sm">{t("loading")}</p>;
  return (
    <div className="flex flex-col items-start gap-2 text-sm">
      <p className="text-slate">
        {region.inEu
          ? t("footerEu", { country: name(region.country), rate: formatVatRate(region.vatRatePerMille, locale) })
          : t("footerOutside", { country: name(region.country) })}
      </p>
      <RegionDialog country={region.country}>
        <button type="button" className="text-dusk cursor-pointer underline underline-offset-4" data-agent-id="action:change-region">
          {t("change")}
        </button>
      </RegionDialog>
    </div>
  );
}
