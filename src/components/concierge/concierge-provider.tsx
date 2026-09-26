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
import { currentComfort, setComfort } from "@/components/comfort/comfort-store";
import { SpotlightProvider, useSpotlight, type Executors } from "@/components/concierge/spotlight";
import { useRouter } from "@/i18n/navigation";
import { withToolPart } from "@/lib/ai/surfaces/voice/transcript";
import { parseCommands } from "@/lib/ai/ui-commands";
import { flyToCart } from "@/lib/ui/fly-to-cart";
import { undoPatch, type Preferences, type PreferencesPatch } from "@/lib/prefs/preferences";
import { CONTACT_DRAFT_KEY } from "@/lib/support/tickets";

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
  /** `spoken` tells the server the answer will be read aloud, so it keeps it short (docs/adr/026). */
  ask: (text: string, options?: { spoken?: boolean }) => void;
  /** The reason the last request was refused (turns, budget…), if it was. */
  refusal: string | null;
  reset: () => void;
  /** Answers an approval card, whether a typed turn or a spoken one asked for it. */
  approve: (approvalId: string, approved: boolean) => void;
  /**
   * Runs one tool a realtime voice model called (docs/adr/030): through
   * `/api/concierge/tools`, with the same approval card as a typed turn, and
   * written into the conversation so the dock and the page respond to it as
   * they do to a typed one. Resolves with what the model is told.
   */
  runSpokenTool: (call: { toolCallId: string; name: string; input: unknown; messageId: string }) => Promise<unknown>;
  /** Writes spoken turns into the conversation. */
  writeSpoken: (update: (messages: UIMessage[]) => UIMessage[]) => void;
  /** Declines every approval a spoken turn is still waiting on, when voice stops. */
  cancelSpokenApprovals: () => void;
};

type ToolPart = Parameters<typeof withToolPart>[1]["part"];

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
  // Approvals a spoken turn is waiting on, by approval id.
  const spokenApprovals = useRef(new Map<string, (approved: boolean) => void>());

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
        const output = part.output as { commands?: unknown; ok?: boolean; undo?: string; title?: string; quantity?: number; reason?: string; summary?: string } | null;
        const name = getToolName(part);
        // A guest handed to a person: the summary they approved waits in the
        // contact form, written before the page opens (docs/adr/027).
        if (name === "hand_to_person" && output?.reason === "needs_contact" && typeof output.summary === "string") {
          try {
            window.sessionStorage.setItem(CONTACT_DRAFT_KEY, output.summary);
          } catch {
            // Without storage the form opens empty, and the dock still says what to write.
          }
        }
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
          // A piece the Concierge added flies to the cart from wherever it is on screen:
          // its card in the conversation, its tile, or the product page's photograph.
          const productId = (part.input as { productId?: unknown } | undefined)?.productId;
          const source =
            name === "add_to_cart" && typeof productId === "string"
              ? (document.querySelector(`[data-agent-id="concierge-product:${productId}"]`) ??
                document.querySelector(`[data-agent-id="product:${productId}"]`) ??
                document.querySelector('[data-flight-source="product-hero"]'))
              : null;
          void flyToCart(source).then(() => announceCart(locale));
        }
      }
    }
  }, [chat.messages, spotlight, t, locale]);

  const ask = useCallback(
    (text: string, options?: { spoken?: boolean }) => {
      const trimmed = text.trim();
      if (trimmed === "") return;
      setRefusal(null);
      setOpen(true);
      // Carried on this message rather than on the transport: one spoken turn
      // does not make the next typed one spoken too.
      void chat.sendMessage({ text: trimmed }, { body: { spoken: options?.spoken === true } });
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

  const { setMessages, addToolApprovalResponse } = chat;

  const writeSpoken = useCallback((update: (messages: UIMessage[]) => UIMessage[]) => setMessages(update), [setMessages]);

  const approve = useCallback(
    (approvalId: string, approved: boolean) => {
      const waiting = spokenApprovals.current.get(approvalId);
      if (waiting === undefined) {
        void addToolApprovalResponse({ id: approvalId, approved });
        return;
      }
      spokenApprovals.current.delete(approvalId);
      waiting(approved);
    },
    [addToolApprovalResponse],
  );

  const cancelSpokenApprovals = useCallback(() => {
    for (const [id, waiting] of spokenApprovals.current) {
      spokenApprovals.current.delete(id);
      waiting(false);
    }
  }, []);

  const runSpokenTool = useCallback(
    async ({ toolCallId, name, input, messageId }: { toolCallId: string; name: string; input: unknown; messageId: string }): Promise<unknown> => {
      const type = `tool-${name}` as ToolPart["type"];
      const show = (part: Omit<ToolPart, "type" | "toolCallId">) => setMessages((messages) => withToolPart(messages, { messageId, part: { type, toolCallId, ...part } as ToolPart }));
      const call = (approved: boolean) =>
        fetch("/api/concierge/tools", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name, input, locale, surface: "voice", approved }),
        })
          .then(async (response) => ({ status: response.status, body: (await response.json().catch(() => null)) as { ok?: boolean; output?: unknown; reason?: string } | null }))
          .catch(() => ({ status: 0, body: null }));

      show({ state: "input-available", input } as Omit<ToolPart, "type" | "toolCallId">);
      let result = await call(false);
      if (result.status === 409 && result.body?.reason === "approval_required") {
        // The same card a typed turn shows; the spoken question only mirrors it.
        const approvalId = `voice-approval-${toolCallId}`;
        setOpen(true);
        show({ state: "approval-requested", input, approval: { id: approvalId } } as Omit<ToolPart, "type" | "toolCallId">);
        const approved = await new Promise<boolean>((resolve) => spokenApprovals.current.set(approvalId, resolve));
        if (!approved) {
          show({ state: "output-denied", input, approval: { id: approvalId, approved: false } } as Omit<ToolPart, "type" | "toolCallId">);
          return { ok: false, reason: "declined_by_shopper" };
        }
        result = await call(true);
      }
      if (result.body?.ok === true) {
        show({ state: "output-available", input, output: result.body.output } as Omit<ToolPart, "type" | "toolCallId">);
        return result.body.output;
      }
      const reason = result.body?.reason ?? "failed";
      show({ state: "output-error", input, errorText: reason } as Omit<ToolPart, "type" | "toolCallId">);
      return { ok: false, reason };
    },
    [locale, setMessages],
  );

  const value = useMemo<ConciergeValue>(
    () => ({ open, setOpen, chat, ask, refusal, reset, approve, runSpokenTool, writeSpoken, cancelSpokenApprovals }),
    [open, chat, ask, refusal, reset, approve, runSpokenTool, writeSpoken, cancelSpokenApprovals],
  );
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
      preferences: async (command) => {
        if (command.type !== "preferences") return;
        const read = async () => ((await (await fetch("/api/preferences", { cache: "no-store" })).json()) as { preferences: Preferences }).preferences;
        const save = (patch: PreferencesPatch) => fetch("/api/preferences", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(patch) });
        const before = await read();
        const saved = await save(command.patch);
        if (!saved.ok) throw new Error("preferences");
        return { label: command.caption, run: async () => void (await save(undoPatch(before, command.patch))) };
      },
      comfort: (command) => {
        if (command.type !== "comfort") return;
        const before = currentComfort();
        setComfort(command.settings);
        return { label: command.caption, run: () => void setComfort({ ...before }) };
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
