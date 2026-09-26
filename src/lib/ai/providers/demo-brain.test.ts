/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Unit tests for the demo Concierge's rules: intents in English and Greek, the tool chain, and answers after tools.
 */

import { describe, expect, it } from "vitest";

import { demoStep, intentOf, searchQueryOf, sizeOf, type DemoPrompt } from "@/lib/ai/providers/demo-brain";
import { TOOLS } from "@/lib/ai/tools/registry";

const ALL = TOOLS.map((tool) => tool.name);
const prompt = (text: string, results: DemoPrompt["results"] = [], locale: "en" | "el" = "en"): DemoPrompt => ({ text, results, tools: ALL, locale });
const LAMP = { id: "01890000-0000-7000-8000-000000000001", title: "Faux Wood Table Lamp", inStock: true };
const CHAIR = { id: "01890000-0000-7000-8000-000000000002", title: "Radford Chair", inStock: true };

describe("intentOf", () => {
  it("reads what the shopper wants, in English and Greek", () => {
    expect(intentOf("Add the oak lamp to my cart")).toBe("add");
    expect(intentOf("Πρόσθεσε μια λάμπα στο καλάθι")).toBe("add");
    expect(intentOf("compare the two chairs")).toBe("compare");
    expect(intentOf("Where is order VT-4JJZ-MPF9?")).toBe("order_status");
    expect(intentOf("I want to return VT-4JJZ-MPF9")).toBe("return");
    expect(intentOf("Δείξε τις παραγγελίες μου")).toBe("orders");
    expect(intentOf("a reading corner for 600 euros")).toBe("bundle");
    expect(intentOf("open my cart")).toBe("cart");
    expect(intentOf("I'm ready to check out")).toBe("checkout");
    expect(intentOf("velvet sofa under 900")).toBe("browse");
    expect(intentOf("Can I talk to a person about VT-4JJZ-MPF9?")).toBe("person");
    expect(intentOf("Θέλω να μιλήσω με έναν άνθρωπο")).toBe("person");
  });

  it("hands a request for a person over with the shopper's own words, the order and a queue", () => {
    const step = demoStep(prompt("My lamp arrived broken, I want to talk to a person about VT-4JJZ-MPF9"));
    expect(step).toEqual({
      kind: "tools",
      calls: [
        {
          toolName: "hand_to_person",
          input: {
            summary: 'The shopper asked for a person: "My lamp arrived broken, I want to talk to a person about VT-4JJZ-MPF9"',
            topic: "returns",
            orderNumber: "VT-4JJZ-MPF9",
          },
        },
      ],
    });
    const sent = demoStep(prompt("a person please", [{ toolName: "hand_to_person", output: { ok: true, number: "VS-7K2M-Q4HD" } }]));
    expect(sent).toMatchObject({ kind: "text" });
    expect((sent as { text: string }).text).toContain("VS-7K2M-Q4HD");
    const guest = demoStep(prompt("a person please", [{ toolName: "hand_to_person", output: { ok: false, reason: "needs_contact" } }], "el"));
    expect((guest as { text: string }).text).toContain("φόρμα επικοινωνίας");
  });

  it("keeps only the words that describe the piece", () => {
    expect(searchQueryOf("Please add the oak table lamp to my cart")).toBe("oak table lamp");
    expect(searchQueryOf("Πρόσθεσε μια ξύλινη λάμπα στο καλάθι")).toBe("ξύλινη λάμπα");
  });
});

