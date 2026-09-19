"use client";

/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Setting one variant's stock to the number counted, with the reason, for the audit log.
 */

import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { useHydrated } from "@/components/ui/use-hydrated";
import { useRouter } from "@/i18n/navigation";

const KNOWN_ERRORS = ["negative", "whole_number", "too_large", "reason_required", "too_long"];

export function StockForm({ productId, variant }: { productId: string; variant: { id: string; sku: string; stock: number; colorLabel: string | null } }) {
  const t = useTranslations("admin.edit");
  const router = useRouter();
  const toast = useToast();
  const hydrated = useHydrated();
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<{ stock?: string; reason?: string; form?: string }>({});

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    setPending(true);
    const response = await fetch(`/api/staff/products/${productId}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "stock", variantId: variant.id, stock: String(data.get("stock") ?? ""), reason: String(data.get("reason") ?? "") }),
    }).catch(() => null);
    const result = (await response?.json().catch(() => null)) as { ok: boolean; changed?: boolean; stock?: number; fields?: Record<string, string> } | null;
    setPending(false);
    if (result?.ok === true) {
      setErrors({});
      toast({ title: result.changed === true ? t("stock.saved", { count: result.stock ?? 0 }) : t("stock.unchanged"), tone: "success" });
      form.reset();
      router.refresh();
      return;
    }
    const fields = result?.fields ?? {};
    const message = (key: string | undefined) => (key === undefined ? undefined : t(`stock.errors.${KNOWN_ERRORS.includes(key) ? key : "too_long"}`));
    setErrors(Object.keys(fields).length > 0 ? { stock: message(fields.stock), reason: message(fields.reason) } : { form: t("failed") });
  };

  return (
    <form onSubmit={submit} method="post" noValidate className="flex flex-col gap-4" data-agent-id={`stock:form:${variant.sku}`}>
      <p className="text-sm">
        <span className="tabular font-medium">{variant.sku}</span>
        {variant.colorLabel === null ? null : <span className="text-slate"> · {variant.colorLabel}</span>}
        <span className="text-slate"> · </span>
        <span className="tabular" data-agent-id={`stock:current:${variant.sku}`}>
          {t("stock.current", { count: variant.stock })}
        </span>
      </p>
      <div className="grid gap-4">
        <Field label={t("stock.count")} name="stock" type="number" min={0} step={1} inputMode="numeric" defaultValue={variant.stock} error={errors.stock} className="max-w-[10rem]" data-agent-id={`stock:count:${variant.sku}`} />
        <Field label={t("stock.reason")} name="reason" maxLength={200} hint={t("stock.reasonHint")} error={errors.reason} data-agent-id={`stock:reason:${variant.sku}`} />
      </div>
      {errors.form === undefined ? null : (
        <p role="alert" className="text-danger text-sm">
          {errors.form}
        </p>
      )}
      <div>
        <Button type="submit" variant="secondary" size="sm" disabled={!hydrated} aria-disabled={pending} data-agent-id={`stock:save:${variant.sku}`}>
          {t("stock.save")}
        </Button>
      </div>
    </form>
  );
}
