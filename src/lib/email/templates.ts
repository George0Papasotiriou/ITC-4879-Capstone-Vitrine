/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Transactional email content: subject, plain text and HTML for each kind of email, in English and Greek.
 */

import { createTranslator } from "next-intl";

import el from "../../../messages/el.json";
import en from "../../../messages/en.json";

/**
 * Every email the shop sends is built here, from the same message files as the
 * pages, so the wording is reviewed in one place and both languages stay in
 * step (the messages test checks the keys match).
 *
 * Each email has a plain-text part and an HTML part. The plain text is the
 * real content — some people read mail as text, and spam filters distrust
 * HTML-only messages — and the HTML is a light, single-column rendering of the
 * same words with one clear button. Email clients ignore stylesheets and CSS
 * variables, so the HTML carries the design tokens' literal values inline;
 * that is the one place outside the stylesheet where they appear.
 *
 * Anything that came from a person (their name) is escaped before it goes into
 * the HTML, and links are only ever ones the shop built.
 */

export type EmailLocale = "en" | "el";
export type EmailKind = "verify_email" | "reset_password" | "price_drop" | "weekly_report" | `support_${SupportEmailKind}` | `order_${OrderEmailKind}`;

/** The order emails, one per customer-facing change in the order state machine (order-state.ts side effects). */
export const SUPPORT_EMAIL_KINDS = ["received", "reply", "closed"] as const;
export type SupportEmailKind = (typeof SUPPORT_EMAIL_KINDS)[number];

export const ORDER_EMAIL_KINDS = ["confirmed", "shipped", "delivered", "cancelled", "refunded", "returnRequested", "returnReceived"] as const;
export type OrderEmailKind = (typeof ORDER_EMAIL_KINDS)[number];

export type EmailContent = { subject: string; text: string; html: string };

const MESSAGES = { en, el } as const;

/** Design tokens (src/app/globals.css), as literal values for email clients. */
const TOKENS = { glass: "#f2f3f1", plinth: "#e4e6e2", slate: "#5b6270", dusk: "#1d2330" } as const;

