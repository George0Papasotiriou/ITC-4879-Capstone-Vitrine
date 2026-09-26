/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * End-to-end tests for realtime voice: the notice, a spoken search whose tools run in the shop, an approval, interrupting, and the end.
 */

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type WebSocketRoute } from "@playwright/test";

import { freshPage } from "./support/accounts";

/**
 * docs/adr/030. No key and no audio leave this machine: the session route and
 * the token route are answered by the test, and the provider's socket is
 * played by a scripted server (`page.routeWebSocket`) that speaks OpenAI's
 * realtime events. Everything between — the AI SDK's session, the captions,
 * the tool calls going to the real `/api/concierge/tools`, the approval card,
 * the Spotlight moving the page — is the code a real session runs.
 */

test.describe.configure({ timeout: 120_000 });

const SESSION_ID = "01900000-0000-7000-8000-00000000a0a0";
const OPENAI_SOCKET = "wss://api.openai.com/v1/realtime";

type Sent = { type: string; [key: string]: unknown };

/** A scripted realtime server: what the browser sent, and a way to answer. */
async function scriptedServer(page: Page) {
  const received: Sent[] = [];
  let socket: WebSocketRoute | null = null;
  const waiters: { type: string; resolve: (event: Sent) => void }[] = [];

  const send = (event: Record<string, unknown>) => socket?.send(JSON.stringify(event));

  // Every socket the page opens is answered here, so nothing can reach a real provider, whatever the URL.
  await page.routeWebSocket(() => true, (ws) => {
    expect(ws.url().startsWith(OPENAI_SOCKET)).toBe(true);
    socket = ws;
    ws.onMessage((raw) => {
      const event = JSON.parse(String(raw)) as Sent;
      received.push(event);
      // The SDK opens with its session settings; the provider confirms them.
      if (event.type === "session.update") {
        send({ type: "session.created", session: { id: "sess_test" } });
        send({ type: "session.updated", session: { id: "sess_test" } });
      }
      for (const waiter of waiters.filter((candidate) => candidate.type === event.type)) {
        waiters.splice(waiters.indexOf(waiter), 1);
        waiter.resolve(event);
      }
    });
  });

  /** Resolves with the next event of this type the browser sends (or one it already sent and nobody took). */
  const next = (type: string) =>
    new Promise<Sent>((resolve) => {
      waiters.push({ type, resolve });
    });

  return { received, send, next, connected: () => socket !== null };
}

/** A page where the session route reserves a realtime OpenAI session, and the microphone is a quiet tone. */
async function withLiveVoice(page: Page, { noticeRead = true }: { noticeRead?: boolean } = {}) {
  await page.addInitScript((read) => {
    if (read) window.localStorage.setItem("vt_voice_notice", "1");
    navigator.mediaDevices.getUserMedia = async () => {
      const context = new AudioContext();
      const destination = context.createMediaStreamDestination();
      const tone = context.createOscillator();
      tone.connect(destination);
      tone.start();
      return destination.stream;
    };
  }, noticeRead);
  const ended: string[] = [];
  await page.route("**/api/concierge/voice/session", (route) =>
    route.fulfill({ json: { ok: true, mode: "realtime", provider: "openai", sessionId: SESSION_ID, locale: "en-GB", maxSessionMs: 180_000 } }),
  );
  await page.route("**/api/concierge/voice/realtime?**", (route) => route.fulfill({ json: { token: "test-token", url: "wss://api.openai.com/v1/realtime?model=gpt-realtime-2.1" } }));
  await page.route("**/api/concierge/voice/session/end", async (route) => {
    ended.push(route.request().postData() ?? "");
    await route.fulfill({ json: { ok: true, usedSeconds: 1 } });
  });
  await page.goto("/en", { waitUntil: "domcontentloaded" });
  await page.locator("html[data-concierge-ready]").waitFor({ timeout: 30_000 });
  await page.locator('[data-agent-id="nav:concierge-panel"]:visible, [data-agent-id="nav:concierge"]:visible').first().click();
  await expect(page.locator('[data-agent-id="voice:bar"]')).toBeVisible({ timeout: 15_000 });
  return { ended };
}

