/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Integration tests for accounts: sign-up, email verification, sign-in, password reset, roles and rate limits.
 */

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createAuth, localeOfLink, type Auth } from "@/lib/auth/config";
import * as schema from "@/lib/db/schema";
import { createMailer, firstLink, type Mailer } from "@/lib/email/mailer";

/**
 * The real Better Auth configuration (src/lib/auth/config.ts) against the real
 * schema, with emails going into the real outbox table. Requests go through
 * Better Auth's HTTP handler where the behaviour lives there (verification
 * links, rate limits), and through its server API elsewhere.
 */

const url = process.env.DATABASE_URL;
const BASE = "http://localhost:3000";
const PASSWORD = "correct horse battery";

describe.skipIf(url === undefined || url === "")("accounts", () => {
  let connection: ReturnType<typeof postgres>;
  let mailer: Mailer;
  let auth: Auth;

  const makeAuth = (rateLimit = false) =>
    createAuth({ db: drizzle(connection, { schema }), mailer, secret: "s".repeat(40), baseURL: BASE, rateLimit });

  /** Calls the auth HTTP handler as a browser on the shop's own origin would. */
  const call = (instance: Auth, path: string, init: { method?: string; body?: unknown; cookie?: string; ip?: string } = {}) =>
    instance.handler(
      new Request(`${BASE}/api/auth${path}`, {
        method: init.method ?? (init.body === undefined ? "GET" : "POST"),
        headers: {
          origin: BASE,
          "content-type": "application/json",
          ...(init.cookie === undefined ? {} : { cookie: init.cookie }),
          ...(init.ip === undefined ? {} : { "x-forwarded-for": init.ip }),
        },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        redirect: "manual",
      }),
    );

  /** The session cookie from a response, as a Cookie header. */
  const sessionCookie = (response: Response) =>
    response.headers
      .getSetCookie()
      .map((cookie) => cookie.split(";")[0]!)
      .filter((cookie) => cookie.startsWith("vt.session_token="))
      .join("; ");

  /** Emails are written as the request finishes; resets deliberately without waiting, so poll briefly. */
  const emailsTo = async (address: string, count = 1) => {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const found = await mailer.recent({ to: address });
      if (found.length >= count) return found;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    return mailer.recent({ to: address });
  };

  const signUp = (email: string, name = "Eleni Papadopoulou", callbackURL = "/el/account?verified=1") =>
    call(auth, "/sign-up/email", { body: { name, email, password: PASSWORD, callbackURL } });

  beforeAll(async () => {
    connection = postgres(url as string, { max: 4, onnotice: () => {} });
    await migrate(drizzle(connection, { schema }), { migrationsFolder: "./drizzle" });
    mailer = createMailer({ sql: connection, from: "Vitrine <test@example.com>" });
    auth = makeAuth();
  });

  beforeEach(async () => {
    await connection`TRUNCATE users, email_outbox CASCADE`;
  });

  afterAll(async () => {
    await connection.end();
  });

  it("signs up a customer, lower-cases the address, and sends a confirmation link in the page's language", async () => {
    const response = await signUp("Eleni@Example.COM");
    expect(response.status).toBe(200);
    // Email confirmation comes first: no session yet.
    expect(sessionCookie(response)).toBe("");

    const [user] = await connection<{ email: string; role: string; email_verified: boolean }[]>`SELECT email, role, email_verified FROM users`;
    expect(user).toEqual({ email: "eleni@example.com", role: "customer", email_verified: false });

    const [email] = await emailsTo("eleni@example.com");
    expect(email!.kind).toBe("verify_email");
    expect(email!.locale).toBe("el");
    expect(email!.subject).toBe("Επιβεβαίωσε το email σου για το Vitrine");
    expect(email!.text).toContain("Γεια σου Eleni Papadopoulou,");
    expect(firstLink(email!.text)).toMatch(/^http:\/\/localhost:3000\/api\/auth\/verify-email\?token=/);
    expect(localeOfLink(firstLink(email!.text)!)).toBe("el");
  });

  it("refuses to sign in before the address is confirmed, and sends a fresh link", async () => {
    await signUp("nikos@example.com");
    const response = await call(auth, "/sign-in/email", { body: { email: "nikos@example.com", password: PASSWORD } });
    expect(response.status).toBe(403);
    expect(((await response.json()) as { code: string }).code).toBe("EMAIL_NOT_VERIFIED");
    expect(await emailsTo("nikos@example.com", 2)).toHaveLength(2);
  });

  it("confirms the address from the emailed link, signs the person in, and returns them to the page they came from", async () => {
    await signUp("maria@example.com");
    const [email] = await emailsTo("maria@example.com");
    const link = new URL(firstLink(email!.text)!);

    const response = await call(auth, `${link.pathname.replace("/api/auth", "")}${link.search}`);
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/el/account?verified=1");
    const cookie = sessionCookie(response);
    expect(cookie).not.toBe("");

    const session = await auth.api.getSession({ headers: new Headers({ cookie }) });
    expect(session?.user.email).toBe("maria@example.com");
    expect(session?.user.emailVerified).toBe(true);
  });

  it("signs in with the right password only, and answers a wrong one without saying which part was wrong", async () => {
    await connection`TRUNCATE users CASCADE`;
    await signUp("kostas@example.com");
    await connection`UPDATE users SET email_verified = true`;

    const wrong = await call(auth, "/sign-in/email", { body: { email: "kostas@example.com", password: "not the password" } });
    expect(wrong.status).toBe(401);
    expect(((await wrong.json()) as { code: string }).code).toBe("INVALID_EMAIL_OR_PASSWORD");
    const nobody = await call(auth, "/sign-in/email", { body: { email: "nobody@example.com", password: PASSWORD } });
    expect(((await nobody.json()) as { code: string }).code).toBe("INVALID_EMAIL_OR_PASSWORD");

    const right = await call(auth, "/sign-in/email", { body: { email: "kostas@example.com", password: PASSWORD } });
    expect(right.status).toBe(200);
    expect(sessionCookie(right)).not.toBe("");
  });

  it("answers a sign-up for an existing address like a new one, and creates nothing", async () => {
    await signUp("anna@example.com");
    const again = await signUp("anna@example.com", "Someone Else");
    expect(again.status).toBe(200);
    const [row] = await connection<{ count: number }[]>`SELECT count(*)::int AS count FROM users WHERE email = 'anna@example.com'`;
    expect(row?.count).toBe(1);
  });

  it("resets a forgotten password by link, signs out every device, and keeps the old password from working", async () => {
    await signUp("petros@example.com");
    await connection`UPDATE users SET email_verified = true`;
    const first = sessionCookie(await call(auth, "/sign-in/email", { body: { email: "petros@example.com", password: PASSWORD } }));
    expect(first).not.toBe("");

    const request = await call(auth, "/request-password-reset", { body: { email: "petros@example.com", redirectTo: "/en/account/reset-password" } });
    expect(request.status).toBe(200);
    const reset = (await emailsTo("petros@example.com", 2)).find((email) => email.kind === "reset_password")!;
    expect(reset.locale).toBe("en");
    const link = new URL(firstLink(reset.text)!);

    // The link lands on the shop's own reset page, carrying the token.
    const landing = await call(auth, `${link.pathname.replace("/api/auth", "")}${link.search}`);
    expect(landing.status).toBe(302);
    const target = new URL(landing.headers.get("location")!, BASE);
    expect(target.pathname).toBe("/en/account/reset-password");
    const token = target.searchParams.get("token")!;

    const changed = await call(auth, "/reset-password", { body: { newPassword: "a brand new passphrase", token } });
    expect(changed.status).toBe(200);
    expect(await auth.api.getSession({ headers: new Headers({ cookie: first }) })).toBeNull();

    const old = await call(auth, "/sign-in/email", { body: { email: "petros@example.com", password: PASSWORD } });
    expect(old.status).toBe(401);
    const fresh = await call(auth, "/sign-in/email", { body: { email: "petros@example.com", password: "a brand new passphrase" } });
    expect(fresh.status).toBe(200);

    // A reset link works once.
    const reused = await call(auth, "/reset-password", { body: { newPassword: "yet another passphrase", token } });
    expect(reused.status).toBe(400);
  });

  it("does not reveal whether an address has an account when a reset is requested", async () => {
    const response = await call(auth, "/request-password-reset", { body: { email: "nobody@example.com", redirectTo: "/en/account/reset-password" } });
    expect(response.status).toBe(200);
    expect(await mailer.recent({ to: "nobody@example.com" })).toHaveLength(0);
  });

  it("stores only known roles", async () => {
    await signUp("staff@example.com");
    await connection`UPDATE users SET role = 'support,merchandiser' WHERE email = 'staff@example.com'`;
    await expect(connection`UPDATE users SET role = 'root' WHERE email = 'staff@example.com'`).rejects.toThrow(/users_role_known/);
    await expect(connection`UPDATE users SET email = 'Staff@Example.com' WHERE email = 'staff@example.com'`).rejects.toThrow(/users_email_lowercase/);
  });

  it("makes an ADMIN_EMAILS address an admin only once it has been confirmed", async () => {
    const withAdmins = createAuth({
      db: drizzle(connection, { schema }),
      mailer,
      secret: "s".repeat(40),
      baseURL: BASE,
      rateLimit: false,
      adminEmails: ["Boss@Example.com"],
    });
    const role = async (email: string) => (await connection<{ role: string }[]>`SELECT role FROM users WHERE email = ${email}`)[0]?.role;

    await call(withAdmins, "/sign-up/email", { body: { name: "Boss", email: "boss@example.com", password: PASSWORD, callbackURL: "/en/account" } });
    await call(withAdmins, "/sign-up/email", { body: { name: "Clerk", email: "clerk@example.com", password: PASSWORD, callbackURL: "/en/account" } });
    // Signed up but not confirmed: no session can exist yet, so nothing is granted.
    expect(await role("boss@example.com")).toBe("customer");

    for (const address of ["boss@example.com", "clerk@example.com"]) {
      const [email] = await emailsTo(address);
      const link = new URL(firstLink(email!.text)!);
      const response = await call(withAdmins, `${link.pathname.replace("/api/auth", "")}${link.search}`);
      expect(response.status).toBe(302);
    }
    expect(await role("boss@example.com")).toBe("admin");
    expect(await role("clerk@example.com")).toBe("customer");
  });

  it("limits sign-in attempts from one address: three in ten seconds, then 429", async () => {
    const limited = makeAuth(true);
    const attempt = (ip: string) => call(limited, "/sign-in/email", { body: { email: "nobody@example.com", password: "wrong password" }, ip });
    const statuses = [];
    for (let i = 0; i < 4; i += 1) statuses.push((await attempt("203.0.113.7")).status);
    expect(statuses).toEqual([401, 401, 401, 429]);
    // Another address is not held back by the first one's attempts.
    expect((await attempt("198.51.100.4")).status).toBe(401);
  });
});
