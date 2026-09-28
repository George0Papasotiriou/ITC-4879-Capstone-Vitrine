"use client";

/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * The form that makes a new product as a draft: kind, words, price, stock and measurements.
 */

import { useTranslations } from "next-intl";
import { useId, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { useHydrated } from "@/components/ui/use-hydrated";
import { useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/ui/cn";

/**
 * docs/adr/034. Only what a product needs to exist: the rest (selling points,
 * a "was" price) is on the edit page, where the photographs are added and the
 * draft is published. The server checks everything again; the form only
 * shows its answer beside each field.
 */

export type KindGroup = { category: string; label: string; kinds: { value: string; label: string }[] };

const FIELDS = ["kind", "titleEn", "titleEl", "descriptionEn", "descriptionEl", "price", "stock", "width", "depth", "height"] as const;
type FieldName = (typeof FIELDS)[number];
const KNOWN_ERRORS = ["required", "too_long", "invalid_price", "whole_number", "invalid_size", "all_three"];

export function NewProductForm({ groups }: { groups: readonly KindGroup[] }) {
  const t = useTranslations("admin.create");
  const edit = useTranslations("admin.edit");
  const router = useRouter();
  const hydrated = useHydrated();
  const id = useId();
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<FieldName | "form", string>>>({});

  const errorFor = (key: string) => t(`errors.${KNOWN_ERRORS.includes(key) ? key : "required"}`);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    const data = new FormData(event.currentTarget);
    const details = Object.fromEntries(FIELDS.map((key) => [key, String(data.get(key) ?? "")]));
    setPending(true);
    const response = await fetch("/api/staff/products", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ details }) }).catch(() => null);
    const result = (await response?.json().catch(() => null)) as { ok: boolean; id?: string; fields?: Record<string, string> } | null;
    if (result?.ok === true && result.id !== undefined) {
      // On to the photographs, on the new product's own page.
      router.push(`/staff/products/${result.id}?created=1`);
      return;
    }
    setPending(false);
    if (result?.fields !== undefined) {
      setErrors({ ...Object.fromEntries(Object.entries(result.fields).map(([key, value]) => [key, errorFor(value)])), form: edit("fixFields") });
      return;
    }
    setErrors({ form: t("failed") });
  };

  const area = (name: "descriptionEn" | "descriptionEl", label: string) => (
    <div className="flex flex-col gap-2">
      <label htmlFor={`${id}-${name}`} className="text-sm font-medium">
        {label}
      </label>
      <textarea
        id={`${id}-${name}`}
        name={name}
        rows={5}
        lang={name === "descriptionEl" ? "el" : undefined}
        className="border-hairline text-dusk rounded-plinth hover:border-dusk/35 w-full border bg-white p-3"
        data-agent-id={`product-new:${name}`}
      />
    </div>
  );

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-10" data-agent-id="product-new:form">
      <fieldset className="flex flex-col gap-3">
        <legend className="font-display mb-4 text-xl">{t("what")}</legend>
        <label htmlFor={`${id}-kind`} className="text-sm font-medium">
          {t("kind")}
        </label>
        <select
          id={`${id}-kind`}
          name="kind"
          defaultValue=""
          aria-invalid={errors.kind !== undefined}
          aria-describedby={errors.kind === undefined ? `${id}-kind-hint` : `${id}-kind-hint ${id}-kind-error`}
          className={cn("border-hairline text-dusk rounded-plinth h-11 max-w-sm border bg-white px-3", errors.kind !== undefined && "border-danger")}
          data-agent-id="product-new:kind"
        >
          <option value="" disabled>
            {t("kindChoose")}
          </option>
          {groups.map((group) => (
            <optgroup key={group.category} label={group.label}>
              {group.kinds.map((kind) => (
                <option key={kind.value} value={kind.value}>
                  {kind.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <p id={`${id}-kind-hint`} className="text-slate text-sm">
          {t("kindHint")}
        </p>
        {errors.kind === undefined ? null : (
          <p id={`${id}-kind-error`} className="text-danger text-sm">
            {errors.kind}
          </p>
        )}
      </fieldset>

      <fieldset className="flex flex-col gap-5">
        <legend className="font-display mb-4 text-xl">{edit("words")}</legend>
        <div className="grid gap-5 md:grid-cols-2">
          <Field label={edit("titleEn")} name="titleEn" maxLength={200} error={errors.titleEn} data-agent-id="product-new:titleEn" />
          <Field label={edit("titleEl")} name="titleEl" maxLength={200} lang="el" hint={t("optional")} error={errors.titleEl} data-agent-id="product-new:titleEl" />
          {area("descriptionEn", edit("descriptionEn"))}
          {area("descriptionEl", edit("descriptionEl"))}
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-5">
        <legend className="font-display mb-4 text-xl">{t("priceAndStock")}</legend>
        <div className="grid gap-5 md:grid-cols-2">
          <Field label={edit("price")} name="price" inputMode="decimal" hint={edit("priceHint")} error={errors.price} className="max-w-xs" data-agent-id="product-new:price" />
          <Field label={t("stock")} name="stock" inputMode="numeric" defaultValue="0" hint={t("stockHint")} error={errors.stock} className="max-w-xs" data-agent-id="product-new:stock" />
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-4">
        <legend className="font-display mb-2 text-xl">{t("measurements")}</legend>
        <p className="text-slate -mt-2 text-sm">{t("measurementsHint")}</p>
        <div className="grid gap-5 sm:grid-cols-3">
          <Field label={t("width")} name="width" inputMode="decimal" error={errors.width} data-agent-id="product-new:width" />
          <Field label={t("depth")} name="depth" inputMode="decimal" error={errors.depth} data-agent-id="product-new:depth" />
          <Field label={t("height")} name="height" inputMode="decimal" error={errors.height} data-agent-id="product-new:height" />
        </div>
      </fieldset>

      {errors.form === undefined ? null : (
        <p role="alert" className="text-danger text-sm" data-agent-id="form:error">
          {errors.form}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-4">
        <Button type="submit" disabled={!hydrated} aria-disabled={pending} data-agent-id="product-new:create">
          {pending ? t("creating") : t("create")}
        </Button>
        <p className="text-slate text-sm">{t("draftNote")}</p>
      </div>
    </form>
  );
}
