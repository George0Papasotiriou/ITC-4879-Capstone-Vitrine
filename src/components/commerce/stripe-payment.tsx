"use client";

/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Paying for an order with Stripe: the Payment Element, Apple Pay and Google Pay, then waiting for the bank.
 */

import { Elements, ExpressCheckoutElement, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { loadStripe, type Appearance, type Stripe } from "@stripe/stripe-js";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { useRouter } from "@/i18n/navigation";

/**
 * docs/adr/038. The card form is Stripe's own, in frames served by Stripe: the
 * card number never reaches this shop. The order page asks the server for the
 * order's PaymentIntent, shows the form, and after the bank says yes waits for
 * the webhook — the only thing that marks the order paid — by refreshing the
 * page every two seconds until it has.
 */

const stripes = new Map<string, Promise<Stripe | null>>();

/** Stripe's look from the shop's own design tokens, read once the page has them. */
function appearance(): Appearance {
  const style = getComputedStyle(document.documentElement);
  const token = (name: string) => style.getPropertyValue(name).trim() || undefined;
  return {
    theme: "stripe",
    variables: {
      colorPrimary: token("--color-dusk"),
      colorText: token("--color-dusk"),
      colorTextSecondary: token("--color-slate"),
      colorDanger: token("--color-danger"),
      colorBackground: token("--color-white"),
      fontFamily: token("--font-sans"),
      borderRadius: token("--radius-plinth"),
    },
  };
}

type Started = { clientSecret: string; publishableKey: string };

export function StripePayment({ orderId, token, amount }: { orderId: string; token: string | null; amount: string }) {
  const t = useTranslations("order");
  const locale = useLocale();
  const [started, setStarted] = useState<Started | "failed" | null>(null);

  useEffect(() => {
    let live = true;
    fetch(`/api/orders/${orderId}/payment`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(token === null ? {} : { token }),
    })
      .then((response) => response.json() as Promise<{ ok: boolean } & Partial<Started>>)
      .then((body) => {
        if (!live) return;
        setStarted(body.ok && body.clientSecret !== undefined && body.publishableKey !== undefined ? { clientSecret: body.clientSecret, publishableKey: body.publishableKey } : "failed");
      })
      .catch(() => live && setStarted("failed"));
    return () => {
      live = false;
    };
  }, [orderId, token]);

  return (
    <section aria-labelledby="pay-title" className="border-hairline rounded-plinth flex flex-col gap-4 border p-5" data-agent-id="order:payment">
      <h2 id="pay-title" className="font-display text-xl">
        {t("payTitle")}
      </h2>
      <p className="text-slate max-w-[60ch] text-sm">{t("payBody")}</p>
      {started === null ? (
        <p className="text-slate text-sm" role="status">
          {t("payLoading")}
        </p>
      ) : started === "failed" ? (
        <p className="text-danger text-sm" role="alert">
          {t("payUnavailable")}
        </p>
      ) : (
        <PaymentForm started={started} locale={locale} amount={amount} />
      )}
    </section>
  );
}

function PaymentForm({ started, locale, amount }: { started: Started; locale: string; amount: string }) {
  const stripe = stripes.get(started.publishableKey) ?? loadStripe(started.publishableKey);
  stripes.set(started.publishableKey, stripe);
  const [look] = useState(appearance);
  return (
    <Elements stripe={stripe} options={{ clientSecret: started.clientSecret, appearance: look, locale: locale === "el" ? "el" : "en" }}>
      <Pay amount={amount} />
    </Elements>
  );
}

function Pay({ amount }: { amount: string }) {
  const t = useTranslations("order");
  const stripe = useStripe();
  const elements = useElements();
  const router = useRouter();
  const [state, setState] = useState<{ kind: "idle" } | { kind: "paying" } | { kind: "confirming" } | { kind: "error"; message: string }>({ kind: "idle" });
  const polling = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => {
    if (polling.current !== null) clearInterval(polling.current);
  }, []);

  const confirm = async () => {
    if (stripe === null || elements === null || state.kind === "paying" || state.kind === "confirming") return;
    setState({ kind: "paying" });
    const { error } = await stripe.confirmPayment({
      elements,
      // Back to this very page after a bank's own check (3-D Secure), which some cards ask for.
      confirmParams: { return_url: window.location.href },
      redirect: "if_required",
    });
    if (error !== undefined) {
      setState({ kind: "error", message: error.message ?? "" });
      return;
    }
    setState({ kind: "confirming" });
    // The webhook marks the order paid and the page hears of it at once (OrderLive); this slower
    // refresh is only for a browser whose live connection was cut.
    polling.current = setInterval(() => router.refresh(), 5000);
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void confirm();
  };

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <ExpressCheckoutElement onConfirm={() => void confirm()} />
      <PaymentElement options={{ layout: "tabs" }} />
      <Button type="submit" aria-disabled={stripe === null || state.kind === "paying" || state.kind === "confirming" || undefined} data-agent-id="action:pay">
        {state.kind === "paying" ? t("paying") : t("payButton", { amount })}
      </Button>
      <p className="text-sm" role="status" aria-live="polite">
        {state.kind === "confirming" ? t("confirming") : null}
      </p>
      {state.kind === "error" ? (
        <p className="text-danger text-sm" role="alert">
          {t("payError", { message: state.message })}
        </p>
      ) : null}
    </form>
  );
}
