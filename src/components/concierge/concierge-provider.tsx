"use client";

/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * The Concierge's state for the whole shop: the conversation, the dock, and turning tool results into page actions.
 */

import { useChat, type UseChatHelpers } from "@ai-sdk/react";
import { DefaultChatTransport, getToolName, isToolUIPart, lastAssistantMessageIsCompleteWithApprovalResponses, type UIMessage } from "ai";
import { useLocale, useTranslations } from "next-intl";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { CART_EVENT, type CartSummary } from "@/components/commerce/cart-client";
import { collectPageMap } from "@/components/concierge/page-map";
import { SpotlightProvider, useSpotlight, type Executors } from "@/components/concierge/spotlight";
import { useRouter } from "@/i18n/navigation";
import { parseCommands } from "@/lib/ai/ui-commands";

/**
 * Mounted once in the layout, so the conversation survives navigation: when
 * the Concierge opens a page, the dock stays open on the new page with the same
 * conversation. Tool results that carry page commands run through the
 * Spotlight (each shown, validated again and recorded with an undo); cart
 * changes are recorded too, with an undo that redeems the tool's signed token.
 */

type ConciergeValue = {
  open: boolean;
  setOpen: (open: boolean) => void;
  chat: UseChatHelpers<UIMessage>;
  ask: (text: string) => void;
  /** The reason the last request was refused (turns, budget…), if it was. */
  refusal: string | null;
  reset: () => void;
};

const ConciergeContext = createContext<ConciergeValue | null>(null);

export function useConcierge(): ConciergeValue {
  const value = useContext(ConciergeContext);
  if (value === null) throw new Error("useConcierge must be used inside <ConciergeProvider>.");
  return value;
}

/** Keeps the header's cart count in step after the Concierge changes the cart. */
async function announceCart(locale: string) {
  const response = await fetch(`/api/cart?locale=${locale}`, { cache: "no-store" }).catch(() => null);
  if (response?.ok === true) window.dispatchEvent(new CustomEvent<CartSummary>(CART_EVENT, { detail: (await response.json()) as CartSummary }));
}

function ConciergeState({ children }: { children: ReactNode }) {
  const locale = useLocale();
  const t = useTranslations("concierge");
  const spotlight = useSpotlight();
  const [open, setOpen] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const handled = useRef(new Set<string>());

  const transport = useMemo(
    () => new DefaultChatTransport({ api: "/api/concierge", body: () => ({ locale, pageMap: collectPageMap(locale) }) }),
    [locale],
  );
  const chat = useChat({
    transport,
    // After the shopper answers an approval card, the same turn carries on.
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
    onError: (error) => {
      // Refusals arrive as JSON with a reason; anything else is a generic failure.
      try {
        setRefusal(((JSON.parse(error.message) as { reason?: string }).reason ?? "generic").replace(/[^a-z_]/g, ""));
      } catch {
        setRefusal("generic");
      }
    },
  });

  // Tool results become page actions exactly once each.
  useEffect(() => {
    for (const message of chat.messages) {
      if (message.role !== "assistant") continue;
      for (const part of message.parts) {
        if (!isToolUIPart(part) || part.state !== "output-available" || handled.current.has(part.toolCallId)) continue;
        handled.current.add(part.toolCallId);
        const output = part.output as { commands?: unknown; ok?: boolean; undo?: string; title?: string; quantity?: number } | null;
        const name = getToolName(part);
        if (output !== null && Array.isArray(output.commands) && output.commands.length > 0) {
          // show_products renders in the dock; only commands that act on the page go through the Spotlight.
          const { commands } = parseCommands(output.commands);
          const acting = commands.filter((command) => command.type !== "show_products");
          if (acting.length > 0) void spotlight.run(acting);
        }
        if (["add_to_cart", "update_cart_item", "remove_from_cart"].includes(name) && output?.ok === true && typeof output.undo === "string") {
          const token = output.undo;
          const caption = name === "add_to_cart" ? t("added", { title: output.title ?? "" }) : name === "remove_from_cart" ? t("removed", { title: output.title ?? "" }) : t("updated", { title: output.title ?? "", quantity: output.quantity ?? 0 });
          spotlight.record({
            caption,
            type: "cart",
            undo: {
              label: caption,
              run: async () => {
                const response = await fetch("/api/concierge/undo", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token }) });
                if (!response.ok) throw new Error(t("undoFailed"));
                await announceCart(locale);
              },
            },
          });
          void announceCart(locale);
        }
      }
    }
  }, [chat.messages, spotlight, t, locale]);

  const ask = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (trimmed === "") return;
      setRefusal(null);
      setOpen(true);
      void chat.sendMessage({ text: trimmed });
    },
    [chat],
  );

  const reset = useCallback(() => {
    chat.stop();
    chat.setMessages([]);
    handled.current.clear();
    setRefusal(null);
    spotlight.clearTimeline();
  }, [chat, spotlight]);

  const value = useMemo<ConciergeValue>(() => ({ open, setOpen, chat, ask, refusal, reset }), [open, chat, ask, refusal, reset]);
  return <ConciergeContext.Provider value={value}>{children}</ConciergeContext.Provider>;
}

export function ConciergeProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  // Navigation keeps the shopper's language: the i18n router adds the locale to allowlisted paths.
  const executors = useMemo<Executors>(
    () => ({
      navigate: (command) => {
        if (command.type === "navigate") router.push(command.href);
      },
    }),
    [router],
  );
  return (
    <SpotlightProvider executors={executors}>
      <ConciergeState>{children}</ConciergeState>
    </SpotlightProvider>
  );
}
