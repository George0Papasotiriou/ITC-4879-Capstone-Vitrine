"use client";

/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Concierge prompt input used as the home page call to action.
 */

import { useTranslations } from "next-intl";
import { useId, useState, type FormEvent } from "react";

import { useConciergeShell } from "@/components/concierge/concierge-shell";
import { CameraGlyph, DropVeil, MicrophoneGlyph, PhotoButton, PhotoChip, usePhotoAttachment } from "@/components/concierge/photo-attachment";
import { cx as cn } from "@/lib/ui/cx";

/**
 * The Concierge prompt (docs/PLAN.md 4.3).
 *
 * On the home page this is the hero's call to action, not a search box tucked
 * into a header: the whole argument of the product is that describing what you
 * want should be the primary way in. Three ways in, as the placeholder says:
 *
 * - type, and Enter or Send opens the Concierge with the question (docs/adr/019);
 * - the microphone opens the Concierge already listening (docs/adr/026, 051);
 * - the camera, a paste or a drop attaches a photograph of a room or a piece,
 *   which goes with the question once the shopper ticks its consent line
 *   (docs/adr/051). On a phone the chooser offers the camera itself.
 */
export function ConciergePrompt({ className }: { className?: string }) {
  const t = useTranslations("home");
  const c = useTranslations("concierge");
  const { ask, listen, warm } = useConciergeShell();
  const [value, setValue] = useState("");
  const photo = usePhotoAttachment();
  const id = useId();
  const empty = value.trim() === "" && photo.attachment === null;

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    if (empty || photo.sending) return;
    const sent = await photo.send();
    if (!sent.ok) return;
    ask(value, sent.photoId === null ? undefined : { photoId: sent.photoId });
    setValue("");
  };

  return (
    <form
      className={cn(
        "border-hairline bg-white rounded-plinth relative flex flex-col gap-2 border p-2",
        "focus-within:border-dusk/35 transition-colors duration-quick ease-standard",
        photo.dragging && "border-dusk/45",
        className,
      )}
      onSubmit={(event) => void submit(event)}
      // Typing here is the moment to fetch the Concierge, before the question is sent (docs/adr/034).
      onFocus={warm}
      onPointerEnter={warm}
      {...photo.bind}
      data-agent-id="home:prompt"
    >
      <DropVeil show={photo.dragging} label={c("photo.drop")} />
      <label htmlFor={id} className="sr-only">
        {t("promptLabel")}
      </label>

      <div className="flex items-end gap-2">
        <textarea
          id={id}
          rows={2}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) void submit(event);
          }}
          maxLength={2000}
          placeholder={t("promptPlaceholder")}
          // min-w-0 lets the field give way to the buttons on a narrow phone instead of widening the page.
          className="text-dusk placeholder:text-slate/80 min-h-14 min-w-0 flex-1 resize-none bg-transparent px-2 py-2 outline-none"
        />

        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label={t("speak")}
            title={t("speak")}
            onClick={listen}
            className="text-slate hover:text-dusk hover:bg-plinth rounded-plinth inline-flex size-11 items-center justify-center transition-colors"
            data-agent-id="home:prompt-speak"
          >
            <MicrophoneGlyph />
          </button>
          <PhotoButton
            onFile={photo.attach}
            label={t("showPhoto")}
            className="text-slate hover:text-dusk hover:bg-plinth rounded-plinth inline-flex size-11 items-center justify-center transition-colors"
          >
            <CameraGlyph />
          </PhotoButton>
          <button
            type="submit"
            disabled={empty || photo.sending}
            className="bg-dusk text-glass rounded-plinth h-11 px-4 text-sm font-medium disabled:opacity-40"
            data-agent-id="home:prompt-send"
          >
            {c("send")}
          </button>
        </div>
      </div>

      <PhotoChip state={photo} className="px-2 pb-1" />
    </form>
  );
}
