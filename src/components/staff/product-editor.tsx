"use client";

/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * The staff product form: words in both languages, price, earlier price and whether the piece is on sale.
 */

import { useTranslations } from "next-intl";
import { useId, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { useHydrated } from "@/components/ui/use-hydrated";
import { useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/ui/cn";

export type ProductFormValues = {
  titleEn: string;
  titleEl: string;
  descriptionEn: string;
  descriptionEl: string;
  highlightsEn: string;
  highlightsEl: string;
  price: string;
  compareAt: string;
  status: "active" | "archived";
};

type FieldName = keyof ProductFormValues;
const KNOWN_ERRORS = ["required", "too_long", "invalid_price", "compare_not_above", "too_many", "line_too_long"];

/**
 * Sends what was typed; the server parses prices and lines and answers with a
 * message key per field it refuses (src/lib/admin/catalog.ts), so the rules
 * live in one place.
 */
export function ProductEditor({ productId, initial }: { productId: string; initial: ProductFormValues }) {
  const t = useTranslations("admin.edit");
  const router = useRouter();
  const toast = useToast();
  const hydrated = useHydrated();
  const id = useId();
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<FieldName | "form", string>>>({});

  const errorFor = (key: string | undefined) => (key === undefined ? undefined : t(`errors.${KNOWN_ERRORS.includes(key) ? key : "too_long"}`));

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    const data = new FormData(event.currentTarget);
    const details = Object.fromEntries((Object.keys(initial) as FieldName[]).map((key) => [key, String(data.get(key) ?? "")]));
    setPending(true);
    const response = await fetch(`/api/staff/products/${productId}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "details", details }),
    }).catch(() => null);
    const result = (await response?.json().catch(() => null)) as { ok: boolean; changed?: string[]; fields?: Record<string, string> } | null;
    setPending(false);
    if (result?.ok === true) {
      setErrors({});
      toast({ title: (result.changed?.length ?? 0) === 0 ? t("nothingChanged") : t("saved"), tone: "success" });
      router.refresh();
      return;
    }
    if (result?.fields !== undefined) {
      setErrors({ ...Object.fromEntries(Object.entries(result.fields).map(([key, value]) => [key, errorFor(value)])), form: t("fixFields") });
      return;
    }
    setErrors({ form: t("failed") });
  };

  const area = (name: FieldName, label: string, rows: number, hint?: string) => (
    <div className="flex flex-col gap-2">
      <label htmlFor={`${id}-${name}`} className="text-sm font-medium">
        {label}
      </label>
      <textarea
        id={`${id}-${name}`}
        name={name}
        rows={rows}
        defaultValue={initial[name]}
        aria-invalid={errors[name] !== undefined}
        aria-describedby={[hint === undefined ? null : `${id}-${name}-hint`, errors[name] === undefined ? null : `${id}-${name}-error`].filter(Boolean).join(" ") || undefined}
        className={cn("border-hairline text-dusk rounded-plinth hover:border-dusk/35 w-full border bg-white p-3", errors[name] !== undefined && "border-danger")}
        data-agent-id={`product-edit:${name}`}
      />
      {hint === undefined ? null : (
        <p id={`${id}-${name}-hint`} className="text-slate text-sm">
          {hint}
        </p>
      )}
      {errors[name] === undefined ? null : (
        <p id={`${id}-${name}-error`} className="text-danger text-sm">
          {errors[name]}
        </p>
      )}
    </div>
  );

  return (
    <form onSubmit={submit} method="post" noValidate className="flex flex-col gap-10" data-agent-id="product-edit:form">
      <fieldset className="flex flex-col gap-5">
        <legend className="font-display mb-4 text-xl">{t("words")}</legend>
        <div className="grid gap-5 md:grid-cols-2">
          <Field label={t("titleEn")} name="titleEn" defaultValue={initial.titleEn} maxLength={200} error={errors.titleEn} data-agent-id="product-edit:titleEn" />
          <Field label={t("titleEl")} name="titleEl" defaultValue={initial.titleEl} maxLength={200} lang="el" error={errors.titleEl} data-agent-id="product-edit:titleEl" />
          {area("descriptionEn", t("descriptionEn"), 6)}
          {area("descriptionEl", t("descriptionEl"), 6)}
          {area("highlightsEn", t("highlightsEn"), 5, t("highlightsHint"))}
          {area("highlightsEl", t("highlightsEl"), 5, t("highlightsHint"))}
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-5">
        <legend className="font-display mb-4 text-xl">{t("prices")}</legend>
        <div className="grid gap-5 md:grid-cols-2">
          <Field label={t("price")} name="price" inputMode="decimal" defaultValue={initial.price} hint={t("priceHint")} error={errors.price} className="max-w-xs" data-agent-id="product-edit:price" />
          <Field label={t("compareAt")} name="compareAt" inputMode="decimal" defaultValue={initial.compareAt} hint={t("compareAtHint")} error={errors.compareAt} className="max-w-xs" data-agent-id="product-edit:compareAt" />
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-3">
        <legend className="font-display mb-4 text-xl">{t("availability")}</legend>
        {(["active", "archived"] as const).map((status) => (
          <label key={status} className="flex cursor-pointer items-start gap-3">
            <input type="radio" name="status" value={status} defaultChecked={initial.status === status} className="accent-dusk mt-1 size-4" data-agent-id={`product-edit:status:${status}`} />
            <span>
              <span className="block font-medium">{status === "active" ? t("statusActive") : t("statusArchived")}</span>
              <span className="text-slate block text-sm">{status === "active" ? t("statusActiveHint") : t("statusArchivedHint")}</span>
            </span>
          </label>
        ))}
      </fieldset>

      {errors.form === undefined ? null : (
        <p role="alert" className="text-danger text-sm" data-agent-id="form:error">
          {errors.form}
        </p>
      )}
      <div>
        <Button type="submit" disabled={!hydrated} aria-disabled={pending} data-agent-id="product-edit:save">
          {pending ? t("saving") : t("save")}
        </Button>
      </div>
    </form>
  );
}
