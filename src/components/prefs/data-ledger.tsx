"use client";

/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * "What we know about you": every preference, setting and recorded visit, each with its own delete, and the whole as a file.
 */

import { useFormatter, useLocale, useTranslations } from "next-intl";
import { useState } from "react";

import { openComfortPanel, setComfort } from "@/components/comfort/comfort-store";
import { Button } from "@/components/ui/button";
import { DialogClose, DialogContent, DialogRoot } from "@/components/ui/dialog";
import { SmartLink } from "@/components/ui/smart-link";
import { useToast } from "@/components/ui/toast";
import { useHydrated } from "@/components/ui/use-hydrated";
import { useRouter } from "@/i18n/navigation";
import { COMFORT_KEYS, DEFAULT_COMFORT } from "@/lib/comfort/settings";
import { SIZE_GROUPS, type PreferencesPatch } from "@/lib/prefs/preferences";
import type { Ledger } from "@/lib/prefs/ledger";

/**
 * docs/adr/033. Read from where the data is kept, never from a description of
 * it; one line per thing kept, and a delete next to each. "Delete everything"
 * asks once, in words, what will go and what stays.
 */

export function DataLedger({ ledger, labels }: { ledger: Ledger; labels: { colors: Record<string, string>; materials: Record<string, string> } }) {
  const t = useTranslations("ledger");
  const locale = useLocale();
  const format = useFormatter();
  const toast = useToast();
  const router = useRouter();
  const hydrated = useHydrated();
  const [history, setHistory] = useState(ledger.history);
  const [confirm, setConfirm] = useState(false);
  const prefs = ledger.preferences;

  const change = async (patch: PreferencesPatch) => {
    const response = await fetch("/api/preferences", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(patch) }).catch(() => null);
    if (response?.ok !== true) {
      toast({ title: t("failed"), tone: "danger" });
      return;
    }
    toast({ title: t("removed"), tone: "success" });
    router.refresh();
  };

  const forgetView = async (id: string) => {
    const response = await fetch("/api/my-data", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "forget-view", id }) }).catch(() => null);
    if (response?.ok !== true) {
      toast({ title: t("failed"), tone: "danger" });
      return;
    }
    setHistory((entries) => entries.filter((entry) => entry.id !== id));
    toast({ title: t("removed"), tone: "success" });
  };

  const forgetEverything = async () => {
    const response = await fetch("/api/my-data", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "forget-everything" }) }).catch(() => null);
    setConfirm(false);
    if (response?.ok !== true) {
      toast({ title: t("failed"), tone: "danger" });
      return;
    }
    // The device's own copy of the comfort settings goes with the rest.
    setComfort({ ...DEFAULT_COMFORT });
    setHistory([]);
    toast({ title: t("everythingGone"), tone: "success" });
    router.refresh();
  };

  const row = (key: string, label: string, onRemove: () => void) => (
    <li key={key} className="flex flex-wrap items-center justify-between gap-3 py-3">
      <span>{label}</span>
      <Button variant="tertiary" size="sm" disabled={!hydrated} onClick={onRemove} data-agent-id={`ledger:remove:${key}`}>
        {t("remove")}
      </Button>
    </li>
  );

  const preferenceRows = [
    ...SIZE_GROUPS.flatMap((group) => (prefs.sizes[group] === undefined ? [] : [row(`size-${group}`, t("size", { group: t(`groups.${group}`), size: prefs.sizes[group]! }), () => void change({ sizes: { [group]: null } }))])),
    ...prefs.rooms.map((room, index) => row(`room-${index}`, t("room", { name: room.name, wall: room.wallCm }), () => void change({ rooms: prefs.rooms.filter((_, position) => position !== index) }))),
    ...(["like", "avoid"] as const).flatMap((list) =>
      (["colors", "materials"] as const).flatMap((kind) =>
        prefs[list][kind].map((word) =>
          row(`${list}-${kind}-${word}`, t(list, { item: labels[kind][word] ?? word }), () => void change({ [list]: { [kind]: prefs[list][kind].filter((other) => other !== word) } })),
        ),
      ),
    ),
    ...(prefs.budgetEuros === null ? [] : [row("budget", t("budget", { amount: prefs.budgetEuros }), () => void change({ budgetEuros: null }))]),
  ];

  const comfortRows = COMFORT_KEYS.filter((key) => ledger.comfort[key] !== DEFAULT_COMFORT[key]).map((key) => (
    <li key={key} className="py-3">
      {t(`comfort.${key}`, { value: ledger.comfort[key] })}
    </li>
  ));

  return (
    <div className="flex flex-col gap-12" data-agent-id="ledger">
      <section aria-labelledby="ledger-preferences" className="flex flex-col gap-3">
        <h2 id="ledger-preferences" className="font-display text-xl">
          {t("preferencesTitle")}
        </h2>
        <p className="text-slate text-sm">{ledger.preferencesKept === "account" ? t("keptAccount") : t("keptDevice")}</p>
        {preferenceRows.length === 0 ? (
          <p className="text-slate text-sm" data-agent-id="ledger:preferences-empty">
            {t("preferencesNone")}
          </p>
        ) : (
          <ul className="border-hairline divide-hairline divide-y border-y" data-agent-id="ledger:preferences">
            {preferenceRows}
          </ul>
        )}
        <SmartLink href="/account/preferences" className="self-start text-sm underline underline-offset-4">
          {t("editPreferences")}
        </SmartLink>
      </section>

      <section aria-labelledby="ledger-comfort" className="flex flex-col gap-3">
        <h2 id="ledger-comfort" className="font-display text-xl">
          {t("comfortTitle")}
        </h2>
        {comfortRows.length === 0 ? <p className="text-slate text-sm">{t("comfortNone")}</p> : <ul className="border-hairline divide-hairline divide-y border-y">{comfortRows}</ul>}
        <Button variant="tertiary" size="sm" className="self-start" onClick={openComfortPanel}>
          {t("editComfort")}
        </Button>
      </section>

      <section aria-labelledby="ledger-history" className="flex flex-col gap-3">
        <h2 id="ledger-history" className="font-display text-xl">
          {t("historyTitle")}
        </h2>
        <p className="text-slate text-sm">{ledger.personalization ? t("historyOn") : t("historyOff")}</p>
        {history.length === 0 ? null : (
          <ul className="border-hairline divide-hairline divide-y border-y" data-agent-id="ledger:history">
            {history.map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <span className="flex flex-col">
                  <SmartLink href={`/p/${entry.slug}`} className="underline-offset-4 hover:underline">
                    {entry.title}
                  </SmartLink>
                  <span className="text-slate text-sm">
                    {t(`kinds.${entry.kind}`)}, {format.dateTime(new Date(entry.at), { dateStyle: "medium", timeStyle: "short" })}
                  </span>
                </span>
                <Button variant="tertiary" size="sm" disabled={!hydrated} onClick={() => void forgetView(entry.id)} data-agent-id={`ledger:forget:${entry.id}`}>
                  {t("forget")}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="ledger-elsewhere" className="flex flex-col gap-3">
        <h2 id="ledger-elsewhere" className="font-display text-xl">
          {t("elsewhereTitle")}
        </h2>
        <p className="text-slate max-w-[60ch] text-sm">{ledger.account === null ? t("elsewhereGuest") : t("elsewhereAccount", { email: ledger.account.email })}</p>
      </section>

      <div className="border-hairline flex flex-wrap items-center gap-3 border-t pt-6">
        <a href={`/api/my-data?locale=${locale}`} download className="border-hairline text-dusk rounded-plinth press inline-flex h-11 items-center border px-5" data-agent-id="ledger:download">
          {t("download")}
        </a>
        <Button variant="danger" disabled={!hydrated} onClick={() => setConfirm(true)} data-agent-id="ledger:delete-everything">
          {t("deleteEverything")}
        </Button>
      </div>

      <DialogRoot open={confirm} onOpenChange={setConfirm}>
        <DialogContent title={t("confirmTitle")} description={t("confirmBody")}>
          <div className="flex flex-wrap gap-3">
            <Button variant="danger" onClick={() => void forgetEverything()} data-agent-id="ledger:confirm-delete">
              {t("confirmYes")}
            </Button>
            <DialogClose asChild>
              <Button variant="secondary">{t("confirmNo")}</Button>
            </DialogClose>
          </div>
        </DialogContent>
      </DialogRoot>
    </div>
  );
}
