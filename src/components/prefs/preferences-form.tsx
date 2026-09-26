"use client";

/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * "Your shop": the shopper's sizes, rooms, likes and budget, each kept the moment it is chosen.
 */

import { useTranslations } from "next-intl";
import { useId, useState, type FormEvent } from "react";

import type { PreferencesResponse } from "@/app/api/preferences/route";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Field } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { useHydrated } from "@/components/ui/use-hydrated";
import { CAPSULE_SIZES } from "@/lib/catalog/taxonomy";
import { MAX_ROOMS, SIZE_GROUPS, type Preferences, type PreferencesPatch } from "@/lib/prefs/preferences";

/**
 * docs/adr/033. Every choice is kept as it is made, like the comfort settings:
 * nothing to forget to save. A size is a row of buttons, pressed or not; a
 * room is a name and a wall; likes are the same words the shop's filters use.
 */

type Choice = { id: string; label: string };

export function PreferencesForm({ initial, colors, materials }: { initial: Preferences; colors: readonly Choice[]; materials: readonly Choice[] }) {
  const t = useTranslations("prefs");
  const toast = useToast();
  const hydrated = useHydrated();
  const formId = useId();
  const [prefs, setPrefs] = useState(initial);
  const [pending, setPending] = useState(false);
  const [roomError, setRoomError] = useState<string | null>(null);

  const save = async (patch: PreferencesPatch, announce?: string) => {
    setPending(true);
    const response = await fetch("/api/preferences", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(patch) }).catch(() => null);
    const result = (await response?.json().catch(() => null)) as PreferencesResponse | null;
    setPending(false);
    if (result === null || !result.ok) {
      toast({ title: t("failed"), tone: "danger" });
      return false;
    }
    setPrefs(result.preferences);
    if (announce !== undefined) toast({ title: announce, tone: "success" });
    return true;
  };

  const toggleWord = (list: "like" | "avoid", kind: "colors" | "materials", id: string) => {
    const current = prefs[list][kind];
    const next = current.includes(id) ? current.filter((word) => word !== id) : [...current, id].slice(0, 12);
    void save({ [list]: { [kind]: next } });
  };

  const addRoom = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const name = String(data.get("name") ?? "").trim();
    const wallCm = Math.round(Number(String(data.get("wall") ?? "").replace(",", ".")));
    const depthRaw = String(data.get("depth") ?? "").trim();
    const depthCm = depthRaw === "" ? undefined : Math.round(Number(depthRaw.replace(",", ".")));
    if (name === "" || !Number.isFinite(wallCm) || wallCm < 50 || wallCm > 2000 || (depthCm !== undefined && (!Number.isFinite(depthCm) || depthCm < 30 || depthCm > 2000))) {
      setRoomError(t("rooms.invalid"));
      return;
    }
    setRoomError(null);
    const form = event.currentTarget;
    if (await save({ rooms: [...prefs.rooms, { name, wallCm, ...(depthCm === undefined ? {} : { depthCm }) }] }, t("rooms.added", { name }))) form.reset();
  };

  const saveBudget = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const raw = String(new FormData(event.currentTarget).get("budget") ?? "").trim();
    const value = raw === "" ? null : Math.round(Number(raw.replace(",", ".")));
    if (value !== null && (!Number.isFinite(value) || value < 10 || value > 50_000)) {
      toast({ title: t("budget.invalid"), tone: "danger" });
      return;
    }
    void save({ budgetEuros: value }, value === null ? t("budget.cleared") : t("budget.saved"));
  };

  const words = (list: "like" | "avoid", kind: "colors" | "materials", choices: readonly Choice[]) => (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-sm font-medium">{t(`${list}.${kind}`)}</legend>
      <div className="flex flex-wrap gap-2">
        {choices.map((choice) => (
          <Chip key={choice.id} selected={prefs[list][kind].includes(choice.id)} onToggle={() => toggleWord(list, kind, choice.id)} disabled={!hydrated} data-agent-id={`prefs:${list}:${kind}:${choice.id}`}>
            {choice.label}
          </Chip>
        ))}
      </div>
    </fieldset>
  );

  return (
    <div className="flex flex-col gap-12" aria-busy={pending || undefined} data-agent-id="prefs:form">
      <section aria-labelledby={`${formId}-sizes`} className="flex flex-col gap-4">
        <div>
          <h2 id={`${formId}-sizes`} className="font-display text-xl">
            {t("sizes.title")}
          </h2>
          <p className="text-slate mt-1 text-sm">{t("sizes.lede")}</p>
        </div>
        {SIZE_GROUPS.map((group) => (
          <div key={group} className="flex flex-col gap-2" role="group" aria-label={t(`sizes.groups.${group}`)}>
            <p className="text-sm font-medium" aria-hidden="true">
              {t(`sizes.groups.${group}`)}
            </p>
            <div className="flex flex-wrap gap-2">
              {CAPSULE_SIZES.map((size) => (
                <Chip
                  key={size}
                  selected={prefs.sizes[group] === size}
                  // Pressing the chosen size again clears it.
                  onToggle={() => void save({ sizes: { [group]: prefs.sizes[group] === size ? null : size } })}
                  disabled={!hydrated}
                  data-agent-id={`prefs:size:${group}:${size}`}
                >
                  {size}
                </Chip>
              ))}
            </div>
          </div>
        ))}
      </section>

      <section aria-labelledby={`${formId}-rooms`} className="flex flex-col gap-4">
        <div>
          <h2 id={`${formId}-rooms`} className="font-display text-xl">
            {t("rooms.title")}
          </h2>
          <p className="text-slate mt-1 text-sm">{t("rooms.lede")}</p>
        </div>
        {prefs.rooms.length === 0 ? (
          <p className="text-slate text-sm">{t("rooms.none")}</p>
        ) : (
          <ul className="border-hairline divide-hairline divide-y border-y" data-agent-id="prefs:rooms">
            {prefs.rooms.map((room, index) => (
              <li key={`${room.name}-${index}`} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <span>
                  <span className="font-medium">{room.name}</span>
                  <span className="text-slate tabular ml-2 text-sm">{room.depthCm === undefined ? t("rooms.wall", { wall: room.wallCm }) : t("rooms.wallDepth", { wall: room.wallCm, depth: room.depthCm })}</span>
                </span>
                <Button variant="tertiary" size="sm" disabled={!hydrated} onClick={() => void save({ rooms: prefs.rooms.filter((_, position) => position !== index) }, t("rooms.removed", { name: room.name }))} data-agent-id={`prefs:room:${index}:remove`}>
                  {t("remove")}
                </Button>
              </li>
            ))}
          </ul>
        )}
        {prefs.rooms.length < MAX_ROOMS ? (
          <form onSubmit={addRoom} className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end" data-agent-id="prefs:add-room">
            <Field label={t("rooms.name")} name="name" maxLength={40} placeholder={t("rooms.namePlaceholder")} />
            <Field label={t("rooms.wallLabel")} name="wall" inputMode="numeric" error={roomError ?? undefined} />
            <Field label={t("rooms.depthLabel")} name="depth" inputMode="numeric" hint={t("rooms.optional")} />
            <Button type="submit" variant="secondary" disabled={!hydrated} data-agent-id="prefs:room:add">
              {t("rooms.add")}
            </Button>
          </form>
        ) : null}
      </section>

      <section aria-labelledby={`${formId}-likes`} className="flex flex-col gap-5">
        <div>
          <h2 id={`${formId}-likes`} className="font-display text-xl">
            {t("likes.title")}
          </h2>
          <p className="text-slate mt-1 text-sm">{t("likes.lede")}</p>
        </div>
        {words("like", "colors", colors)}
        {words("like", "materials", materials)}
        <details className="group">
          <summary className="cursor-pointer text-sm font-medium underline-offset-4 hover:underline">{t("avoid.title")}</summary>
          <div className="mt-4 flex flex-col gap-5">
            {words("avoid", "colors", colors)}
            {words("avoid", "materials", materials)}
          </div>
        </details>
      </section>

      <section aria-labelledby={`${formId}-budget`} className="flex flex-col gap-4">
        <div>
          <h2 id={`${formId}-budget`} className="font-display text-xl">
            {t("budget.title")}
          </h2>
          <p className="text-slate mt-1 text-sm">{t("budget.lede")}</p>
        </div>
        <form onSubmit={saveBudget} className="flex flex-wrap items-end gap-3" data-agent-id="prefs:budget">
          <Field label={t("budget.label")} name="budget" inputMode="numeric" defaultValue={prefs.budgetEuros === null ? "" : String(prefs.budgetEuros)} className="w-40" />
          <Button type="submit" variant="secondary" disabled={!hydrated} data-agent-id="prefs:budget:save">
            {t("budget.save")}
          </Button>
        </form>
      </section>
    </div>
  );
}
