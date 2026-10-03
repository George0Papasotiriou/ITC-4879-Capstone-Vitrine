/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Unit tests for the demo Concierge's rules: intents in English and Greek, the tool chain, and answers after tools.
 */

import { describe, expect, it } from "vitest";

import { demoStep, intentOf, kindQueryOf, measurementsOf, pictureQueryOf, sceneStyleOf, searchQueryOf, sizeOf, type DemoPrompt } from "@/lib/ai/providers/demo-brain";
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

  it("opens a shop window: a theme from its words, or a room and budget of the shopper's own (docs/adr/040)", () => {
    expect(intentOf("show me a shop window for a bedroom")).toBe("showcase");
    expect(intentOf("δείξε μου μια βιτρίνα")).toBe("showcase");
    expect(demoStep(prompt("show me a shop window for a bedroom"))).toEqual({
      kind: "tools",
      calls: [{ toolName: "compose_showcase", input: { theme: "oak-bedroom", caption: "Setting up the window" } }],
    });
    expect(demoStep(prompt("inspire me: a living room window for 1200 euros"))).toMatchObject({
      calls: [{ toolName: "compose_showcase", input: { template: "living-room", budgetEuros: 1200 } }],
    });
    expect(demoStep(prompt("δείξε μου μια βιτρίνα", [], "el"))).toMatchObject({ calls: [{ toolName: "compose_showcase", input: { theme: "reading-corner", caption: "Στήνω τη βιτρίνα" } }] });
    expect(demoStep(prompt("show me a shop window", [{ toolName: "compose_showcase", output: { found: true } }]))).toMatchObject({ kind: "text", text: expect.stringContaining("Here is the window") });
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

describe("size advice", () => {
  it("reads measurements named on either side of the number, in English and Greek", () => {
    expect(measurementsOf("What size jacket? My chest is 98 and waist 84")).toEqual({ garment: "top", chestCm: 98, waistCm: 84 });
    expect(measurementsOf("trousers for a 76 cm waist and 101 hips")).toEqual({ garment: "trousers", waistCm: 76, hipCm: 101 });
    expect(measurementsOf("Τι νούμερο φούστα; Μέση 70, γοφοί 97,5")).toEqual({ garment: "skirt", waistCm: 70, hipCm: 97.5 });
    expect(measurementsOf("a chest of drawers for 300")).toBeNull();
    expect(measurementsOf("I'm a medium")).toBeNull();
  });

  it("asks the size tool, then answers with the reason and offers to remember it", () => {
    expect(intentOf("chest 98, what size?")).toBe("size_advice");
    expect(demoStep(prompt("chest 98, what size?"))).toEqual({ kind: "tools", calls: [{ toolName: "suggest_size", input: { garment: "top", chestCm: 98 } }] });
    const answer = demoStep(prompt("chest 98, what size?", [{ toolName: "suggest_size", output: { size: "M", decidedBy: "chest", apart: 0, beyondChart: false, sizeGroup: "upper", verdicts: [{ measure: "chest", cm: 98, size: "M", upToCm: 98 }] } }]));
    expect((answer as { text: string }).text).toBe("I'd take M. For a chest of 98 cm, M goes up to 98 cm. Shall I remember M as your size?");
    const greek = demoStep(prompt("στήθος 98", [{ toolName: "suggest_size", output: { problem: "out_of_range", hint: "" } }], "el"));
    expect((greek as { text: string }).text).toContain("Χρειάζομαι τις μετρήσεις σου");
  });
});

describe("placing in a room", () => {
  it("finds the piece, then says whether it fits the saved walls and opens the planner", () => {
    expect(intentOf("Will the Radford chair fit my living room?")).toBe("room");
    expect(intentOf("Χωράει ο καναπές στο σαλόνι μου;")).toBe("room");
    const search = demoStep(prompt("Will the Radford chair fit my living room?", [{ toolName: "search_products", output: { products: [CHAIR] } }]));
    expect(search).toMatchObject({ kind: "tools", calls: [{ toolName: "place_in_room", input: { productId: CHAIR.id } }] });
    const fits = demoStep(
      prompt("Will the Radford chair fit my living room?", [{ toolName: "place_in_room", output: { placeable: true, roomsSaved: 2, fits: [{ room: "Hall", fits: false, spareCm: -5 }, { room: "Living room", fits: true, spareCm: 150 }] } }]),
    );
    expect((fits as { text: string }).text).toBe("It fits your Living room wall with 150 cm to spare. I've opened it in the planner so you can see it in a photo of the room.");
    const noRooms = demoStep(prompt("fit my room", [{ toolName: "place_in_room", output: { placeable: true, roomsSaved: 0, fits: [] } }]));
    expect((noRooms as { text: string }).text).toContain("Save your room's wall");
  });
});

describe("a photograph attached to the question (docs/adr/051)", () => {
  it("reads its colours first, when the question is about pieces", () => {
    expect(demoStep({ ...prompt("find a table that matches my room"), photo: true })).toEqual({ kind: "tools", calls: [{ toolName: "find_by_photo", input: {} }] });
    // A question about something else is answered as usual, photograph or not.
    expect(demoStep({ ...prompt("open my cart"), photo: true })).toEqual({ kind: "tools", calls: [{ toolName: "navigate", input: { href: "/cart", caption: "Opening the cart" } }] });
  });

  it("shows what it found and says which colours it read", () => {
    const found = { toolName: "find_by_photo", output: { ok: true, colours: ["walnut", "cream"], products: [LAMP, CHAIR] }, denied: false };
    // A question that names no kind of piece shows the photograph's colours as they are.
    const shown = demoStep({ ...prompt("What would suit this room?", [found]), photo: true });
    expect(shown).toMatchObject({ kind: "tools", calls: [{ toolName: "show_products", input: { productIds: [LAMP.id, CHAIR.id] } }] });
    const said = demoStep({ ...prompt("What would suit this room?", [found, { toolName: "show_products", output: { products: [LAMP, CHAIR] }, denied: false }]), photo: true });
    expect(said.kind).toBe("text");
    expect((said as { text: string }).text).toContain("walnut, cream");
  });

  it("says so when the photograph cannot be read", () => {
    const step = demoStep({ ...prompt("what suits this?", [{ toolName: "find_by_photo", output: { ok: false, reason: "no_photo" }, denied: false }]), photo: true });
    expect(step).toMatchObject({ kind: "text" });
  });
});

describe("an AI picture of a piece in a room (docs/adr/053)", () => {
  it("knows a request for a picture from a photograph to match", () => {
    expect(intentOf("Picture a walnut sideboard in a Scandinavian room")).toBe("picture");
    expect(intentOf("What would the Radford chair look like in a dark moody room?")).toBe("picture");
    expect(intentOf("Φαντάσου την καρέκλα σε μεσογειακό δωμάτιο")).toBe("picture");
    expect(intentOf("Find a table like this picture")).not.toBe("picture");
    expect(intentOf("What would suit this room?")).not.toBe("picture");
  });

  it("keeps the piece and reads the style", () => {
    expect(pictureQueryOf("Picture a green sofa in a nordic room")).toBe("green sofa");
    expect(pictureQueryOf("What would the Radford chair look like in a dark moody room?")).toBe("Radford chair");
    expect(pictureQueryOf("Picture it in my room")).toBe("");
    expect(sceneStyleOf("in a Nordic room")).toBe("scandinavian");
    expect(sceneStyleOf("dark and moody")).toBe("dark-moody");
    expect(sceneStyleOf("σε μεσογειακό δωμάτιο")).toBe("mediterranean");
    expect(sceneStyleOf("in a room")).toBe("warm-minimal");
  });

  it("finds the piece, then asks for the picture in the style named, or in the photograph attached", () => {
    const text = "Picture the Radford chair in a Scandinavian room";
    expect(demoStep(prompt(text))).toEqual({ kind: "tools", calls: [{ toolName: "search_products", input: { query: "Radford chair", limit: 3 } }] });
    const found = { toolName: "search_products", output: { products: [CHAIR, LAMP] }, denied: false };
    expect(demoStep(prompt(text, [found]))).toEqual({ kind: "tools", calls: [{ toolName: "picture_in_room", input: { productId: CHAIR.id, room: "scandinavian" } }] });
    expect(demoStep({ ...prompt("Picture the Radford chair here", [found]), photo: true })).toEqual({ kind: "tools", calls: [{ toolName: "picture_in_room", input: { productId: CHAIR.id, room: "photo" } }] });
  });

  it("asks which piece when none is named, and explains each answer", () => {
    expect(demoStep(prompt("Picture it in a room"))).toMatchObject({ kind: "text" });
    const making = demoStep(prompt("Picture the Radford chair", [{ toolName: "picture_in_room", output: { ok: true, title: "Radford Chair", ready: false }, denied: false }]));
    expect((making as { text: string }).text).toContain("twenty seconds");
    const free = demoStep(prompt("Picture the Radford chair", [{ toolName: "picture_in_room", output: { ok: true, title: "Radford Chair", ready: true }, denied: false }]));
    expect((free as { text: string }).text).toContain("free");
    const spent = demoStep(prompt("Picture the Radford chair", [{ toolName: "picture_in_room", output: { ok: false, reason: "allowance" }, denied: false }]));
    expect((spent as { text: string }).text).toContain("today's pictures");
    const declined = demoStep(prompt("Picture the Radford chair", [{ toolName: "picture_in_room", output: null, denied: true }]));
    expect((declined as { text: string }).text).toContain("haven't done that");
  });
});

describe("kindQueryOf", () => {
  it("keeps the kind of piece a question about a photograph names, and nothing else", () => {
    expect(kindQueryOf("Find a coffee table that suits this room")).toBe("coffee table");
    expect(kindQueryOf("Βρες ένα τραπεζάκι που ταιριάζει στο δωμάτιό μου")).toBe("τραπεζάκι");
    expect(kindQueryOf("What would suit this room?")).toBe("");
    expect(kindQueryOf("What's missing from this room?")).toBe("");
  });

  it("searches that kind in the photograph's main colour after reading it", () => {
    const found = { toolName: "find_by_photo", output: { ok: true, colours: ["walnut", "cream"], products: [LAMP] }, denied: false };
    expect(demoStep({ ...prompt("Find a coffee table that suits this room", [found]), photo: true })).toEqual({
      kind: "tools",
      calls: [{ toolName: "search_products", input: { query: "coffee table walnut", limit: 6 } }],
    });
    // "…that matches my room" with the room's photograph shows the results; it does not open the planner.
    const searched = { toolName: "search_products", output: { products: [LAMP, CHAIR] }, denied: false };
    expect(demoStep({ ...prompt("find a table that matches my room", [found, searched]), photo: true })).toMatchObject({ kind: "tools", calls: [{ toolName: "show_products" }] });
  });
});
