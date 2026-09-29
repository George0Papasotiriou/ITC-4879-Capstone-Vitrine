"use client";

/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * The shopper's agent keys: make one (shown once), see what each may do and when it was used, revoke it.
 */

import { useFormatter, useTranslations } from "next-intl";
import { useId, useState, useTransition, type FormEvent } from "react";

import { FormMessage } from "@/components/account/auth-forms";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { useHydrated } from "@/components/ui/use-hydrated";
import { useRouter } from "@/i18n/navigation";
import { AGENT_KEY_DAYS, AGENT_SCOPES, type AgentScope } from "@/lib/agents/tokens";
import { cn } from "@/lib/ui/cn";

/** docs/adr/043. The list comes from the server; after a change the page refreshes, so what is shown is what is stored. */

export type AgentKeyItem = {
  id: string;
  name: string;
  hint: string;
  scopes: AgentScope[];
  createdAt: string;
  expiresAt: string;
  lastUsedAt: string | null;
  state: "active" | "expired" | "revoked";
};

function CopyButton({ text, label, agentId }: { text: string; label: string; agentId: string }) {
  const t = useTranslations("agents");
  const hydrated = useHydrated();
  const [copied, setCopied] = useState(false);
  return (
    <span className="inline-flex items-center gap-3">
      <Button
        variant="secondary"
       
        disabled={!hydrated}
        onClick={() =>
          void navigator.clipboard
            ?.writeText(text)
            .then(() => setCopied(true))
            .catch(() => setCopied(false))
        }
        data-agent-id={agentId}
      >
        {label}
      </Button>
      <span className="text-slate text-sm" role="status" aria-live="polite">
        {copied ? t("copied") : ""}
      </span>
    </span>
  );
}

export function McpAddress({ url }: { url: string }) {
  const t = useTranslations("agents");
  return (
    <div className="flex flex-col gap-3">
      <code className="bg-plinth/70 rounded-plinth block overflow-x-auto px-4 py-3 text-sm whitespace-nowrap" data-agent-id="agents:mcp-url">
        {url}
      </code>
      <CopyButton text={url} label={t("copyAddress")} agentId="action:copy-mcp-url" />
    </div>
  );
}

