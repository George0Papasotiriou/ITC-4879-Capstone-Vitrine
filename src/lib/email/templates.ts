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
export type EmailKind = "verify_email" | "reset_password";

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
