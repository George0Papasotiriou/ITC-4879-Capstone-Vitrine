"use client";

/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * "Your rooms" beside the room planner: whether this piece fits each saved wall, and saving another room.
 */

import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { useRouter } from "@/i18n/navigation";
import type { Room, RoomFit } from "@/lib/prefs/preferences";
import { MAX_ROOMS, withRoom } from "@/lib/prefs/rooms";
import { cn } from "@/lib/ui/cn";

/**
 * docs/adr/034. The planner answers "how does it look"; this answers "does it
 * fit", from the wall widths the shopper typed, never from the photograph —
 * the photograph stays in the browser and is never kept (docs/adr/014). A
 * room saved here is the same room as on Your shop, so the home page's
 * "Fits your space" and every product page use it too.
 */
export function YourRooms({ rooms, fits, product, highlight }: { rooms: readonly Room[]; fits: readonly RoomFit[]; product: string; highlight?: string }) {
  const t = useTranslations("room.yourRooms");
  const prefs = useTranslations("prefs.rooms");
  const toast = useToast();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const name = String(data.get("name") ?? "").trim();
    const wallCm = Math.round(Number(String(data.get("wall") ?? "").replace(",", ".")));
    const depthRaw = String(data.get("depth") ?? "").trim();
    const depthCm = depthRaw === "" ? undefined : Math.round(Number(depthRaw.replace(",", ".")));
    if (name === "" || name.length > 40 || !Number.isFinite(wallCm) || wallCm < 50 || wallCm > 2000 || (depthCm !== undefined && (!Number.isFinite(depthCm) || depthCm < 30 || depthCm > 2000))) {
      setError(prefs("invalid"));
      return;
    }
    const next = withRoom(rooms, { name, wallCm, ...(depthCm === undefined ? {} : { depthCm }) });
    if (next === null) {
      setError(t("full", { max: MAX_ROOMS }));
      return;
    }
    setError(null);
    setPending(true);
    const response = await fetch("/api/preferences", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ rooms: next }) }).catch(() => null);
    setPending(false);
    if (response?.ok !== true) {
      toast({ title: t("failed"), tone: "danger" });
      return;
    }
    form.reset();
    toast({ title: prefs("added", { name }), tone: "success" });
    // The server works the fit out again, with the new room.
    router.refresh();
  };

  return (
    <section className="border-hairline mt-12 grid gap-10 border-t pt-10 lg:grid-cols-2" aria-labelledby="your-rooms-title" data-agent-id="room:your-rooms">
      <div>
        <h2 id="your-rooms-title" className="font-display text-2xl">
          {t("title")}
        </h2>
        <p className="text-slate mt-2 max-w-[52ch] text-sm">{t("lede", { product })}</p>
        {fits.length === 0 ? (
          <p className="text-slate mt-5 text-sm" data-agent-id="room:no-rooms">
            {t("none")}
          </p>
        ) : (
          <ul className="border-hairline divide-hairline mt-5 divide-y border-y text-sm" data-agent-id="room:fits">
            {fits.map((fit) => (
              <li
                key={fit.room}
                className={cn("flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3", highlight !== undefined && fit.room.toLocaleLowerCase() === highlight.toLocaleLowerCase() && "bg-dusk/[0.04] -mx-3 px-3")}
                data-agent-id={`room:fit:${fit.room}`}
              >
                <span className="font-medium">{fit.room}</span>
                <span className={fit.fits ? "text-success" : "text-slate"}>
                  {fit.fits ? t("fits", { wall: fit.wallCm, spare: fit.spareCm }) : t("tooBig", { wall: fit.wallCm })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <form onSubmit={(event) => void save(event)} className="flex flex-col gap-4" aria-labelledby="save-room-title" noValidate>
        <h3 id="save-room-title" className="font-display text-xl">
          {t("saveTitle")}
        </h3>
        <p className="text-slate -mt-2 text-sm">{t("saveLede")}</p>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label={prefs("name")} name="name" maxLength={40} placeholder={prefs("namePlaceholder")} data-agent-id="room:save-name" />
          <Field label={prefs("wallLabel")} name="wall" inputMode="numeric" error={error ?? undefined} data-agent-id="room:save-wall" />
          <Field label={prefs("depthLabel")} name="depth" inputMode="numeric" hint={prefs("optional")} data-agent-id="room:save-depth" />
        </div>
        <Button type="submit" variant="secondary" className="self-start" disabled={pending} data-agent-id="room:save">
          {t("save")}
        </Button>
      </form>
    </section>
  );
}
