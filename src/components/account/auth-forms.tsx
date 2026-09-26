"use client";

/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Sign-in, sign-up, password reset and two-step sign-in forms.
 */

import { useTranslations } from "next-intl";
import { useState, type FormEvent, type ReactNode } from "react";

import { PasswordField } from "@/components/account/password-field";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { SmartLink } from "@/components/ui/smart-link";
import { useHydrated } from "@/components/ui/use-hydrated";
import { authClient, authErrorKey } from "@/lib/auth/client";
import { syncOnNextPage } from "@/components/comfort/comfort-store";
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from "@/lib/auth/policy";

/**
 * The account forms (docs/adr/016). Each talks to Better Auth through
 * authClient and shows what went wrong in the shopper's words, next to the
 * field it concerns where there is one. After signing in the page is loaded
 * afresh rather than navigated in place, so everything the server renders for
 * a signed-in person — the header, the cart, prices — is right at once.
 *
 * Validation here is a courtesy that saves a round trip; the server validates
 * the same rules again and has the last word.
 */

type AuthError = { code?: string; status?: number } | null | undefined;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function useAuthText() {
  const t = useTranslations("auth");
  return {
    t,
    error: (key: string) => t(key, { min: MIN_PASSWORD_LENGTH }),
    fromResponse: (error: AuthError) => t(authErrorKey(error?.code, error?.status), { min: MIN_PASSWORD_LENGTH }),
  };
}

/** A form-level message, announced when it appears. */
export function FormMessage({ tone, children }: { tone: "error" | "info"; children: ReactNode }) {
  return tone === "error" ? (
    <div role="alert" className="border-danger/40 bg-danger/5 text-danger rounded-plinth border p-4 text-sm" data-agent-id="form:error">
      {children}
    </div>
  ) : (
    <div role="status" className="bg-plinth/70 text-dusk rounded-plinth p-4 text-sm" data-agent-id="form:info">
      {children}
    </div>
  );
}

function Divider({ children }: { children: ReactNode }) {
  return (
    <div className="text-slate flex items-center gap-4 text-sm" aria-hidden="true">
      <span className="bg-hairline h-px flex-1" />
      {children}
      <span className="bg-hairline h-px flex-1" />
    </div>
  );
}

function passwordProblem(password: string): string | undefined {
  if (password.length < MIN_PASSWORD_LENGTH) return "errorPasswordShort";
  if (password.length > MAX_PASSWORD_LENGTH) return "errorPasswordLong";
  return undefined;
}

/* -------------------------------------------------------------------------- */

