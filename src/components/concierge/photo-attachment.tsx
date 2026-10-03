"use client";

/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * A photograph attached to a question: pasted, dropped or chosen, shown with its consent, and sent through the shop's photo route.
 */

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useId, useRef, useState, type ClipboardEvent, type DragEvent } from "react";

import { cn } from "@/lib/ui/cn";

/**
 * docs/adr/051. The same attachment in the home page's prompt and in the dock:
 * paste (Ctrl/Cmd+V), drop, or choose a file — on a phone the chooser offers
 * the camera too. Nothing leaves the device until the shopper ticks the consent
 * line and sends: the photograph then goes through `/api/photos` (re-encoded,
 * the camera's metadata dropped, kept a day: docs/adr/023) as a Snap
 * photograph, and the question carries only its id.
 */

/** Types and size the shop's photo route accepts (src/lib/photos/photos.ts), checked here first so a refusal is instant. */
const ACCEPTED = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];
const MAX_BYTES = 12 * 1024 * 1024;

export type PhotoError = "type" | "too_large" | "too_small" | "too_many" | "unreadable" | "no_consent" | "generic";

/** Previews of photographs sent in this tab, by id, so the conversation can show them. Never stored. */
const previews = new Map<string, string>();
export const photoPreview = (id: string) => previews.get(id) ?? null;

/** Sends one photograph through the shop's photo route; the shopper has consented by ticking the line and sending. */
export async function uploadQuestionPhoto(file: File): Promise<{ ok: true; id: string } | { ok: false; reason: PhotoError }> {
  const form = new FormData();
  form.set("file", file);
  form.set("kind", "snap");
  form.set("consent", "yes");
  const response = await fetch("/api/photos", { method: "POST", body: form }).catch(() => null);
  const body = (await response?.json().catch(() => null)) as { ok?: boolean; photo?: { id: string }; reason?: string } | null;
  if (body?.ok === true && body.photo !== undefined) return { ok: true, id: body.photo.id };
  const reason = body?.reason;
  return { ok: false, reason: reason === "type" || reason === "too_large" || reason === "too_small" || reason === "too_many" || reason === "unreadable" || reason === "no_consent" ? reason : "generic" };
}

/** The first image in a paste or a drop, if any. */
function imageIn(list: DataTransfer | null): File | null {
  if (list === null) return null;
  for (const file of Array.from(list.files)) if (file.type.startsWith("image/")) return file;
  for (const item of Array.from(list.items ?? [])) {
    if (item.kind === "file" && item.type.startsWith("image/")) {
      const file = item.getAsFile();
      if (file !== null) return file;
    }
  }
  return null;
}

export type Attachment = {
  file: File;
  preview: string;
  consent: boolean;
};

/**
 * State and handlers for one attachment slot. `send` uploads the photograph
 * (when there is one and the shopper consented) and resolves with its id;
 * `bind` gives a container paste and drop.
 */
export function usePhotoAttachment() {
  const [attachment, setAttachment] = useState<Attachment | null>(null);
  const [error, setError] = useState<PhotoError | null>(null);
  const [sending, setSending] = useState(false);
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);

  // A preview made for a photograph that was never sent is released when it goes.
  useEffect(() => {
    const preview = attachment?.preview;
    return () => {
      if (preview !== undefined && ![...previews.values()].includes(preview)) URL.revokeObjectURL(preview);
    };
  }, [attachment?.preview]);

  const attach = useCallback((file: File) => {
    setError(null);
    if (!ACCEPTED.includes(file.type)) return setError("type");
    if (file.size > MAX_BYTES) return setError("too_large");
    setAttachment({ file, preview: URL.createObjectURL(file), consent: false });
  }, []);

  const remove = useCallback(() => {
    setAttachment(null);
    setError(null);
  }, []);

  const setConsent = useCallback((consent: boolean) => {
    setError(null);
    setAttachment((current) => (current === null ? null : { ...current, consent }));
  }, []);

  /** Uploads the attached photograph; null when there is none; throws nothing — errors are shown. */
  const send = useCallback(async (): Promise<{ ok: true; photoId: string | null } | { ok: false }> => {
    if (attachment === null) return { ok: true, photoId: null };
    if (!attachment.consent) {
      setError("no_consent");
      return { ok: false };
    }
    setSending(true);
    const result = await uploadQuestionPhoto(attachment.file);
    setSending(false);
    if (!result.ok) {
      setError(result.reason);
      return { ok: false };
    }
    previews.set(result.id, attachment.preview);
    setAttachment(null);
    return { ok: true, photoId: result.id };
  }, [attachment]);

  const bind = {
    onPaste: (event: ClipboardEvent) => {
      const file = imageIn(event.clipboardData);
      if (file === null) return;
      event.preventDefault();
      attach(file);
    },
    onDragEnter: (event: DragEvent) => {
      if (!Array.from(event.dataTransfer.types).includes("Files")) return;
      depth.current += 1;
      setDragging(true);
    },
    onDragOver: (event: DragEvent) => {
      if (Array.from(event.dataTransfer.types).includes("Files")) event.preventDefault();
    },
    onDragLeave: () => {
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setDragging(false);
    },
    onDrop: (event: DragEvent) => {
      depth.current = 0;
      setDragging(false);
      const file = imageIn(event.dataTransfer);
      if (file === null) return;
      event.preventDefault();
      attach(file);
    },
  };

  return { attachment, error, sending, dragging, attach, remove, setConsent, send, bind };
}

