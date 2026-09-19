/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Sends transactional email: always into the outbox table, and through Resend when a key is configured.
 */

import type postgres from "postgres";
import { uuidv7 } from "uuidv7";

import type { EmailContent, EmailLocale } from "@/lib/email/templates";

/**
 * One way to send, whatever the setup (docs/adr/016):
 *
 * - **Outbox, always.** Every email is written to `email_outbox` first. Until
 *   an email provider is connected that is the whole delivery: the local stack
 *   shows the outbox at /lab/outbox, and the end-to-end tests follow the
 *   verification links from it. With a provider, the row is the shop's own
 *   record of what was sent, which the Resend dashboard is not.
 * - **Resend, when RESEND_API_KEY is set.** One HTTPS request to its REST API;
 *   no SDK, because one documented POST does not justify a dependency.
 *
 * A failed send is recorded on the row and reported to the caller, never
 * thrown: a sign-up must not fail because an email provider is having a bad
 * minute, and the customer can ask for the email again.
 *
 * Rows contain one-time links, so they are kept for a week and then deleted.
 */

export type OutgoingEmail = { to: string; kind: string; locale: EmailLocale; content: EmailContent };
export type SendResult = { id: string; transport: "outbox" | "resend"; delivered: boolean; error: string | null };

export type MailerOptions = {
  sql: postgres.Sql;
  resendApiKey?: string;
  from: string;
  fetch?: typeof fetch;
  now?: () => Date;
};

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const KEEP_DAYS = 7;

export function createMailer({ sql, resendApiKey, from, fetch: send = fetch, now = () => new Date() }: MailerOptions) {
  async function deliverWithResend(email: OutgoingEmail): Promise<{ providerId: string | null; error: string | null }> {
    try {
      const response = await send(RESEND_ENDPOINT, {
        method: "POST",
        headers: { Authorization: `Bearer ${resendApiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from, to: [email.to], subject: email.content.subject, text: email.content.text, html: email.content.html }),
      });
      if (!response.ok) return { providerId: null, error: `Resend answered ${response.status}` };
      const body = (await response.json()) as { id?: unknown };
      return { providerId: typeof body.id === "string" ? body.id : null, error: null };
    } catch (error) {
      return { providerId: null, error: error instanceof Error ? error.message : "Resend could not be reached" };
    }
  }

  async function sendEmail(email: OutgoingEmail): Promise<SendResult> {
    const id = uuidv7();
    const transport = resendApiKey === undefined ? "outbox" : "resend";
    const at = now();
    await sql`
      INSERT INTO email_outbox (id, to_address, kind, locale, subject, text_body, html_body, transport, created_at)
      VALUES (${id}, ${email.to.toLowerCase()}, ${email.kind}, ${email.locale}, ${email.content.subject}, ${email.content.text},
              ${email.content.html}, ${transport}, ${at.toISOString()}::timestamptz)
    `;
    await sql`DELETE FROM email_outbox WHERE created_at < ${new Date(at.getTime() - KEEP_DAYS * 86_400_000).toISOString()}::timestamptz`;
    if (transport === "outbox") return { id, transport, delivered: false, error: null };

    const { providerId, error } = await deliverWithResend(email);
    await sql`UPDATE email_outbox SET provider_id = ${providerId}, error = ${error} WHERE id = ${id}`;
    return { id, transport, delivered: error === null, error };
  }

  /** Newest first; optionally only those to one address. For the outbox page and the tests. */
  async function recent({ to, limit = 50 }: { to?: string; limit?: number } = {}) {
    type Row = { id: string; to_address: string; kind: string; locale: string; subject: string; text_body: string; html_body: string; transport: string; error: string | null; created_at: Date };
    const rows =
      to === undefined
        ? await sql<Row[]>`SELECT * FROM email_outbox ORDER BY created_at DESC, id DESC LIMIT ${limit}`
        : await sql<Row[]>`SELECT * FROM email_outbox WHERE to_address = ${to.toLowerCase()} ORDER BY created_at DESC, id DESC LIMIT ${limit}`;
    return rows.map((row) => ({
      id: row.id,
      to: row.to_address,
      kind: row.kind,
      locale: row.locale,
      subject: row.subject,
      text: row.text_body,
      html: row.html_body,
      transport: row.transport,
      error: row.error,
      createdAt: new Date(row.created_at),
    }));
  }

  return { sendEmail, recent };
}

export type Mailer = ReturnType<typeof createMailer>;

/** The first link in an email's text: how the outbox page and the tests follow "Confirm my email". */
export function firstLink(text: string): string | null {
  return /https?:\/\/\S+/.exec(text)?.[0] ?? null;
}
