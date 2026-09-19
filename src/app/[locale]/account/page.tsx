/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Account page: orders, security (passkeys, two-step sign-in, devices, password) and privacy controls.
 */

import type { Metadata } from "next";
import Image from "next/image";
import { headers } from "next/headers";
import { getFormatter, getTranslations } from "next-intl/server";

import { FormMessage } from "@/components/account/auth-forms";
import { PasskeysPanel, PasswordPanel, SessionsPanel, SignOutButton, TwoFactorPanel, type PasskeyItem, type SessionItem } from "@/components/account/security";
import { PersonalizationControl } from "@/components/reco/personalization-control";
import { ButtonLink } from "@/components/ui/button";
import { SmartLink } from "@/components/ui/smart-link";
import { requireLocale } from "@/i18n/params";
import { describeDevice } from "@/lib/auth/paths";
import { isStaff, type Role } from "@/lib/auth/roles";
import { auth } from "@/lib/auth/server";
import { currentUser } from "@/lib/auth/session";
import { formatMoney } from "@/lib/commerce/money";
import { commerce, orderOwner } from "@/lib/commerce/server";
import { currentActor } from "@/lib/reco/server";

/**
 * The account (docs/adr/016). Signed out, it invites a sign-in and keeps the
 * privacy controls that work without an account. Signed in, it shows the
 * person's orders — those placed signed in, and guest orders under the address
 * once it is confirmed — and everything that secures the account. Lists come
 * from the server with the person's own session; nothing here is cached.
 */

export async function generateMetadata({ params }: PageProps<"/[locale]/account">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "account" });
  return { title: t("title"), robots: { index: false, follow: false } };
}

const ROLE_KEYS: Record<Role, "roleCustomer" | "roleSupport" | "roleMerchandiser" | "roleAdmin"> = {
  customer: "roleCustomer",
  support: "roleSupport",
  merchandiser: "roleMerchandiser",
  admin: "roleAdmin",
};

export default async function AccountPage({ params, searchParams }: PageProps<"/[locale]/account">) {
  const locale = await requireLocale(params);
  const t = await getTranslations("account");
  const p = await getTranslations("personalization");
  const o = await getTranslations("order");
  const personalizationEnabled = (await currentActor()) !== null;
  const user = await currentUser();

  const privacy = (
    <section className="border-hairline mt-16 border-t pt-10" aria-labelledby="privacy-heading">
      <h2 id="privacy-heading" className="font-display text-2xl">
        {t("privacy")}
      </h2>
      <h3 className="mt-6 text-base font-medium">{p("title")}</h3>
      <div className="mt-3">
        <PersonalizationControl enabled={personalizationEnabled} />
      </div>
    </section>
  );

  if (user === null) {
    return (
      <main className="mx-auto w-full max-w-[1440px] px-6 py-10 md:px-10 md:py-16">
        <h1 className="font-display text-3xl">{t("title")}</h1>
        <p className="text-slate mt-4 max-w-[52ch]">{t("signInDescription")}</p>
        <div className="mt-8 flex flex-wrap gap-3">
          <ButtonLink href="/account/sign-in" data-agent-id="action:go-sign-in">
            {t("signIn")}
          </ButtonLink>
          <ButtonLink href="/account/sign-up" variant="secondary" data-agent-id="action:go-sign-up">
            {t("createAccount")}
          </ButtonLink>
        </div>
        {privacy}
      </main>
    );
  }

  const requestHeaders = await headers();
  const store = await commerce();
  const format = await getFormatter();
  const [orders, passkeys, sessions] = await Promise.all([
    store.ordersForOwner(orderOwner(user)),
    auth().api.listPasskeys({ headers: requestHeaders }),
    auth().api.listSessions({ headers: requestHeaders }),
  ]);
  const verified = (await searchParams).verified === "1";

  const passkeyItems: PasskeyItem[] = passkeys.map((passkey) => ({
    id: passkey.id,
    name: passkey.name ?? null,
    createdAt: passkey.createdAt === undefined || passkey.createdAt === null ? null : new Date(passkey.createdAt).toISOString(),
  }));
  const sessionItems: SessionItem[] = sessions
    .map((session) => ({
      token: session.token,
      device: describeDevice(session.userAgent),
      createdAt: new Date(session.createdAt).toISOString(),
      current: session.id === user.sessionId,
    }))
    .sort((a, b) => Number(b.current) - Number(a.current) || b.createdAt.localeCompare(a.createdAt));

  return (
    <main className="mx-auto w-full max-w-[1100px] px-6 py-10 md:px-10 md:py-16" data-agent-id="account:signed-in">
      {verified ? (
        <div className="mb-8">
          <FormMessage tone="info">{t("verifiedBanner")}</FormMessage>
        </div>
      ) : null}
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <h1 className="font-display text-3xl">{t("hello", { name: user.name })}</h1>
          <p className="text-slate mt-2" data-agent-id="account:email">
            {t("signedInAs", { email: user.email })}
          </p>
          {isStaff(user.roles) ? <p className="text-slate mt-1 text-sm">{t("roles", { roles: user.roles.map((role) => t(ROLE_KEYS[role])).join(", ") })}</p> : null}
        </div>
        <SignOutButton locale={locale} />
      </div>
      {!user.emailVerified ? (
        <div className="mt-6">
          <FormMessage tone="info">{t("unverified")}</FormMessage>
        </div>
      ) : null}

      <section className="mt-12" aria-labelledby="orders-heading">
        <h2 id="orders-heading" className="font-display text-2xl">
          {t("orders")}
        </h2>
        {orders.length === 0 ? (
          <p className="text-slate mt-4 max-w-[60ch]">{t("ordersEmpty", { email: user.email })}</p>
        ) : (
          <ul className="border-hairline divide-hairline mt-6 divide-y border-y" data-agent-id="account:orders">
            {orders.map((order) => (
              <li key={order.id}>
                <SmartLink
                  href={`/orders/${order.id}`}
                  className="hover:bg-dusk/[0.03] flex items-center gap-4 py-4 no-underline transition-colors"
                  aria-label={t("viewOrder", { number: order.number })}
                  data-agent-id={`account:order:${order.number}`}
                >
                  <span className="bg-plinth rounded-plinth relative size-16 shrink-0 overflow-hidden">
                    {order.imageSrc !== null ? <Image src={order.imageSrc} alt="" fill sizes="64px" className="object-contain mix-blend-multiply" /> : null}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="font-medium">{order.number}</span>
                    <span className="text-slate text-sm">
                      {format.dateTime(order.createdAt, { dateStyle: "medium" })} · {t("orderItems", { count: order.itemCount })}
                    </span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-1 text-sm">
                    <span className="tabular font-medium">{formatMoney(order.total, locale)}</span>
                    <span className="text-slate">{o(`status.${order.status}`)}</span>
                  </span>
                </SmartLink>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-16 flex flex-col gap-8" aria-labelledby="security-heading">
        <h2 id="security-heading" className="font-display text-2xl">
          {t("security")}
        </h2>
        <PasskeysPanel passkeys={passkeyItems} />
        <TwoFactorPanel enabled={user.twoFactorEnabled} />
        <SessionsPanel sessions={sessionItems} />
        <PasswordPanel />
      </section>

      {privacy}
    </main>
  );
}