export function emailLocale(value: string | null | undefined): EmailLocale {
  return value === "el" ? "el" : "en";
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`);
}

type Parts = { greeting: string; paragraphs: string[]; action: { label: string; url: string }; after: string[] };

function render(locale: EmailLocale, subject: string, parts: Parts): EmailContent {
  const t = createTranslator({ locale, messages: MESSAGES[locale], namespace: "email" });
  const footer = t("footer");
  const text = [parts.greeting, "", ...parts.paragraphs.flatMap((line) => [line, ""]), `${parts.action.label}:`, parts.action.url, "", ...parts.after.flatMap((line) => [line, ""]), "—", footer].join("\n");

  const paragraph = (line: string) => `<p style="margin:0 0 16px;font-size:16px;line-height:1.5;color:${TOKENS.dusk}">${escapeHtml(line)}</p>`;
  const html = `<!doctype html>
<html lang="${locale}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:${TOKENS.glass};font-family:Commissioner,-apple-system,'Segoe UI',Helvetica,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${TOKENS.glass}"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px">
<tr><td style="padding:0 0 24px;font-size:20px;font-weight:600;color:${TOKENS.dusk}">Vitrine</td></tr>
<tr><td style="background:#ffffff;border-radius:8px;padding:32px 28px">
${paragraph(parts.greeting)}
${parts.paragraphs.map(paragraph).join("\n")}
<p style="margin:24px 0"><a href="${escapeHtml(parts.action.url)}" style="display:inline-block;background:${TOKENS.dusk};color:#ffffff;text-decoration:none;font-size:16px;font-weight:600;padding:12px 20px;border-radius:2px">${escapeHtml(parts.action.label)}</a></p>
<p style="margin:0 0 16px;font-size:13px;line-height:1.5;color:${TOKENS.slate};word-break:break-all">${escapeHtml(parts.action.url)}</p>
${parts.after.map((line) => `<p style="margin:0 0 12px;font-size:14px;line-height:1.5;color:${TOKENS.slate}">${escapeHtml(line)}</p>`).join("\n")}
</td></tr>
<tr><td style="padding:20px 4px 0;font-size:12px;line-height:1.5;color:${TOKENS.slate}">${escapeHtml(footer)}</td></tr>
</table>
</td></tr></table>
</body>
</html>`;
  return { subject, text, html };
}

/** "Confirm your email": sent on sign-up, and again on request. */
export function verifyEmail(locale: EmailLocale, { name, url }: { name: string; url: string }): EmailContent {
  const t = createTranslator({ locale, messages: MESSAGES[locale], namespace: "email" });
  return render(locale, t("verify.subject"), {
    greeting: t("greeting", { name }),
    paragraphs: [t("verify.intro")],
    action: { label: t("verify.action"), url },
    after: [t("verify.expires"), t("verify.ignore")],
  });
}

/** "Choose a new password": sent when someone asks to reset theirs. */
export function resetPassword(locale: EmailLocale, { name, url }: { name: string; url: string }): EmailContent {
  const t = createTranslator({ locale, messages: MESSAGES[locale], namespace: "email" });
  return render(locale, t("reset.subject"), {
    greeting: t("greeting", { name }),
    paragraphs: [t("reset.intro")],
    action: { label: t("reset.action"), url },
    after: [t("reset.expires"), t("reset.ignore")],
  });
}

/**
 * An order update: what happened, and a link to the order. For a guest the
 * link is their private order link; for an order the link cannot be rebuilt
 * for, it is the order page, which asks the owner to sign in.
 */
export function orderUpdate(
  locale: EmailLocale,
  { kind, name, number, url, signInNeeded }: { kind: OrderEmailKind; name: string; number: string; url: string; signInNeeded: boolean },
): EmailContent {
  const t = createTranslator({ locale, messages: MESSAGES[locale], namespace: "email" });
  return render(locale, t(`order.${kind}.subject`, { number }), {
    greeting: t("greeting", { name }),
    paragraphs: [t(`order.${kind}.intro`, { number })],
    action: { label: t("orderAction"), url },
    // A delivered order is when a review is worth asking for (docs/adr/017).
    after: [...(kind === "delivered" ? [t("orderReviewAsk")] : []), ...(signInNeeded ? [t("orderSignIn")] : [])],
  });
}

/**
 * "The price you were waiting for": one email per watch, when the price
 * reaches the shopper's target (docs/adr/020). The amounts are formatted by
 * the caller, which knows the currency and the language.
 */
export function priceDrop(
  locale: EmailLocale,
  { name, title, price, target, url }: { name: string; title: string; price: string; target: string; url: string },
): EmailContent {
  const t = createTranslator({ locale, messages: MESSAGES[locale], namespace: "email" });
  return render(locale, t("priceDrop.subject", { title, price }), {
    greeting: t("greeting", { name }),
    paragraphs: [t("priceDrop.intro", { title, price, target })],
    action: { label: t("priceDrop.action"), url },
    after: [t("priceDrop.stock"), t("priceDrop.stop")],
  });
}

/** The weekly report: a link to the PDF in the shop's storage, not an attachment. */
export function weeklyReport(
  locale: EmailLocale,
  { name, start, end, url, sales, orders, ai }: { name: string; start: string; end: string; url: string; sales: string; orders: number; ai: string },
): EmailContent {
  const t = createTranslator({ locale, messages: MESSAGES[locale], namespace: "email" });
  return render(locale, t("report.subject", { start, end }), {
    greeting: t("greeting", { name }),
    paragraphs: [t("report.intro", { start, end }), t("report.figures", { sales, orders, ai })],
    action: { label: t("report.action"), url },
    after: [t("report.expires")],
  });
}

/**
 * A support email: we have your message, there is a reply, or the ticket is
 * closed (docs/adr/021). The link opens the conversation; for a guest it is
 * the only way in, so the email says to keep it.
 */
export function supportUpdate(
  locale: EmailLocale,
  { kind, name, number, url }: { kind: SupportEmailKind; name: string; number: string; url: string },
): EmailContent {
  const t = createTranslator({ locale, messages: MESSAGES[locale], namespace: "email" });
  return render(locale, t(`support.${kind}Subject`, { number }), {
    greeting: t("greeting", { name }),
    paragraphs: [t(`support.${kind}Intro`, { number })],
    action: { label: t("support.action"), url },
    after: [...(kind === "closed" ? [t("support.rate")] : []), t("support.keep")],
  });
}