/** The model calls a tool; resolves with what the shop sent back as its result. */
async function callTool(server: Awaited<ReturnType<typeof scriptedServer>>, { response, call, name, args }: { response: string; call: string; name: string; args: Record<string, unknown> }) {
  const output = server.next("conversation.item.create");
  server.send({ type: "response.created", response: { id: response } });
  server.send({ type: "response.function_call_arguments.done", response_id: response, item_id: `item_${call}`, call_id: call, name, arguments: JSON.stringify(args) });
  server.send({ type: "response.done", response: { id: response, status: "completed" } });
  const event = (await output) as unknown as { item: { type: string; call_id: string; output: string } };
  expect(event.item).toMatchObject({ type: "function_call_output", call_id: call });
  return JSON.parse(event.item.output) as Record<string, unknown>;
}

test("@smoke a live spoken search runs the shop's own tools, shows the pieces, and writes both sides down", async ({ browser }) => {
  const page = await freshPage(browser, { country: "GR" });
  const server = await scriptedServer(page);
  const { ended } = await withLiveVoice(page);

  await page.locator('[data-agent-id="voice:start"]').click();
  await expect(page.locator('[data-agent-id="voice:state"]')).toHaveText("Listening", { timeout: 20_000 });
  await expect(page.locator('[data-agent-id="voice:live"]')).toHaveText("Live voice, through OpenAI");
  // The session the browser opened is only what the server minted, plus captions of the shopper.
  const update = server.received.find((event) => event.type === "session.update") as { session: Record<string, unknown> } | undefined;
  expect(update?.session).toMatchObject({ type: "realtime", model: "gpt-realtime-2.1" });
  expect(JSON.stringify(update?.session)).not.toContain("instructions");

  // The shopper speaks; the words arrive after the answer has begun, as they do with OpenAI.
  server.send({ type: "input_audio_buffer.speech_started", item_id: "item_u1" });
  server.send({ type: "input_audio_buffer.speech_stopped", item_id: "item_u1" });
  await expect(page.locator('[data-agent-id="voice:state"]')).toHaveText("Thinking");

  const found = await callTool(server, { response: "resp_1", call: "call_1", name: "search_products", args: { query: "green rug", limit: 3 } });
  const ids = (found.products as { id: string }[]).map((product) => product.id);
  expect(ids.length).toBeGreaterThan(0);
  await callTool(server, { response: "resp_2", call: "call_2", name: "show_products", args: { productIds: ids, caption: "Showing green rugs" } });

  server.send({ type: "conversation.item.input_audio_transcription.completed", item_id: "item_u1", transcript: "Show me green rugs" });
  server.send({ type: "response.created", response: { id: "resp_3" } });
  server.send({ type: "response.output_audio_transcript.delta", response_id: "resp_3", item_id: "item_a1", delta: "Here are three green rugs." });
  server.send({ type: "response.done", response: { id: "resp_3", status: "completed" } });

  // Captions of the shopper, the pieces in the dock, and the conversation in order: shopper, then Concierge.
  await expect(page.locator('[data-agent-id="voice:caption"]')).toContainText("Show me green rugs");
  const dock = page.locator('[data-agent-id="concierge:log"]');
  await expect(dock.locator('[data-agent-id^="concierge-product:"]').first()).toBeVisible({ timeout: 15_000 });
  const user = page.locator('[data-agent-id="concierge:message:user"]').last();
  const assistant = page.locator('[data-agent-id="concierge:message:assistant"]').last();
  await expect(user).toContainText("Show me green rugs");
  await expect(assistant).toContainText("Here are three green rugs.");
  const order = await page.evaluate(() => {
    const nodes = [...document.querySelectorAll('[data-agent-id^="concierge:message:"]')];
    return nodes.map((node) => node.getAttribute("data-agent-id"));
  });
  expect(order.slice(-2)).toEqual(["concierge:message:user", "concierge:message:assistant"]);

  const results = await new AxeBuilder({ page }).include('[data-agent-id="voice:bar"]').withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(results.violations.map((violation) => violation.id)).toEqual([]);

  // Stopping closes the socket and tells the server, so the unused minutes go back.
  await page.locator('[data-agent-id="voice:stop"]').click();
  await expect(page.locator('[data-agent-id="voice:state"]')).toHaveText("Voice is off");
  await expect.poll(() => ended.length).toBeGreaterThan(0);
  expect(JSON.parse(ended[0]!)).toEqual({ sessionId: SESSION_ID });

  await page.context().close();
});