describe("demoStep", () => {
  it("searches first, then shows the products, then answers", () => {
    expect(demoStep(prompt("velvet sofa under 900"))).toEqual({ kind: "tools", calls: [{ toolName: "search_products", input: { query: "velvet sofa under 900", limit: 6 } }] });
    const shown = demoStep(prompt("velvet sofa under 900", [{ toolName: "search_products", output: { products: [LAMP, CHAIR] } }]));
    expect(shown).toMatchObject({ kind: "tools", calls: [{ toolName: "show_products", input: { productIds: [LAMP.id, CHAIR.id] } }] });
    const answer = demoStep(prompt("velvet sofa under 900", [{ toolName: "search_products", output: { products: [LAMP, CHAIR] } }, { toolName: "show_products", output: { products: [LAMP, CHAIR] } }]));
    expect(answer).toMatchObject({ kind: "text" });
    // Prices are shown by the cards, never written by the Concierge (golden rule 5).
    expect((answer as { text: string }).text).not.toMatch(/€|\d+\.\d\d/);
  });

  it("adds the first piece in stock after searching, and confirms with the undo", () => {
    const step = demoStep(prompt("add the lamp to my cart", [{ toolName: "search_products", output: { products: [{ ...CHAIR, inStock: false }, LAMP] } }]));
    expect(step).toEqual({ kind: "tools", calls: [{ toolName: "add_to_cart", input: { productId: LAMP.id, quantity: 1 } }] });
    const done = demoStep(prompt("add the lamp to my cart", [{ toolName: "search_products", output: { products: [LAMP] } }, { toolName: "add_to_cart", output: { ok: true, title: LAMP.title } }]));
    expect((done as { text: string }).text).toContain("undo");
  });

  it("compares what it found, and builds a set within a budget", () => {
    expect(demoStep(prompt("compare chairs", [{ toolName: "search_products", output: { products: [LAMP, CHAIR] } }]))).toMatchObject({ calls: [{ toolName: "compare_products", input: { ids: [LAMP.id, CHAIR.id] } }] });
    expect(demoStep(prompt("a living room set for 1.500 euros"))).toEqual({ kind: "tools", calls: [{ toolName: "build_bundle", input: { template: "living-room", budgetEuros: 1500 } }] });
  });

  it("goes to checkout only through the tool that asks first", () => {
    expect(demoStep(prompt("let's check out"))).toEqual({ kind: "tools", calls: [{ toolName: "start_checkout", input: {} }] });
    expect(demoStep(prompt("let's check out", [{ toolName: "start_checkout", output: null, denied: true }]))).toEqual({ kind: "text", text: "Understood, I haven't done that." });
  });

  it("does not offer a tool the surface does not have", () => {
    expect(demoStep({ ...prompt("open my cart"), tools: ["get_orders"] })).toEqual({ kind: "text", text: "I can't do that here." });
  });

  it("makes the shop easier to see when asked, in either language, and says how to change it back", () => {
    expect(intentOf("the text is too small")).toBe("comfort");
    expect(demoStep(prompt("the text is too small and the animations make me dizzy"))).toMatchObject({ calls: [{ toolName: "adjust_comfort", input: { settings: { text: "125", motion: "reduce" } } }] });
    expect(demoStep(prompt("μεγαλύτερα γράμματα", [], "el"))).toMatchObject({ calls: [{ toolName: "adjust_comfort", input: { settings: { text: "125" }, caption: "Αλλαγή της εμφάνισης" } }] });
    const done = demoStep(prompt("the text is too small", [{ toolName: "adjust_comfort", output: { commands: [] } }]));
    expect((done as { text: string }).text).toContain("Aa");
    // A large sofa is shopping, not a request for large text.
    expect(intentOf("a large sofa")).toBe("browse");
  });

  it("hears a shopper's size, and asks before keeping it", () => {
    expect(sizeOf("I'm a medium")).toBe("M");
    expect(sizeOf("I wear L in tops")).toBe("L");
    expect(sizeOf("my size is extra small.")).toBe("XS");
    expect(sizeOf("Φοράω M")).toBe("M");
    // Not a size: a large family, a small flat.
    expect(sizeOf("I'm a large family looking for a sofa")).toBeNull();
    expect(sizeOf("I am in a small flat")).toBeNull();
    expect(demoStep(prompt("I'm a medium"))).toMatchObject({ calls: [{ toolName: "remember_preference", input: { patch: { sizes: { upper: "M", lower: "M", dress: "M" } } } }] });
    const kept = demoStep(prompt("I'm a medium", [{ toolName: "remember_preference", output: { commands: [] } }]));
    expect((kept as { text: string }).text).toContain("Your shop");
  });

  it("says what it knows about the shopper, and where to see and delete it", () => {
    expect(demoStep(prompt("What do you know about me?"))).toEqual({ kind: "tools", calls: [{ toolName: "get_preferences", input: {} }] });
    const known = demoStep(prompt("What do you know about me?", [{ toolName: "get_preferences", output: { sizes: { upper: "M" }, rooms: [{ name: "Living room", wallCm: 240 }], empty: false } }]));
    expect((known as { text: string }).text).toMatch(/M.*1 room.*delete/);
    const nothing = demoStep(prompt("τι ξέρεις για μένα", [{ toolName: "get_preferences", output: { empty: true } }], "el"));
    expect((nothing as { text: string }).text).toContain("Δεν μου έχεις πει");
  });

  it("answers in Greek on the Greek shop", () => {
    expect(demoStep(prompt("γεια", [], "el"))).toMatchObject({ kind: "text", text: expect.stringContaining("Γεια") });
  });
});