export function AgentKeys({ keys, now, mcpUrl, canCreate }: { keys: AgentKeyItem[]; now: string; mcpUrl: string; canCreate: boolean }) {
  const t = useTranslations("agents");
  const format = useFormatter();
  const router = useRouter();
  const toast = useToast();
  const hydrated = useHydrated();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [made, setMade] = useState<{ key: string; name: string } | null>(null);
  const [scopes, setScopes] = useState<AgentScope[]>(["cart"]);
  const scopesId = useId();
  const daysId = useId();
  const active = keys.filter((key) => key.state === "active").length;

  const create = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") ?? "").trim();
    const days = Number(form.get("days"));
    if (name === "") {
      setError(t("errors.name"));
      return;
    }
    if (scopes.length === 0) {
      setError(t("errors.scopes"));
      return;
    }
    startTransition(async () => {
      setError(null);
      const response = await fetch("/api/agents", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, scopes, days }) }).catch(() => null);
      const body = (await response?.json().catch(() => null)) as { ok: boolean; key?: string; reason?: string } | null;
      if (body?.ok !== true || body.key === undefined) {
        setError(t(body?.reason === "too_many" ? "errors.tooMany" : body?.reason === "verify_email" ? "errors.verify" : "errors.failed"));
        return;
      }
      setMade({ key: body.key, name });
      router.refresh();
    });
  };

  const revoke = (id: string) =>
    startTransition(async () => {
      const response = await fetch(`/api/agents/${id}`, { method: "DELETE" }).catch(() => null);
      if (response?.ok !== true) {
        setError(t("errors.failed"));
        return;
      }
      toast({ title: t("revoked"), tone: "success" });
      router.refresh();
    });

  const config = made === null ? "" : JSON.stringify({ mcpServers: { vitrine: { type: "http", url: mcpUrl, headers: { Authorization: `Bearer ${made.key}` } } } }, null, 2);
  const when = (iso: string) => format.dateTime(new Date(iso), { dateStyle: "medium" });

  return (
    <div className="flex flex-col gap-10">
      {made !== null ? (
        <section aria-labelledby="new-key-heading" className="border-dusk rounded-plinth flex flex-col gap-4 border-2 p-5" data-agent-id="agents:new-key">
          <h3 id="new-key-heading" className="text-lg font-medium">
            {t("newKeyTitle", { name: made.name })}
          </h3>
          <p className="text-slate max-w-[60ch] text-sm">{t("newKeyOnce")}</p>
          <code className="bg-plinth/70 rounded-plinth block overflow-x-auto px-4 py-3 text-sm break-all" data-agent-id="agents:new-key-value">
            {made.key}
          </code>
          <CopyButton text={made.key} label={t("copyKey")} agentId="action:copy-agent-key" />
          <p className="text-slate max-w-[60ch] text-sm">{t("configHint")}</p>
          <pre className="bg-plinth/70 rounded-plinth overflow-x-auto px-4 py-3 text-xs leading-relaxed" data-agent-id="agents:config">
            {config}
          </pre>
          <CopyButton text={config} label={t("copyConfig")} agentId="action:copy-agent-config" />
          <div>
            <Button variant="tertiary" onClick={() => setMade(null)} data-agent-id="action:hide-agent-key">
              {t("hideKey")}
            </Button>
          </div>
        </section>
      ) : null}

      {canCreate ? (
        <form onSubmit={create} className="flex max-w-[34rem] flex-col gap-5" aria-labelledby="make-key-heading" noValidate>
          <h3 id="make-key-heading" className="text-lg font-medium">
            {t("makeTitle")}
          </h3>
          <Field name="name" label={t("nameLabel")} hint={t("nameHint")} maxLength={60} autoComplete="off" data-agent-id="agents:name" />
          <fieldset className="flex flex-col gap-2" aria-describedby={scopesId}>
            <legend className="text-sm font-medium">{t("scopesLabel")}</legend>
            <p id={scopesId} className="text-slate text-sm">
              {t("scopesHint")}
            </p>
            {AGENT_SCOPES.map((scope) => (
              <label key={scope} className="flex min-h-11 cursor-pointer items-start gap-3 pt-2 text-sm">
                <input
                  type="checkbox"
                  className="accent-dusk mt-0.5 size-5"
                  checked={scopes.includes(scope)}
                  onChange={(event) => setScopes((current) => (event.currentTarget.checked ? [...current, scope] : current.filter((entry) => entry !== scope)))}
                  data-agent-id={`agents:scope:${scope}`}
                />
                <span>
                  <span className="block font-medium">{t(`scopes.${scope}.title`)}</span>
                  <span className="text-slate block">{t(`scopes.${scope}.detail`)}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <div className="flex flex-col gap-2">
            <label htmlFor={daysId} className="text-sm font-medium">
              {t("daysLabel")}
            </label>
            <select id={daysId} name="days" defaultValue="30" className="border-hairline rounded-plinth bg-white h-11 max-w-[16rem] border px-3 text-sm" data-agent-id="agents:days">
              {AGENT_KEY_DAYS.map((days) => (
                <option key={days} value={days}>
                  {t("days", { days })}
                </option>
              ))}
            </select>
          </div>
          {error !== null ? <FormMessage tone="error">{error}</FormMessage> : null}
          <div>
            <Button type="submit" disabled={!hydrated || pending || active >= 5} data-agent-id="action:make-agent-key">
              {t("make")}
            </Button>
          </div>
          {active >= 5 ? <p className="text-slate text-sm">{t("errors.tooMany")}</p> : null}
        </form>
      ) : (
        <FormMessage tone="info">{t("verifyFirst")}</FormMessage>
      )}

      <section aria-labelledby="keys-heading" className="flex flex-col gap-4">
        <h3 id="keys-heading" className="text-lg font-medium">
          {t("listTitle")}
        </h3>
        {keys.length === 0 ? (
          <p className="text-slate text-sm">{t("none")}</p>
        ) : (
          <ul className="border-hairline flex flex-col border-t" data-agent-id="agents:list">
            {keys.map((key) => (
              <li key={key.id} className="border-hairline flex flex-col gap-2 border-b py-4 sm:flex-row sm:items-center sm:justify-between" data-agent-id={`agents:key:${key.id}`}>
                <div className="flex min-w-0 flex-col gap-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-medium break-words">{key.name}</span>
                    <span className="text-slate tabular text-sm">…{key.hint}</span>
                    <span
                      className={cn(
                        "rounded-plinth px-2 py-0.5 text-xs font-medium",
                        key.state === "active" ? "bg-dusk text-glass" : "bg-plinth text-slate",
                      )}
                    >
                      {t(`state.${key.state}`)}
                    </span>
                  </span>
                  <span className="text-slate text-sm">{key.scopes.map((scope) => t(`scopes.${scope}.title`)).join(" · ")}</span>
                  <span className="text-slate text-sm">
                    {t("dates", { made: when(key.createdAt), ends: when(key.expiresAt) })}
                    {" · "}
                    {key.lastUsedAt === null ? t("neverUsed") : t("lastUsed", { when: format.relativeTime(new Date(key.lastUsedAt), new Date(now)) })}
                  </span>
                </div>
                {key.state === "active" ? (
                  <Button variant="secondary" disabled={!hydrated || pending} onClick={() => revoke(key.id)} aria-label={t("revokeNamed", { name: key.name })} data-agent-id={`action:revoke-agent-key:${key.id}`}>
                    {t("revoke")}
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
