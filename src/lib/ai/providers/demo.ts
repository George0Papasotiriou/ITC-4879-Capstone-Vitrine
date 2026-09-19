/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * The demo language model: the AI SDK's own model interface, answered by the demo rules instead of a provider.
 */

import { simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";

import { demoStep, type DemoPrompt, type DemoStep, type DemoToolResult } from "@/lib/ai/providers/demo-brain";

/**
 * Demo mode (docs/adr/019). The model below implements the same interface as
 * Gemini's, so `streamText`, tool calls, approvals and usage recording run
 * exactly as they will with a real key; only the choice of the next step comes
 * from src/lib/ai/providers/demo-brain.ts. `MockLanguageModelV4` is the AI
 * SDK's reference implementation of that interface (it has no test-runner
 * dependency), which keeps this file to the translation between the two.
 */

type CallOptions = Parameters<MockLanguageModelV4["doStream"]>[0];
type Prompt = CallOptions["prompt"];

/** The shopper's last message and the tool results since, from the model's prompt. */
export function readPrompt(prompt: Prompt, tools: readonly string[], locale: "en" | "el"): DemoPrompt {
  let lastUser = -1;
  prompt.forEach((message, index) => {
    if (message.role === "user") lastUser = index;
  });
  const userMessage = lastUser >= 0 ? prompt[lastUser] : undefined;
  const text =
    userMessage?.role === "user"
      ? userMessage.content
          .filter((part) => part.type === "text")
          .map((part) => (part as { text: string }).text)
          .join(" ")
      : "";
  const results: DemoToolResult[] = [];
  for (const message of prompt.slice(lastUser + 1)) {
    if (message.role !== "tool" && message.role !== "assistant") continue;
    for (const part of message.content) {
      if (part.type !== "tool-result") continue;
      const output = part.output;
      results.push({
        toolName: part.toolName,
        output: output.type === "json" ? output.value : output.type === "text" ? output.value : null,
        denied: output.type === "execution-denied",
      });
    }
  }
  return { text, results, tools, locale };
}

/** Rough token counts for the usage record: about four characters a token. */
const tokens = (text: string) => Math.max(1, Math.ceil(text.length / 4));

function usage(input: string, output: string) {
  return {
    inputTokens: { total: tokens(input), noCache: tokens(input), cacheRead: undefined, cacheWrite: undefined },
    outputTokens: { total: tokens(output), text: tokens(output), reasoning: undefined },
  };
}

let counter = 0;
const callId = () => `demo_${Date.now().toString(36)}_${(counter += 1)}`;

const toolCalls = (calls: Extract<DemoStep, { kind: "tools" }>["calls"]) =>
  calls.map((call) => ({ type: "tool-call" as const, toolCallId: callId(), toolName: call.toolName, input: JSON.stringify(call.input) }));

function partsFor(step: DemoStep) {
  return step.kind === "tools" ? toolCalls(step.calls) : [{ type: "text" as const, text: step.text }];
}

export function createDemoModel({ locale }: { locale: "en" | "el" }) {
  const step = (options: CallOptions) => {
    const tools = (options.tools ?? []).map((tool) => tool.name);
    const prompt = readPrompt(options.prompt, tools, locale);
    return { step: demoStep(prompt), promptText: JSON.stringify(options.prompt) };
  };

  return new MockLanguageModelV4({
    provider: "demo",
    modelId: "vitrine-demo-rules",
    doGenerate: async (options) => {
      const { step: next, promptText } = step(options);
      return {
        content: partsFor(next),
        finishReason: { unified: next.kind === "tools" ? "tool-calls" : "stop", raw: undefined },
        usage: usage(promptText, JSON.stringify(next)),
        warnings: [],
      };
    },
    doStream: async (options) => {
      const { step: next, promptText } = step(options);
      const id = callId();
      const chunks =
        next.kind === "tools"
          ? toolCalls(next.calls)
          : [
              { type: "text-start" as const, id },
              // Word by word, so the interface streams as it will with a real model.
              ...next.text.split(/(?<= )/).map((delta) => ({ type: "text-delta" as const, id, delta })),
              { type: "text-end" as const, id },
            ];
      return {
        stream: simulateReadableStream({
          chunks: [
            ...chunks,
            { type: "finish" as const, finishReason: { unified: next.kind === "tools" ? ("tool-calls" as const) : ("stop" as const), raw: undefined }, usage: usage(promptText, JSON.stringify(next)) },
          ],
          initialDelayInMs: 80,
          chunkDelayInMs: 18,
        }),
      };
    },
  });
}
