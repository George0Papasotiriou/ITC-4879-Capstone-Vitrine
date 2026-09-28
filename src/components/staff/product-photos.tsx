"use client";

/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * A product's photographs on its edit page, and adding one.
 */

import Image from "next/image";
import { useTranslations } from "next-intl";
import { useId, useRef, useState } from "react";

import type { ProductPhotoResponse } from "@/app/api/staff/products/[id]/photos/route";
import { Button } from "@/components/ui/button";
import { useHydrated } from "@/components/ui/use-hydrated";
import { useRouter } from "@/i18n/navigation";
import { MAX_PRODUCT_PHOTO_BYTES, MIN_PRODUCT_PHOTO_EDGE, PRODUCT_PHOTO_TYPES } from "@/lib/admin/catalog";

/**
 * docs/adr/034. A plain file input (keyboard, screen readers and phones'
 * cameras all work with it), sent as soon as it is chosen. What comes back is
 * said in words: kept, or why not and what to do. A photograph without a
 * white studio ground is kept too, and the note says it will not blend into
 * the plinth like the rest.
 */

export function ProductPhotos({ productId, images, max }: { productId: string; images: readonly { src: string; whiteGround: boolean }[]; max: number }) {
  const t = useTranslations("admin.photos");
  const router = useRouter();
  const hydrated = useHydrated();
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<{ kind: "idle" | "sending" } | { kind: "done"; whiteGround: boolean } | { kind: "refused"; reason: string }>({ kind: "idle" });

  const send = async (file: File) => {
    setState({ kind: "sending" });
    const form = new FormData();
    form.set("file", file);
    const response = await fetch(`/api/staff/products/${productId}/photos`, { method: "POST", body: form }).catch(() => null);
    const result = (await response?.json().catch(() => null)) as ProductPhotoResponse | null;
    if (input.current !== null) input.current.value = "";
    if (result?.ok === true) {
      setState({ kind: "done", whiteGround: result.whiteGround });
      router.refresh();
      return;
    }
    setState({ kind: "refused", reason: result?.ok === false ? result.reason : "failed" });
  };

  const full = images.length >= max;
  const reasons = ["type", "too_large", "too_small", "unreadable", "too_many"];

  return (
    <section aria-labelledby={`${id}-title`} className="flex flex-col gap-4" data-agent-id="product-edit:photos">
      <h2 id={`${id}-title`} className="font-display text-xl">
        {t("title")}
      </h2>
      <p className="text-slate text-sm">{t("lede", { edge: MIN_PRODUCT_PHOTO_EDGE, megabytes: MAX_PRODUCT_PHOTO_BYTES / 1024 / 1024 })}</p>

      {images.length === 0 ? (
        <p className="text-dusk text-sm" data-agent-id="product-edit:no-photos">
          {t("none")}
        </p>
      ) : (
        <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4">
          {images.map((image, index) => (
            <li key={image.src} className="bg-plinth rounded-plinth relative aspect-square overflow-hidden">
              <Image src={image.src} alt={t("photoAlt", { index: index + 1 })} fill sizes="120px" className={image.whiteGround ? "object-contain mix-blend-multiply" : "object-contain"} />
            </li>
          ))}
        </ul>
      )}

      {full ? (
        <p className="text-slate text-sm">{t("full", { max })}</p>
      ) : (
        <div className="flex flex-col gap-2">
          <label htmlFor={`${id}-file`} className="text-sm font-medium">
            {t("add")}
          </label>
          <input
            ref={input}
            id={`${id}-file`}
            type="file"
            accept={PRODUCT_PHOTO_TYPES.join(",")}
            disabled={!hydrated || state.kind === "sending"}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file !== undefined) void send(file);
            }}
            className="file:border-hairline file:rounded-plinth file:text-dusk text-sm file:mr-3 file:h-11 file:cursor-pointer file:border file:bg-white file:px-4"
            data-agent-id="product-edit:photo-file"
          />
        </div>
      )}

      <p role="status" className="text-sm" data-agent-id="product-edit:photo-status">
        {state.kind === "sending"
          ? t("sending")
          : state.kind === "done"
            ? state.whiteGround
              ? t("kept")
              : t("keptScene")
            : state.kind === "refused"
              ? <span className="text-danger">{t(`refused.${reasons.includes(state.reason) ? state.reason : "failed"}`, { edge: MIN_PRODUCT_PHOTO_EDGE, max })}</span>
              : ""}
      </p>
      {state.kind === "refused" ? (
        <Button variant="tertiary" size="sm" className="self-start" onClick={() => input.current?.click()}>
          {t("tryAnother")}
        </Button>
      ) : null}
    </section>
  );
}