/** The button that opens the chooser: on a phone it offers the camera as well as the library. */
export function PhotoButton({ onFile, className, label, children }: { onFile: (file: File) => void; className?: string; label: string; children: React.ReactNode }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <button type="button" aria-label={label} title={label} onClick={() => input.current?.click()} className={className} data-agent-id="photo:choose">
        {children}
      </button>
      <input
        ref={input}
        type="file"
        accept="image/*"
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          if (file !== undefined) onFile(file);
          event.currentTarget.value = "";
        }}
        data-agent-id="photo:input"
      />
    </>
  );
}

/** The attached photograph: a thumbnail, the consent line, a way to take it off, and what went wrong. */
export function PhotoChip({ state, className }: { state: ReturnType<typeof usePhotoAttachment>; className?: string }) {
  const t = useTranslations("concierge.photo");
  const id = useId();
  const { attachment, error, sending, remove, setConsent } = state;
  if (attachment === null && error === null) return null;
  return (
    <div className={cn("flex flex-col gap-2", className)} data-agent-id="photo:chip">
      {attachment === null ? null : (
        <div className="animate-rise flex items-start gap-3">
          <span className="border-hairline relative size-16 shrink-0 overflow-hidden rounded-[8px] border bg-white">
            {/* A preview of the shopper's own file, on their own device: an object URL, not something the optimizer could fetch. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={attachment.preview} alt={t("alt")} className={cn("size-full object-cover transition-[filter] duration-300", sending && "blur-[2px] brightness-110")} />
            {sending ? <span className="absolute inset-0 animate-pulse bg-white/30" aria-hidden="true" /> : null}
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <label htmlFor={id} className="text-dusk flex cursor-pointer items-start gap-2 text-sm leading-snug">
              <input id={id} type="checkbox" checked={attachment.consent} onChange={(event) => setConsent(event.currentTarget.checked)} className="accent-dusk mt-0.5 size-4 shrink-0" data-agent-id="photo:consent" />
              <span>{t("consent")}</span>
            </label>
            <button type="button" onClick={remove} className="text-slate hover:text-dusk self-start text-xs underline-offset-2 hover:underline" data-agent-id="photo:remove">
              {sending ? t("sending") : t("remove")}
            </button>
          </div>
        </div>
      )}
      {error === null ? null : (
        <p role="alert" className="text-danger text-sm" data-agent-id="photo:error">
          {t(`errors.${error}`)}
        </p>
      )}
    </div>
  );
}

/** The veil over a form while a photograph is dragged over it. */
export function DropVeil({ show, label }: { show: boolean; label: string }) {
  if (!show) return null;
  return (
    <div className="bg-glass/90 border-dusk/40 pointer-events-none absolute inset-1 z-10 grid place-items-center rounded-[10px] border-2 border-dashed backdrop-blur-[2px]" aria-hidden="true">
      <span className="text-dusk flex items-center gap-2 text-sm font-medium">
        <CameraGlyph />
        {label}
      </span>
    </div>
  );
}

export function CameraGlyph({ className = "size-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <path d="M3 8.5h3l1.5-2.5h9L18 8.5h3v11H3z" strokeLinejoin="round" />
      <circle cx="12" cy="13.5" r="3.5" />
    </svg>
  );
}

export function MicrophoneGlyph({ className = "size-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3" strokeLinecap="round" />
    </svg>
  );
}
