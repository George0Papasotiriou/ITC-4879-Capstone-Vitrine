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

import { useConcierge } from "@/components/concierge/concierge-provider";
import { cx as cn } from "@/lib/ui/cx";

/**
 * The Concierge prompt (docs/PLAN.md 4.3).
 *
 * On the home page this is the hero's call to action, not a search box tucked
 * into a header: the whole argument of the product is that describing what you
 * want should be the primary way in.
 *
 * Typing and pressing Enter (or Send) opens the Concierge with the question
 * (docs/adr/019). The microphone opens in Phase 7 and the camera in Phase 9;
 * until then both are marked `disabled` with an honest reason rather than
 * pretending to work — a control that does nothing is worse than one that says
 * why.
 */
export function ConciergePrompt({ className }: { className?: string }) {
  const t = useTranslations("home");
  const c = useTranslations("concierge");
  const { ask } = useConcierge();
  const [value, setValue] = useState("");
  const id = useId();
  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    if (value.trim() === "") return;
    ask(value);
    setValue("");
  };

  return (
    <form
      className={cn(
        "border-hairline bg-white rounded-plinth flex items-end gap-2 border p-2",
        "focus-within:border-dusk/35 transition-colors duration-quick ease-standard",
        className,
      )}
      onSubmit={submit}
      data-agent-id="home:prompt"
    >
      <label htmlFor={id} className="sr-only">
        {t("promptLabel")}
      </label>

      <textarea
        id={id}
        rows={2}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) submit(event);
        }}
        maxLength={2000}
        placeholder={t("promptPlaceholder")}
        // min-w-0 lets the field give way to the buttons on a narrow phone instead of widening the page.
        className="text-dusk placeholder:text-slate/80 min-h-14 min-w-0 flex-1 resize-none bg-transparent px-2 py-2 outline-none"
      />

      <div className="flex items-center gap-1">
        <PromptAction label={t("speak")} note={t("comingSoon")}>
          <MicrophoneGlyph />
        </PromptAction>
        <PromptAction label={t("showPhoto")} note={t("comingSoon")}>
          <CameraGlyph />
        </PromptAction>
        <button
          type="submit"
          disabled={value.trim() === ""}
          className="bg-dusk text-glass rounded-plinth h-11 px-4 text-sm font-medium disabled:opacity-40"
          data-agent-id="home:prompt-send"
        >
          {c("send")}
        </button>
      </div>
    </form>
  );
}

function PromptAction({
  label,
  note,
  children,
}: {
  label: string;
  /** Why the control is unavailable, in the reader's language. */
  note: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      disabled
      aria-label={label}
      title={`${label} (${note})`}
      className={cn(
        "text-slate inline-flex size-11 items-center justify-center rounded-plinth",
        "disabled:cursor-not-allowed disabled:opacity-40",
      )}
    >
      {children}
    </button>
  );
}

function MicrophoneGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3" strokeLinecap="round" />
    </svg>
  );
}

function CameraGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <path d="M3 8.5h3l1.5-2.5h9L18 8.5h3v11H3z" strokeLinejoin="round" />
      <circle cx="12" cy="13.5" r="3.5" />
    </svg>
  );
}
