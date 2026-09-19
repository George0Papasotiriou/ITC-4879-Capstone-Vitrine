"use client";

/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Account security panels: passkeys, two-step sign-in, signed-in devices, password change and sign-out.
 */

import { useFormatter, useTranslations } from "next-intl";
import { useState, useTransition, type FormEvent } from "react";

import { FormMessage } from "@/components/account/auth-forms";
import { PasswordField } from "@/components/account/password-field";
import { QrCode } from "@/components/account/qr-code";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { useHydrated } from "@/components/ui/use-hydrated";
import { useRouter } from "@/i18n/navigation";
import { authClient, authErrorKey } from "@/lib/auth/client";
import type { Device } from "@/lib/auth/paths";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth/policy";

/**
 * Lists are rendered by the server (the account page reads them through
 * Better Auth with the visitor's own session) and these panels only act:
 * after a change the page refreshes from the server, so what is shown is
 * always what is stored.
 */

type Failure = { code?: string; status?: number } | null | undefined;

function useFailureText() {
  const t = useTranslations("auth");
  return (failure: Failure) => t(authErrorKey(failure?.code, failure?.status), { min: MIN_PASSWORD_LENGTH });
}

function Panel({ id, title, lede, children }: { id: string; title: string; lede?: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="border-hairline flex flex-col gap-4 border-t pt-6">
      <div className="flex flex-col gap-1">
        <h3 id={id} className="text-lg font-medium">
          {title}
        </h3>
        {lede !== undefined ? <p className="text-slate max-w-[60ch] text-sm">{lede}</p> : null}
      </div>
      {children}
    </section>
  );
}

/* -------------------------------------------------------------------------- */

export type PasskeyItem = { id: string; name: string | null; createdAt: string | null };

