"use client";

/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * How each tool result appears in the Concierge's conversation: product cards, comparisons, sets, orders and approvals.
 */

import { getToolName, isToolUIPart, type UIMessage } from "ai";
import Image from "next/image";
import { useLocale, useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { SmartLink } from "@/components/ui/smart-link";
import { formatMoney, money } from "@/lib/commerce/money";

/**
 * Generative UI bound to the shop's data (docs/PLAN.md 2.5): prices, stock and
 * totals are shown from the tool's output, which the server read from the
 * database, never from the model's words. Text the model writes is shown as
 * plain text, never as markup.
 */

type Part = UIMessage["parts"][number];
type Brief = { id: string; slug: string; title: string; brand: string | null; priceCents: number; compareAtCents: number | null; currency: string; inStock: boolean; image: { src: string; alt: string } | null };

function useMoney() {
  const locale = useLocale();
  return (cents: number, currency = "EUR") => formatMoney(money(cents, currency), locale);
}

export function ProductCards({ products }: { products: Brief[] }) {
  const t = useTranslations("concierge");
  const price = useMoney();
  return (
    <ul className="grid grid-cols-2 gap-3">
      {products.map((product) => (
        <li key={product.id} data-agent-id={`concierge-product:${product.id}`}>
          <SmartLink href={`/p/${product.slug}`} className="group flex flex-col gap-2 no-underline" aria-label={t("viewProduct", { title: product.title })}>
            <span className="bg-plinth rounded-plinth relative block aspect-square overflow-hidden">
              {product.image === null ? null : <Image src={product.image.src} alt="" fill sizes="180px" className="object-contain p-2 transition-transform group-hover:scale-[1.03]" />}
            </span>
            <span className="line-clamp-2 text-sm leading-snug">{product.title}</span>
            <span className="tabular text-sm font-medium">
              {price(product.priceCents, product.currency)}
              {product.compareAtCents === null ? null : <span className="text-slate ml-2 font-normal line-through">{price(product.compareAtCents, product.currency)}</span>}
            </span>
            {product.inStock ? null : <span className="text-slate text-xs">{t("outOfStock")}</span>}
          </SmartLink>
        </li>
      ))}
    </ul>
  );
}

function CompareTable({ rows }: { rows: { id: string; title: string; priceCents: number; currency: string; dimsCm: { w: number; d: number; h: number } | null; materials: string[]; rating: { average: number; count: number }; inStock: boolean }[] }) {
  const t = useTranslations("concierge");
  const price = useMoney();
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[20rem] text-xs" data-agent-id="concierge:compare">
        <caption className="text-slate mb-2 text-left text-sm">{t("compareTitle")}</caption>
        <thead>
          <tr className="text-slate text-left">
            <th scope="col" className="py-1 pr-2 font-medium">{t("compare.product")}</th>
            <th scope="col" className="py-1 pr-2 font-medium">{t("compare.price")}</th>
            <th scope="col" className="py-1 pr-2 font-medium">{t("compare.size")}</th>
            <th scope="col" className="py-1 font-medium">{t("compare.rating")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-hairline border-t align-top">
              <th scope="row" className="py-2 pr-2 text-left font-normal">
                <span className="line-clamp-2">{row.title}</span>
                <span className="text-slate">{row.materials.join(", ")}</span>
              </th>
              <td className="tabular py-2 pr-2 whitespace-nowrap">
                {price(row.priceCents, row.currency)}
                <span className="text-slate block">{row.inStock ? t("inStock") : t("outOfStock")}</span>
              </td>
              <td className="tabular py-2 pr-2 whitespace-nowrap">{row.dimsCm === null ? "—" : `${row.dimsCm.w} × ${row.dimsCm.d} × ${row.dimsCm.h}`}</td>
              <td className="tabular py-2">{row.rating.count === 0 ? t("noRating") : `${row.rating.average} (${row.rating.count})`}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Bundles({ bundles }: { bundles: { totalCents: number; remainingCents: number; products: (Brief & { quantity: number })[] }[] }) {
  const t = useTranslations("concierge");
  const price = useMoney();
  if (bundles.length === 0) return <p className="text-slate text-sm">{t("noBundle")}</p>;
  return (
    <ol className="flex flex-col gap-4" data-agent-id="concierge:bundles">
      {bundles.map((bundle, index) => (
        <li key={index} className="border-hairline rounded-plinth border p-3">
          <p className="text-sm font-medium">{t("bundleTitle", { number: index + 1 })}</p>
          <p className="text-slate tabular mb-3 text-xs">{t("bundleTotal", { total: price(bundle.totalCents), left: price(bundle.remainingCents) })}</p>
          <ProductCards products={bundle.products} />
        </li>
      ))}
    </ol>
  );
}

function Status({ children }: { children: React.ReactNode }) {
  return <p className="text-slate text-xs italic">{children}</p>;
}

/** One part of an assistant message. */
export function AssistantPart({ part, onApprove }: { part: Part; onApprove: (id: string, approved: boolean) => void }) {
  const t = useTranslations("concierge");
  const o = useTranslations("order");
  const price = useMoney();

  if (part.type === "text") return part.text.trim() === "" ? null : <p className="whitespace-pre-line">{part.text}</p>;
  if (!isToolUIPart(part)) return null;
  const name = getToolName(part);
  const input = (part.input ?? {}) as Record<string, unknown>;

  if (part.state === "input-streaming" || part.state === "input-available") return <Status>{t("working")}</Status>;
  if (part.state === "output-error") return <Status>{t("errors.generic")}</Status>;
  if (part.state === "output-denied" || (part.state === "approval-responded" && part.approval.approved === false)) return <Status>{t("approval.declined")}</Status>;
  if (part.state === "approval-responded") return <Status>{t("approval.approved")}</Status>;

  if (part.state === "approval-requested") {
    if (part.approval.isAutomatic === true) return null;
    const checkout = name === "start_checkout";
    return (
      <div className="border-lumen rounded-plinth flex flex-col gap-3 border-2 p-4" role="group" aria-label={checkout ? t("approval.checkoutTitle") : t("approval.returnTitle", { number: String(input.number ?? "") })} data-agent-id={`concierge:approval:${name}`}>
        <p className="font-medium">{checkout ? t("approval.checkoutTitle") : t("approval.returnTitle", { number: String(input.number ?? "") })}</p>
        <p className="text-slate text-sm">{checkout ? t("approval.checkoutBody") : t("approval.returnBody")}</p>
        <div className="flex gap-2">
          <Button size="sm" onClick={() => onApprove(part.approval.id, true)} data-agent-id="concierge:approve">
            {t("approval.approve")}
          </Button>
          <Button size="sm" variant="secondary" onClick={() => onApprove(part.approval.id, false)} data-agent-id="concierge:decline">
            {t("approval.decline")}
          </Button>
        </div>
      </div>
    );
  }

  // output-available
  const output = part.output as Record<string, unknown> | null;
  if (output === null) return null;
  switch (name) {
    case "search_products":
      return <Status>{`${t("searched", { query: String(input.query ?? "") })} · ${t("found", { count: Number(output.found ?? 0) })}`}</Status>;
    case "show_products":
    case "recommend":
    case "get_products":
      return <ProductCards products={(output.products as Brief[]) ?? []} />;
    case "compare_products":
      return <CompareTable rows={(output.rows as Parameters<typeof CompareTable>[0]["rows"]) ?? []} />;
    case "build_bundle":
      return <Bundles bundles={(output.bundles as Parameters<typeof Bundles>[0]["bundles"]) ?? []} />;
    case "add_to_cart":
    case "update_cart_item":
    case "remove_from_cart":
      return output.ok === true ? (
        <Status>{name === "add_to_cart" ? t("added", { title: String(output.title) }) : name === "remove_from_cart" ? t("removed", { title: String(output.title) }) : t("updated", { title: String(output.title), quantity: Number(output.quantity) })}</Status>
      ) : (
        <Status>{t("cartRefused")}</Status>
      );
    case "get_orders": {
      const orders = (output.orders as { number: string; status: string; totalCents: number; currency: string }[]) ?? [];
      return orders.length === 0 ? (
        <Status>{t("noOrders")}</Status>
      ) : (
        <ul className="flex flex-col gap-1 text-sm" aria-label={t("ordersTitle")}>
          {orders.map((order) => (
            <li key={order.number} className="tabular flex justify-between gap-3">
              <span>{t("orderLine", { number: order.number, status: o(`status.${order.status}`) })}</span>
              <span>{price(order.totalCents, order.currency)}</span>
            </li>
          ))}
        </ul>
      );
    }
    case "get_order_status":
      return output.found === true ? <Status>{t("orderLine", { number: String(output.number), status: o(`status.${String(output.status)}`) })}</Status> : null;
    default:
      // Page actions (navigate, filters, highlight, viewers) show their caption; the Spotlight shows the action itself.
      return typeof input.caption === "string" ? <Status>{input.caption}</Status> : null;
  }
}