export function SignInForm({ locale, next, googleEnabled }: { locale: string; next: string; googleEnabled: boolean }) {
  const hydrated = useHydrated();
  const { t, fromResponse } = useAuthText();
  const [pending, setPending] = useState<"password" | "passkey" | "google" | null>(null);
  const [error, setError] = useState<string | null>(null);

  // A full load, not a client navigation: signing in changes whose page this is, so
  // every client-side cache (the cart count, personalisation) must start again.
  // The next page brings the device and the account into step (docs/adr/033). Not awaited here:
  // the sign-in client starts its own redirect, and this navigation must go first.
  const finish = () => {
    syncOnNextPage();
    window.location.assign(next);
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    // aria-disabled keeps the button focusable but not inert: a second tap must do nothing.
    if (pending !== null) return;
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");
    if (!EMAIL.test(email) || password === "") {
      setError(t("errorCredentials"));
      return;
    }
    setPending("password");
    setError(null);
    // The callback is where a fresh confirmation link would land, if the address still needs one.
    const { data, error: failure } = await authClient.signIn.email({ email, password, callbackURL: `/${locale}/account?verified=1` });
    if (failure) {
      setError(fromResponse(failure));
      setPending(null);
      return;
    }
    if ((data as { twoFactorRedirect?: boolean } | null)?.twoFactorRedirect === true) {
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- same reason as finish() above
      window.location.assign(`/${locale}/account/two-factor?next=${encodeURIComponent(next)}`);
      return;
    }
    finish();
  };

  const withPasskey = async () => {
    if (pending !== null) return;
    setPending("passkey");
    setError(null);
    const result = await authClient.signIn.passkey();
    if (result?.error) {
      setError(fromResponse(result.error));
      setPending(null);
      return;
    }
    finish();
  };

  const withGoogle = async () => {
    if (pending !== null) return;
    setPending("google");
    setError(null);
    const { error: failure } = await authClient.signIn.social({ provider: "google", callbackURL: next, errorCallbackURL: `/${locale}/account/sign-in` });
    if (failure) {
      setError(fromResponse(failure));
      setPending(null);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      {error !== null ? <FormMessage tone="error">{error}</FormMessage> : null}
      <form onSubmit={submit} method="post" noValidate className="flex flex-col gap-5" data-agent-id="auth:sign-in">
        <Field label={t("email")} name="email" type="email" autoComplete="username webauthn" inputMode="email" required data-agent-id="auth:email" />
        <PasswordField label={t("password")} name="password" autoComplete="current-password" required data-agent-id="auth:password" />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button type="submit" disabled={!hydrated} aria-disabled={pending !== null} data-agent-id="action:sign-in">
            {pending === "password" ? t("signingIn") : t("signInAction")}
          </Button>
          <SmartLink href="/account/forgot-password" className="text-sm underline underline-offset-4">
            {t("forgotLink")}
          </SmartLink>
        </div>
      </form>

      <Divider>{t("or")}</Divider>

      <div className="flex flex-col gap-3">
        <Button variant="secondary" onClick={withPasskey} aria-disabled={pending !== null} aria-describedby="passkey-hint" data-agent-id="action:passkey-sign-in">
          {t("passkeyAction")}
        </Button>
        <p id="passkey-hint" className="text-slate text-sm">
          {t("passkeyHint")}
        </p>
        {googleEnabled ? (
          <Button variant="secondary" onClick={withGoogle} aria-disabled={pending !== null} data-agent-id="action:google-sign-in">
            {t("googleAction")}
          </Button>
        ) : null}
      </div>

      <p className="text-sm">
        {t("noAccount")}{" "}
        <SmartLink href={`/account/sign-up${next === `/${locale}/account` ? "" : `?next=${encodeURIComponent(next)}`}`} className="font-medium underline underline-offset-4">
          {t("createLink")}
        </SmartLink>
      </p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

export function SignUpForm({ locale, outboxOpen }: { locale: string; outboxOpen: boolean }) {
  const hydrated = useHydrated();
  const { t, error: errorText, fromResponse } = useAuthText();
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<{ name?: string; email?: string; password?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [resent, setResent] = useState<"idle" | "sending" | "sent" | "failed">("idle");
  const callbackURL = `/${locale}/account?verified=1`;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") ?? "").trim();
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");
    const found = {
      name: name === "" ? errorText("errorName") : undefined,
      email: EMAIL.test(email) ? undefined : errorText("errorEmail"),
      password: passwordProblem(password) === undefined ? undefined : errorText(passwordProblem(password)!),
    };
    setErrors(found);
    if (found.name !== undefined || found.email !== undefined || found.password !== undefined) return;

    setPending(true);
    setFormError(null);
    // The confirmed account's first page brings this device's preferences over (docs/adr/033).
    syncOnNextPage();
    const { error: failure } = await authClient.signUp.email({ name, email, password, callbackURL });
    setPending(false);
    if (failure) {
      const key = authErrorKey(failure.code, failure.status);
      if (key === "errorPasswordShort" || key === "errorPasswordLong") setErrors({ password: fromResponse(failure) });
      else if (key === "errorEmail") setErrors({ email: fromResponse(failure) });
      else setFormError(fromResponse(failure));
      return;
    }
    setSentTo(email);
  };

  const resend = async () => {
    if (sentTo === null || resent === "sending") return;
    setResent("sending");
    const { error: failure } = await authClient.sendVerificationEmail({ email: sentTo, callbackURL });
    setResent(failure ? "failed" : "sent");
  };

  if (sentTo !== null) {
    return (
      <div className="flex flex-col gap-5" data-agent-id="auth:check-inbox">
        <h2 className="font-display text-2xl">{t("checkInboxTitle")}</h2>
        <p className="max-w-[52ch]">{t("checkInbox", { email: sentTo })}</p>
        {outboxOpen ? (
          <FormMessage tone="info">
            {t("checkInboxLocal")}{" "}
            <SmartLink href="/lab/outbox" className="font-medium underline underline-offset-4" data-agent-id="action:open-outbox">
              {t("openOutbox")}
            </SmartLink>
          </FormMessage>
        ) : null}
        <div className="flex flex-wrap items-center gap-4">
          <Button variant="secondary" onClick={resend} aria-disabled={resent === "sending"}>
            {t("resend")}
          </Button>
          <p role="status" className="text-slate text-sm">
            {resent === "sent" ? t("resent") : resent === "failed" ? t("errorTooMany") : null}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {formError !== null ? <FormMessage tone="error">{formError}</FormMessage> : null}
      <form onSubmit={submit} method="post" noValidate className="flex flex-col gap-5" data-agent-id="auth:sign-up">
        <Field label={t("name")} name="name" autoComplete="name" hint={t("nameHint")} required error={errors.name} data-agent-id="auth:name" />
        <Field label={t("email")} name="email" type="email" autoComplete="email" inputMode="email" required error={errors.email} data-agent-id="auth:email" />
        <PasswordField
          label={t("password")}
          name="password"
          autoComplete="new-password"
          minLength={MIN_PASSWORD_LENGTH}
          maxLength={MAX_PASSWORD_LENGTH}
          hint={t("passwordHint", { min: MIN_PASSWORD_LENGTH })}
          required
          error={errors.password}
          data-agent-id="auth:password"
        />
        <div>
          <Button type="submit" disabled={!hydrated} aria-disabled={pending} data-agent-id="action:sign-up">
            {pending ? t("creating") : t("signUpAction")}
          </Button>
        </div>
      </form>
      <p className="text-sm">
        {t("haveAccount")}{" "}
        <SmartLink href="/account/sign-in" className="font-medium underline underline-offset-4">
          {t("signInLink")}
        </SmartLink>
      </p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

export function ForgotPasswordForm({ locale }: { locale: string }) {
  const hydrated = useHydrated();
  const { t, error: errorText, fromResponse } = useAuthText();
  const [pending, setPending] = useState(false);
  const [emailError, setEmailError] = useState<string | undefined>(undefined);
  const [formError, setFormError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    const email = String(new FormData(event.currentTarget).get("email") ?? "").trim();
    if (!EMAIL.test(email)) {
      setEmailError(errorText("errorEmail"));
      return;
    }
    setEmailError(undefined);
    setPending(true);
    setFormError(null);
    const { error: failure } = await authClient.requestPasswordReset({ email, redirectTo: `/${locale}/account/reset-password` });
    setPending(false);
    if (failure) {
      setFormError(fromResponse(failure));
      return;
    }
    setSentTo(email);
  };

  if (sentTo !== null) return <FormMessage tone="info">{t("forgotSent", { email: sentTo })}</FormMessage>;

  return (
    <div className="flex flex-col gap-6">
      {formError !== null ? <FormMessage tone="error">{formError}</FormMessage> : null}
      <form onSubmit={submit} method="post" noValidate className="flex flex-col gap-5" data-agent-id="auth:forgot">
        <Field label={t("email")} name="email" type="email" autoComplete="email" inputMode="email" required error={emailError} data-agent-id="auth:email" />
        <div>
          <Button type="submit" disabled={!hydrated} aria-disabled={pending} data-agent-id="action:send-reset">
            {pending ? t("sending") : t("forgotAction")}
          </Button>
        </div>
      </form>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

export function ResetPasswordForm({ token }: { token: string }) {
  const hydrated = useHydrated();
  const { t, error: errorText, fromResponse } = useAuthText();
  const [pending, setPending] = useState(false);
  const [passwordError, setPasswordError] = useState<string | undefined>(undefined);
  const [formError, setFormError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    const newPassword = String(new FormData(event.currentTarget).get("password") ?? "");
    const problem = passwordProblem(newPassword);
    if (problem !== undefined) {
      setPasswordError(errorText(problem));
      return;
    }
    setPasswordError(undefined);
    setPending(true);
    setFormError(null);
    const { error: failure } = await authClient.resetPassword({ newPassword, token });
    setPending(false);
    if (failure) {
      setFormError(fromResponse(failure));
      return;
    }
    setDone(true);
  };

  if (done) {
    return (
      <div className="flex flex-col gap-5">
        <FormMessage tone="info">{t("resetDone")}</FormMessage>
        <div>
          <SmartLink href="/account/sign-in" className="font-medium underline underline-offset-4" data-agent-id="action:go-sign-in">
            {t("signInLink")}
          </SmartLink>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {formError !== null ? <FormMessage tone="error">{formError}</FormMessage> : null}
      <form onSubmit={submit} method="post" noValidate className="flex flex-col gap-5" data-agent-id="auth:reset">
        <PasswordField
          label={t("newPassword")}
          name="password"
          autoComplete="new-password"
          hint={t("passwordHint", { min: MIN_PASSWORD_LENGTH })}
          required
          error={passwordError}
          data-agent-id="auth:new-password"
        />
        <div>
          <Button type="submit" disabled={!hydrated} aria-disabled={pending} data-agent-id="action:save-password">
            {pending ? t("saving") : t("resetAction")}
          </Button>
        </div>
      </form>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

export function TwoFactorForm({ next }: { next: string }) {
  const hydrated = useHydrated();
  const { t, fromResponse } = useAuthText();
  const [mode, setMode] = useState<"totp" | "backup">("totp");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    const form = new FormData(event.currentTarget);
    const code = String(form.get("code") ?? "").replace(/\s+/g, "");
    const trustDevice = form.get("trust") === "on";
    if (code === "") {
      setError(t("errorCode"));
      return;
    }
    setPending(true);
    setError(null);
    const { error: failure } =
      mode === "totp" ? await authClient.twoFactor.verifyTotp({ code, trustDevice }) : await authClient.twoFactor.verifyBackupCode({ code, trustDevice });
    if (failure) {
      setError(fromResponse(failure));
      setPending(false);
      return;
    }
    // Signed in: the next page brings the device and the account into step (docs/adr/033).
    syncOnNextPage();
    window.location.assign(next);
  };

  return (
    <div className="flex flex-col gap-6">
      <p className="max-w-[52ch]">{mode === "totp" ? t("twoFactorLede") : t("twoFactorBackupLede")}</p>
      {error !== null ? <FormMessage tone="error">{error}</FormMessage> : null}
      <form onSubmit={submit} method="post" noValidate className="flex flex-col gap-5" data-agent-id="auth:two-factor">
        {mode === "totp" ? (
          <Field
            key="totp"
            label={t("code")}
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]*"
            maxLength={6}
            required
            className="max-w-48"
            inputClassName="tabular text-lg tracking-[0.3em]"
            data-agent-id="auth:code"
          />
        ) : (
          <Field key="backup" label={t("backupCode")} name="code" autoComplete="off" autoCapitalize="none" spellCheck={false} required className="max-w-72" data-agent-id="auth:backup-code" />
        )}
        <label className="flex cursor-pointer items-center gap-3 text-sm">
          <input type="checkbox" name="trust" className="accent-dusk size-4" />
          {t("trustDevice")}
        </label>
        <div className="flex flex-wrap items-center gap-4">
          <Button type="submit" disabled={!hydrated} aria-disabled={pending} data-agent-id="action:verify-code">
            {pending ? t("verifying") : t("verifyAction")}
          </Button>
          <Button
            variant="tertiary"
            onClick={() => {
              setMode(mode === "totp" ? "backup" : "totp");
              setError(null);
            }}
          >
            {mode === "totp" ? t("useBackup") : t("useApp")}
          </Button>
        </div>
      </form>
    </div>
  );
}