test("a tool that asks first waits for the button on screen, and the shopper can talk over the answer", async ({ browser }) => {
  const page = await freshPage(browser, { country: "GR" });
  const server = await scriptedServer(page);
  await withLiveVoice(page);
  await page.locator('[data-agent-id="voice:start"]').click();
  await expect(page.locator('[data-agent-id="voice:state"]')).toHaveText("Listening", { timeout: 20_000 });

  server.send({ type: "input_audio_buffer.speech_stopped", item_id: "item_u1" });
  const found = await callTool(server, { response: "resp_1", call: "call_1", name: "search_products", args: { query: "rug", limit: 1 } });
  const [first] = found.products as { id: string }[];
  const added = await callTool(server, { response: "resp_2", call: "call_2", name: "add_to_cart", args: { productId: first!.id, quantity: 1 } });
  expect(added).toMatchObject({ ok: true });
  // The cart change is on the timeline with its undo, as a typed turn's would be.
  await expect(page.locator('[data-agent-id="nav:cart-count"]:visible').first()).toHaveText("1", { timeout: 15_000 });

  // Checkout asks first: the model waits while the card is on screen.
  const output = server.next("conversation.item.create");
  server.send({ type: "response.created", response: { id: "resp_3" } });
  server.send({ type: "response.function_call_arguments.done", response_id: "resp_3", item_id: "item_call_3", call_id: "call_3", name: "start_checkout", arguments: "{}" });
  server.send({ type: "response.done", response: { id: "resp_3", status: "completed" } });
  const card = page.locator('[data-agent-id="concierge:approval:start_checkout"]');
  await expect(card).toBeVisible({ timeout: 15_000 });
  await card.locator('[data-agent-id="concierge:approve"]').click();
  const result = (await output) as unknown as { item: { output: string } };
  expect(JSON.parse(result.item.output)).toMatchObject({ ok: true });
  await expect(page).toHaveURL(/\/en\/checkout/, { timeout: 20_000 });

  // The answer is spoken; the shopper starts talking over it, and the answer stops.
  server.send({ type: "response.created", response: { id: "resp_4" } });
  server.send({ type: "response.output_audio.delta", response_id: "resp_4", item_id: "item_a4", delta: Buffer.alloc(24_000 * 2).toString("base64") });
  server.send({ type: "response.output_audio_transcript.delta", response_id: "resp_4", item_id: "item_a4", delta: "Checkout is open; check the order and pay there." });
  await expect(page.locator('[data-agent-id="voice:state"]')).toHaveText("Speaking", { timeout: 15_000 });
  const truncated = server.next("conversation.item.truncate");
  server.send({ type: "input_audio_buffer.speech_started", item_id: "item_u2" });
  await expect(page.locator('[data-agent-id="voice:state"]')).toHaveText("Listening");
  // The provider is told how much of the answer was heard, so the conversation matches what was said.
  expect(await truncated).toMatchObject({ type: "conversation.item.truncate", item_id: "item_a4" });

  await page.context().close();
});

test("the first time, the shopper reads where live voice sends their voice before anything is sent", async ({ browser }) => {
  const page = await freshPage(browser, { country: "GR" });
  const server = await scriptedServer(page);
  const { ended } = await withLiveVoice(page, { noticeRead: false });

  await page.locator('[data-agent-id="voice:start"]').click();
  const notice = page.locator('[data-agent-id="voice:notice"]');
  await expect(notice).toContainText("OpenAI");
  expect(server.connected()).toBe(false);

  // Not now: nothing was sent, and the reservation goes back.
  await notice.locator('[data-agent-id="voice:notice:decline"]').click();
  await expect(notice).toHaveCount(0);
  await expect.poll(() => ended.length).toBe(1);
  expect(server.connected()).toBe(false);

  // Asked again, and accepted: the session opens, and the notice is not shown next time.
  await page.locator('[data-agent-id="voice:start"]').click();
  await page.locator('[data-agent-id="voice:notice:accept"]').click();
  await expect(page.locator('[data-agent-id="voice:state"]')).toHaveText("Listening", { timeout: 20_000 });
  expect(await page.evaluate(() => window.localStorage.getItem("vt_voice_notice"))).toBe("1");

  await page.context().close();
});
