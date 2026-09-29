/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * "Your AI assistants": the shop's MCP address, the shopper's agent keys, and what an assistant in the browser can do.
 */

import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { AgentKeys, McpAddress, type AgentKeyItem } from "@/components/account/agent-keys";
import { WebMcpStatus } from "@/components/concierge/webmcp-status";
import { SmartLink } from "@/components/ui/smart-link";
import { serverEnv } from "@/env";
import { requireLocale } from "@/i18n/params";
import { agentKeys } from "@/lib/ai/surfaces/mcp/server";
import { requireUser } from "@/lib/auth/session";

/** docs/adr/043. Signed-in only: keys act for an account. */

/** The person's keys as the page shows them, with the moment they were read, so "last used" is measured from the same instant on server and client. */
async function keysOf(userId: string): Promise<{ keys: AgentKeyItem[]; at: string }> {
  const at = new Date();
  const keys = (await (await agentKeys()).list(userId, at)).map((key) => ({
    ...key,
    createdAt: key.createdAt.toISOString(),
    expiresAt: key.expiresAt.toISOString(),
    lastUsedAt: key.lastUsedAt?.toISOString() ?? null,
  }));
  return { keys, at: at.toISOString() };
}

export async function generateMetadata({ params }: PageProps<"/[locale]/account/agents">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "agents" });
  return { title: t("title"), robots: { index: false, follow: false } };
}

export default async function AgentsPage({ params }: PageProps<"/[locale]/account/agents">) {
  const locale = await requireLocale(params);
  const user = await requireUser(locale, `/${locale}/account/agents`);
  const t = await getTranslations("agents");
  const { keys, at } = await keysOf(user.id);
  const mcpUrl = new URL("/api/mcp", serverEnv().APP_URL).toString();

  return (
    <main className="mx-auto w-full max-w-[900px] px-6 py-10 md:px-10 md:py-16" data-agent-id="agents:page">
      <p className="text-slate text-sm">
        <SmartLink href="/account" className="underline-offset-4 hover:underline">
          {t("back")}
        </SmartLink>
      </p>
      <h1 className="font-display mt-4 text-3xl">{t("title")}</h1>
      <p className="text-slate mt-3 max-w-[62ch]">{t("lede")}</p>

      <section aria-labelledby="connect-heading" className="border-hairline mt-12 flex flex-col gap-4 border-t pt-8">
        <h2 id="connect-heading" className="font-display text-2xl">
          {t("connectTitle")}
        </h2>
        <p className="text-slate max-w-[62ch]">{t("connectLede")}</p>
        <McpAddress url={mcpUrl} />
      </section>

      <section aria-labelledby="keys-section-heading" className="border-hairline mt-12 flex flex-col gap-6 border-t pt-8">
        <h2 id="keys-section-heading" className="font-display text-2xl">
          {t("keysTitle")}
        </h2>
        <p className="text-slate max-w-[62ch]">{t("keysLede")}</p>
        <AgentKeys keys={keys} now={at} mcpUrl={mcpUrl} canCreate={user.emailVerified} />
      </section>

      <section aria-labelledby="browser-heading" className="border-hairline mt-12 flex flex-col gap-4 border-t pt-8">
        <h2 id="browser-heading" className="font-display text-2xl">
          {t("browserTitle")}
        </h2>
        <p className="text-slate max-w-[62ch]">{t("browserLede")}</p>
        <WebMcpStatus />
      </section>
    </main>
  );
}
