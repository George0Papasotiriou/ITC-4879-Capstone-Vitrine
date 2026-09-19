/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Tests for the transactional email templates: both languages, the link in both parts, and escaping.
 */

import { describe, expect, it } from "vitest";

import { firstLink } from "@/lib/email/mailer";
import { emailLocale, escapeHtml, resetPassword, verifyEmail } from "@/lib/email/templates";

const URL = "http://localhost:3000/api/auth/verify-email?token=abc&callbackURL=%2Fel%2Faccount";

describe("email templates", () => {
  it("writes the confirmation email in English and Greek, with the link as its first link", () => {
    const en = verifyEmail("en", { name: "Eleni", url: URL });
    expect(en.subject).toBe("Confirm your email for Vitrine");
    expect(en.text.startsWith("Hello Eleni,")).toBe(true);
    expect(firstLink(en.text)).toBe(URL);

    const el = verifyEmail("el", { name: "Ελένη", url: URL });
    expect(el.subject).toBe("Επιβεβαίωσε το email σου για το Vitrine");
    expect(el.text).toContain("Γεια σου Ελένη,");
    expect(el.html).toContain('lang="el"');
  });

  it("puts the same link in the HTML button, escaped", () => {
    const { html } = resetPassword("en", { name: "Nikos", url: URL });
    expect(html).toContain(`href="${escapeHtml(URL)}"`);
    expect(html).toContain("Choose a new password");
  });

  it("escapes a name that tries to be markup", () => {
    const { html, text } = verifyEmail("en", { name: '<img src=x onerror="alert(1)">', url: URL });
    expect(html).not.toContain("<img");
    expect(html).toContain("&#60;img src=x onerror=&#34;alert(1)&#34;&#62;");
    // Plain text is plain: nothing to escape, nothing that runs.
    expect(text).toContain('<img src=x onerror="alert(1)">');
  });

  it("reads anything that is not Greek as English", () => {
    expect(emailLocale("el")).toBe("el");
    expect(emailLocale("de")).toBe("en");
    expect(emailLocale(undefined)).toBe("en");
  });
});
