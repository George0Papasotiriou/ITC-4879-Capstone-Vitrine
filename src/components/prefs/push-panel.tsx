"use client";

/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Notifications on this device: what they are about, turned on only when the shopper asks, and off again as easily.
 */

import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { FormMessage } from "@/components/account/auth-forms";
import { Button } from "@/components/ui/button";
import { useHydrated } from "@/components/ui/use-hydrated";
import { PUSH_TOPICS, type PushTopic } from "@/lib/push/notices";

/**
 * docs/adr/044. The browser's permission prompt appears only after the
 * shopper presses the button, never on arrival. Which topics a device hears
 * about is kept with the subscription; turning off removes it from the shop.
 */

type State = "checking" | "unsupported" | "blocked" | "off" | "on";

/** The browser wants the shop's public key as bytes. */
function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64url.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function registration(): Promise<ServiceWorkerRegistration> {
  // The worker is registered after load in production; here it is made sure of, since push needs it.
  const existing = await navigator.serviceWorker.getRegistration("/");
  if (existing !== undefined) return existing;
  await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  return navigator.serviceWorker.ready;
}

export function PushPanel({ publicKey, signedIn }: { publicKey: string | null; signedIn: boolean }) {
  const t = useTranslations("prefs.push");
  const locale = useLocale();
  const hydrated = useHydrated();
  const [state, setState] = useState<State>("checking");
  const [topics, setTopics] = useState<PushTopic[]>([...PUSH_TOPICS]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
      let next: State = "off";
      let saved: PushTopic[] | null = null;
      if (!supported) next = "unsupported";
      else if (Notification.permission === "denied") next = "blocked";
      else {
        const existing = await (await navigator.serviceWorker.getRegistration("/"))?.pushManager.getSubscription();
        if (existing != null) {
          const response = await fetch("/api/push/state", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ endpoint: existing.endpoint }) }).catch(() => null);
          const body = (await response?.json().catch(() => null)) as { subscribed: boolean; topics: PushTopic[] } | null;
          if (body?.subscribed === true) {
            next = "on";
            saved = body.topics;
          }
        }
      }
      if (cancelled) return;
      setState(next);
      if (saved !== null) setTopics(saved);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const save = async (chosen: PushTopic[]) => {
    const subscription = await (await registration()).pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey!) });
    const response = await fetch("/api/push", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ subscription: subscription.toJSON(), topics: chosen, locale }) }).catch(() => null);
    if (response?.ok !== true) throw new Error("subscribe");
  };

  const turnOn = async () => {
    setBusy(true);
    setError(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "blocked" : "off");
        return;
      }
      await save(topics);
      setState("on");
    } catch {
      setError(t("failed"));
    } finally {
      setBusy(false);
    }
  };

  const turnOff = async () => {
    setBusy(true);
    setError(null);
    try {
      const subscription = await (await navigator.serviceWorker.getRegistration("/"))?.pushManager.getSubscription();
      if (subscription != null) {
        await fetch("/api/push", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ endpoint: subscription.endpoint }) });
        await subscription.unsubscribe();
      }
      setState("off");
    } catch {
      setError(t("failed"));
    } finally {
      setBusy(false);
    }
  };

  const toggleTopic = async (topic: PushTopic, checked: boolean) => {
    const chosen = checked ? [...new Set([...topics, topic])] : topics.filter((entry) => entry !== topic);
    if (chosen.length === 0) return;
    setTopics(chosen);
    if (state !== "on") return;
    try {
      await save(chosen);
    } catch {
      setError(t("failed"));
    }
  };

  if (publicKey === null) return <p className="text-slate text-sm">{t("notOffered")}</p>;
  if (!signedIn) return <p className="text-slate text-sm">{t("signIn")}</p>;

  return (
    <div className="flex flex-col gap-4" data-agent-id="prefs:push">
      <p className="text-sm" role="status" data-agent-id="prefs:push-state">
        {t(`state.${state}`)}
      </p>
      {state === "unsupported" || state === "checking" ? null : (
        <>
          <fieldset className="flex flex-col gap-1">
            <legend className="text-sm font-medium">{t("topicsLabel")}</legend>
            {PUSH_TOPICS.map((topic) => (
              <label key={topic} className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
                <input
                  type="checkbox"
                  className="accent-dusk size-5"
                  checked={topics.includes(topic)}
                  disabled={!hydrated || busy || (topics.length === 1 && topics.includes(topic))}
                  onChange={(event) => void toggleTopic(topic, event.currentTarget.checked)}
                  data-agent-id={`prefs:push-topic:${topic}`}
                />
                {t(`topics.${topic}`)}
              </label>
            ))}
          </fieldset>
          <div>
            {state === "on" ? (
              <Button variant="secondary" disabled={!hydrated || busy} onClick={() => void turnOff()} data-agent-id="action:push-off">
                {t("turnOff")}
              </Button>
            ) : state === "off" ? (
              <Button disabled={!hydrated || busy} onClick={() => void turnOn()} data-agent-id="action:push-on">
                {t("turnOn")}
              </Button>
            ) : null}
          </div>
        </>
      )}
      {error !== null ? <FormMessage tone="error">{error}</FormMessage> : null}
    </div>
  );
}