export function PasskeysPanel({ passkeys }: { passkeys: PasskeyItem[] }) {
  const t = useTranslations("auth");
  const format = useFormatter();
  const failureText = useFailureText();
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const add = () =>
    !pending &&
    startTransition(async () => {
      setError(null);
      const result = await authClient.passkey.addPasskey({ name: t("passkeyDefaultName") });
      if (result?.error) {
        setError(failureText(result.error));
        return;
      }
      toast({ title: t("passkeyAdded"), tone: "success" });
      router.refresh();
    });

  const remove = (id: string) =>
    !pending &&
    startTransition(async () => {
      setError(null);
      const { error: failure } = await authClient.passkey.deletePasskey({ id });
      if (failure) {
        setError(failureText(failure));
        return;
      }
      toast({ title: t("passkeyRemoved") });
      router.refresh();
    });

  return (
    <Panel id="passkeys" title={t("passkeys")} lede={t("passkeysLede")}>
      {error !== null ? <FormMessage tone="error">{error}</FormMessage> : null}
      {passkeys.length === 0 ? (
        <p className="text-sm">{t("passkeysNone")}</p>
      ) : (
        <ul className="divide-hairline border-hairline divide-y border-y" data-agent-id="account:passkeys">
          {passkeys.map((passkey) => {
            const name = passkey.name ?? t("passkeyDefaultName");
            return (
              <li key={passkey.id} className="flex items-center justify-between gap-4 py-3 text-sm">
                <span>
                  <span className="font-medium">{name}</span>
                  {passkey.createdAt !== null ? <span className="text-slate block">{t("passkeyCreated", { date: format.dateTime(new Date(passkey.createdAt), { dateStyle: "medium" }) })}</span> : null}
                </span>
                <Button variant="tertiary" size="sm" onClick={() => remove(passkey.id)} aria-disabled={pending} aria-label={t("passkeyRemoveLabel", { name })}>
                  {t("passkeyRemove")}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
      <div>
        <Button variant="secondary" onClick={add} aria-disabled={pending} data-agent-id="action:add-passkey">
          {pending ? t("passkeyAdding") : t("passkeyAdd")}
        </Button>
      </div>
    </Panel>
  );
}

/* -------------------------------------------------------------------------- */

/** The secret in an otpauth:// URI, for people who type it rather than scan it. */
function secretOf(uri: string): string {
  try {
    return (new URL(uri).searchParams.get("secret") ?? "").replace(/(.{4})/g, "$1 ").trim();
  } catch {
    return "";
  }
}

export function TwoFactorPanel({ enabled }: { enabled: boolean }) {
  const hydrated = useHydrated();
  const t = useTranslations("auth");
  const failureText = useFailureText();
  const router = useRouter();
  const toast = useToast();
  const [step, setStep] = useState<"idle" | "password" | "scan" | "codes">("idle");
  const [setup, setSetup] = useState<{ uri: string; backupCodes: string[] } | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setStep("idle");
    setSetup(null);
    setError(null);
  };

  const confirmPassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    const password = String(new FormData(event.currentTarget).get("password") ?? "");
    setPending(true);
    setError(null);
    if (enabled) {
      const { error: failure } = await authClient.twoFactor.disable({ password });
      setPending(false);
      if (failure) return setError(failureText(failure));
      toast({ title: t("twoFactorDisabled") });
      reset();
      router.refresh();
      return;
    }
    const { data, error: failure } = await authClient.twoFactor.enable({ password });
    setPending(false);
    // The shop uses authenticator apps only; the email-code variant is never configured.
    if (failure || data === null || data.method !== "totp") return setError(failureText(failure));
    setSetup({ uri: data.totpURI, backupCodes: data.backupCodes });
    setStep("scan");
  };

  const confirmCode = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    const code = String(new FormData(event.currentTarget).get("code") ?? "").replace(/\s+/g, "");
    setPending(true);
    setError(null);
    const { error: failure } = await authClient.twoFactor.verifyTotp({ code });
    setPending(false);
    if (failure) return setError(failureText(failure));
    setStep("codes");
  };

  return (
    <Panel id="two-factor" title={t("twoFactor")}>
      <p className="max-w-[60ch] text-sm" data-agent-id="account:two-factor-state">
        {enabled || step === "codes" ? t("twoFactorOn") : t("twoFactorOff")}
      </p>
      {error !== null ? <FormMessage tone="error">{error}</FormMessage> : null}

      {step === "idle" ? (
        <div>
          <Button variant="secondary" onClick={() => setStep("password")} data-agent-id={enabled ? "action:disable-2fa" : "action:enable-2fa"}>
            {enabled ? t("twoFactorDisable") : t("twoFactorEnable")}
          </Button>
        </div>
      ) : null}

      {step === "password" ? (
        <form onSubmit={confirmPassword} method="post" noValidate className="flex max-w-md flex-col gap-4">
          <PasswordField label={t("password")} name="password" autoComplete="current-password" hint={t("twoFactorPasswordLede")} required data-agent-id="auth:2fa-password" />
          <div className="flex flex-wrap gap-3">
            <Button type="submit" disabled={!hydrated} aria-disabled={pending} data-agent-id="action:2fa-password">
              {enabled ? t("twoFactorDisable") : t("verifyAction")}
            </Button>
            <Button variant="tertiary" onClick={reset}>
              {t("cancel")}
            </Button>
          </div>
        </form>
      ) : null}

      {step === "scan" && setup !== null ? (
        <div className="flex flex-col gap-5">
          <p className="max-w-[60ch] text-sm">{t("twoFactorScan")}</p>
          <div className="flex flex-wrap items-start gap-6">
            <QrCode value={setup.uri} label={t("twoFactorQrLabel")} />
            <div className="flex min-w-0 flex-col gap-2 text-sm">
              <span className="text-slate">{t("twoFactorManual")}</span>
              <code className="bg-plinth rounded-plinth tabular px-2 py-1 break-all" data-agent-id="account:totp-secret">
                {secretOf(setup.uri)}
              </code>
            </div>
          </div>
          <form onSubmit={confirmCode} method="post" noValidate className="flex max-w-md flex-col gap-4">
            <Field label={t("code")} name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} required className="max-w-48" inputClassName="tabular text-lg tracking-[0.3em]" data-agent-id="auth:2fa-code" />
            <div className="flex flex-wrap gap-3">
              <Button type="submit" disabled={!hydrated} aria-disabled={pending} data-agent-id="action:confirm-2fa">
                {t("twoFactorConfirm")}
              </Button>
              <Button variant="tertiary" onClick={reset}>
                {t("cancel")}
              </Button>
            </div>
          </form>
        </div>
      ) : null}

      {step === "codes" && setup !== null ? (
        <div className="flex flex-col gap-4" data-agent-id="account:backup-codes">
          <FormMessage tone="info">{t("twoFactorEnabled")}</FormMessage>
          <h4 className="font-medium">{t("backupCodesTitle")}</h4>
          <p className="text-slate max-w-[60ch] text-sm">{t("backupCodesLede")}</p>
          <ul className="bg-plinth rounded-plinth tabular grid max-w-md grid-cols-2 gap-x-6 gap-y-1 p-4 text-sm">
            {setup.backupCodes.map((code) => (
              <li key={code}>{code}</li>
            ))}
          </ul>
          <div>
            <Button
              onClick={() => {
                reset();
                router.refresh();
              }}
              data-agent-id="action:backup-codes-saved"
            >
              {t("backupCodesDone")}
            </Button>
          </div>
        </div>
      ) : null}
    </Panel>
  );
}

/* -------------------------------------------------------------------------- */

export type SessionItem = { token: string; device: Device; createdAt: string; current: boolean };

export function SessionsPanel({ sessions }: { sessions: SessionItem[] }) {
  const t = useTranslations("auth");
  const format = useFormatter();
  const failureText = useFailureText();
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const label = (device: Device) =>
    device.browser !== null && device.system !== null ? t("deviceOn", { browser: device.browser, system: device.system }) : (device.browser ?? device.system ?? t("unknownDevice"));

  const revoke = (token: string) =>
    !pending &&
    startTransition(async () => {
      const { error: failure } = await authClient.revokeSession({ token });
      if (failure) return setError(failureText(failure));
      toast({ title: t("deviceSignedOut") });
      router.refresh();
    });

  const revokeOthers = () =>
    !pending &&
    startTransition(async () => {
      const { error: failure } = await authClient.revokeOtherSessions();
      if (failure) return setError(failureText(failure));
      toast({ title: t("othersSignedOut") });
      router.refresh();
    });

  return (
    <Panel id="sessions" title={t("sessions")} lede={t("sessionsLede")}>
      {error !== null ? <FormMessage tone="error">{error}</FormMessage> : null}
      <ul className="divide-hairline border-hairline divide-y border-y" data-agent-id="account:sessions">
        {sessions.map((session) => (
          <li key={session.token} className="flex items-center justify-between gap-4 py-3 text-sm">
            <span>
              <span className="font-medium">{label(session.device)}</span>
              {session.current ? <span className="bg-plinth text-dusk ml-2 rounded-full px-2 py-0.5 text-xs font-medium">{t("thisDevice")}</span> : null}
              <span className="text-slate block">{t("sessionSince", { date: format.dateTime(new Date(session.createdAt), { dateStyle: "medium", timeStyle: "short" }) })}</span>
            </span>
            {session.current ? null : (
              <Button variant="tertiary" size="sm" onClick={() => revoke(session.token)} aria-disabled={pending} aria-label={t("signOutDeviceLabel", { device: label(session.device) })}>
                {t("signOutDevice")}
              </Button>
            )}
          </li>
        ))}
      </ul>
      {sessions.length > 1 ? (
        <div>
          <Button variant="secondary" onClick={revokeOthers} aria-disabled={pending} data-agent-id="action:sign-out-others">
            {t("signOutOthers")}
          </Button>
        </div>
      ) : null}
    </Panel>
  );
}

/* -------------------------------------------------------------------------- */

export function PasswordPanel() {
  const hydrated = useHydrated();
  const t = useTranslations("auth");
  const failureText = useFailureText();
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    const form = new FormData(event.currentTarget);
    const currentPassword = String(form.get("current") ?? "");
    const newPassword = String(form.get("next") ?? "");
    if (newPassword.length < MIN_PASSWORD_LENGTH) return setError(t("errorPasswordShort", { min: MIN_PASSWORD_LENGTH }));
    setPending(true);
    setError(null);
    const { error: failure } = await authClient.changePassword({ currentPassword, newPassword, revokeOtherSessions: true });
    setPending(false);
    if (failure) return setError(failureText(failure));
    toast({ title: t("passwordChanged"), tone: "success" });
    setOpen(false);
    router.refresh();
  };

  return (
    <Panel id="password" title={t("passwordSection")}>
      {error !== null ? <FormMessage tone="error">{error}</FormMessage> : null}
      {open ? (
        <form onSubmit={submit} method="post" noValidate className="flex max-w-md flex-col gap-4">
          <PasswordField label={t("currentPassword")} name="current" autoComplete="current-password" required />
          <PasswordField label={t("newPassword")} name="next" autoComplete="new-password" hint={t("passwordHint", { min: MIN_PASSWORD_LENGTH })} required />
          <div className="flex flex-wrap gap-3">
            <Button type="submit" disabled={!hydrated} aria-disabled={pending}>
              {pending ? t("saving") : t("changePassword")}
            </Button>
            <Button variant="tertiary" onClick={() => setOpen(false)}>
              {t("cancel")}
            </Button>
          </div>
        </form>
      ) : (
        <div>
          <Button variant="secondary" onClick={() => setOpen(true)}>
            {t("changePassword")}
          </Button>
        </div>
      )}
    </Panel>
  );
}

/* -------------------------------------------------------------------------- */

export function SignOutButton({ locale }: { locale: string }) {
  const t = useTranslations("account");
  const [pending, setPending] = useState(false);
  return (
    <Button
      variant="secondary"
      aria-disabled={pending}
      data-agent-id="action:sign-out"
      onClick={async () => {
        if (pending) return;
        setPending(true);
        await authClient.signOut();
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- a full load after signing out, so no client cache keeps the account's data
        window.location.assign(`/${locale}`);
      }}
    >
      {pending ? t("signingOut") : t("signOut")}
    </Button>
  );
}
