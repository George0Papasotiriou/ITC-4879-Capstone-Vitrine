/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * The demo Concierge's reasoning: plain rules that choose the next tool call or answer, so every flow works without an AI key.
 */

/**
 * Demo mode (docs/adr/019). Until George adds a Gemini key, the Concierge runs
 * on these rules instead of a model. They read the shopper's last message in
 * English or Greek, choose tools the way a model would, and write a short
 * answer once the tools have run. They are deliberately simple: the point is
 * that the whole path — tool registry, approvals, the page's commands, undo,
 * cost records — runs for real and can be tested end to end at no cost. The
 * interface labels every demo answer as a demo.
 */

import { guessTopic } from "@/lib/support/tickets";
import { comfortRequestOf } from "@/lib/comfort/requests";

export type DemoToolResult = { toolName: string; output: unknown; denied?: boolean };

export type DemoPrompt = {
  /** The shopper's last message. */
  text: string;
  /** Tool results since that message, oldest first. */
  results: DemoToolResult[];
  /** Tools this surface offers. */
  tools: readonly string[];
  locale: "en" | "el";
  /** The shopper attached a photograph to this message (docs/adr/051). */
  photo?: boolean;
};

export type DemoCall = { toolName: string; input: Record<string, unknown> };
export type DemoStep = { kind: "tools"; calls: DemoCall[] } | { kind: "text"; text: string };

type Intent = "greet" | "comfort" | "size_advice" | "remember_size" | "preferences" | "person" | "cart" | "checkout" | "orders" | "order_status" | "return" | "compare" | "add" | "bundle" | "showcase" | "look" | "picture" | "way_in" | "board" | "room" | "browse";

const ORDER_NUMBER = /\bvt-[0-9a-z]{4}-[0-9a-z]{4}\b/i;

/** Words that carry the request, not what is wanted; removed to leave the search query. */
const COMMAND_WORDS = new Set(
  [
    "add", "put", "buy", "compare", "show", "find", "me", "my", "the", "a", "an", "to", "into", "in", "please", "i", "want", "would", "like", "some", "cart", "basket",
    "and", "with", "for", "see", "look", "room", "place", "which", "is", "better", "between", "vs", "versus", "can", "you", "get", "search",
    "πρόσθεσε", "βάλε", "σύγκρινε", "δείξε", "μου", "βρες", "θέλω", "ένα", "μια", "έναν", "το", "τα", "τον", "την", "στο", "στην", "καλάθι", "και", "για", "με", "σε",
  ].map((word) => word.normalize("NFD").replace(/\p{M}/gu, "")),
);

const fold = (text: string) => text.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");

export function intentOf(text: string): Intent {
  const t = fold(text);
  // Not \b: in JavaScript it only sees Latin letters as word characters, so it never matches after Greek.
  if (/^(hi|hello|hey|γεια|καλησπερα|καλημερα)(?!\p{L})/u.test(t)) return "greet";
  // Asking for the shop to be easier to see or calmer to watch (docs/adr/032).
  if (comfortRequestOf(text) !== null) return "comfort";
  // Giving measurements to be told a size (docs/adr/034), before saying a size they already know.
  if (measurementsOf(text) !== null) return "size_advice";
  // Saying their size, or asking what the shop keeps about them (docs/adr/033).
  if (sizeOf(text) !== null) return "remember_size";
  if (/\bwhat do you (know|remember) about me\b|\bmy (preferences|sizes)\b|τι (ξερεις|θυμασαι) για μενα|τις προτιμησεις μου/.test(t)) return "preferences";
  // Asking for a person wins over everything else in the sentence: an order
  // number or a product named alongside it is what the person should look at.
  if (/\b(a person|a human|human being|real person|someone at the shop|customer service|an agent)\b|ανθρωπ|υπαλληλ|εκπροσωπ/.test(t)) return "person";
  if (/\b(return|send (it|this|them) back)\b|επιστρ/.test(t) && ORDER_NUMBER.test(t)) return "return";
  if (ORDER_NUMBER.test(t)) return "order_status";
  if (/\border|παραγγελ/.test(t)) return "orders";
  if (/\b(check ?out|pay)\b|ολοκληρωσ|πληρωμ/.test(t)) return "checkout";
  if (/\b(compare|versus|vs)\b|συγκριν/.test(t)) return "compare";
  // A shop window to look at (docs/adr/040), before a set in the chat.
  if (/\b(window display|shop window|showcase|inspire me)\b|βιτριν|εμπνευσ/.test(t)) return "showcase";
  // A budget with a room or a set is a bundle, even when it says "put together".
  if (/\b(set|bundle|corner|budget)\b|σετ|γωνια/.test(t) && /\d/.test(t)) return "bundle";
  // Everything in a photograph (docs/adr/054): "shop this look", "find everything in this photo".
  if (/\bshop (the|this) look\b|\b(everything|every piece|all the pieces) in (this|the|my) (photo|picture|room)\b|\bget (me )?this (look|room)\b|αγορασε (το|αυτο το) στιλ|ολα (τα κομματια )?στη φωτογραφια/.test(t)) return "look";
  // Getting a piece into the home (docs/adr/055): through a door, up the stairs, round the hall. Before a picture
  // and a room: "fit through my door" is about the way in, not a wall.
  if (/\bthrough (the |my |our )?(front )?(door|doorway|hall|hallway|corridor)|\b(up|down) (the |my |our )?(stairs|staircase)|\bget (it |this |that |them )?(in|into|inside|up|through)\b|\bcarry (it |this )?in\b|απο (την |τη )?(εξω)?πορτα|απο τις σκαλες|να μπει|θα περασει/.test(t)) return "way_in";
  // An AI picture of a piece in a room (docs/adr/053): "picture it", "what would it look like", «φαντάσου το».
  // "…like this picture" is a photograph, not a request for one.
  if (/\b(picture|render|visuali[sz]e|imagine)\b|\bwhat (would|will|does) [^?.!]{0,48}?\blooks? like\b|φαντασου|φτιαξε (μια )?εικονα/.test(t) && !/\b(this|my|the|that) (picture|photo)\b/.test(t)) return "picture";
  // A room board (docs/adr/056) before the cart: "add it to my board" keeps it, it does not buy it.
  if (/\b(board|moodboard)\b|πινακα/.test(t)) return "board";
  if (/\b(add|put|buy)\b|προσθεσ|βαλε/.test(t)) return "add";
  if (/\bmy room\b|\bfits? (in|into|against)?\s*(my|the)\b|δωματιο μου|χωρα(ει|νε)/.test(t)) return "room";
  if (/\b(cart|basket)\b|καλαθι/.test(t)) return "cart";
  return "browse";
}

const SIZE_WORDS: Record<string, string> = { "extra small": "XS", "extra large": "XL", small: "S", medium: "M", large: "L", xs: "XS", s: "S", m: "M", l: "L", xl: "XL" };

/** "I'm a medium", "I wear L", «φοράω M»: the size a shopper says they wear, or null. */
export function sizeOf(text: string): string | null {
  const t = fold(text);
  // The size must end the thought ("I'm a medium", "I wear L in tops"): "I'm a large family" is not a size.
  const after = String.raw`(?=\s*(?:$|[.,!?;]|\s(?:in|for|size|please|and)(?![\p{L}])))`;
  const english = new RegExp(String.raw`\b(?:i'?m|i am|i wear|my size is)\s+(?:a |an |size )?(extra small|extra large|small|medium|large|xs|xl|s|m|l)` + after, "u");
  const greek = new RegExp(String.raw`(?:φοραω|ειμαι|το νουμερο μου ειναι)\s+(?:νουμερο )?(xs|xl|s|m|l)` + after, "u");
  const match = english.exec(t) ?? greek.exec(t);
  return match === null ? null : (SIZE_WORDS[match[1]!] ?? null);
}

const MEASURE_WORDS: [RegExp, "chestCm" | "waistCm" | "hipCm"][] = [
  [/chest|bust|στηθος/, "chestCm"],
  [/waist|μεση/, "waistCm"],
  [/hips?|γοφ|περιφερεια/, "hipCm"],
];

/**
 * "Chest 98, waist 84", «στήθος 96 εκ.»: body measurements in centimetres,
 * each named next to its number (either side), with the garment asked about.
 * Null without at least one named measurement.
 */
export function measurementsOf(text: string): { garment: "top" | "trousers" | "skirt" | "dress"; chestCm?: number; waistCm?: number; hipCm?: number } | null {
  const t = fold(text);
  const found: Partial<Record<"chestCm" | "waistCm" | "hipCm", number>> = {};
  for (const [word, key] of MEASURE_WORDS) {
    const source = word.source;
    const pattern = new RegExp(String.raw`(?:(?:${source})\p{L}*\s*(?:is|of|:|=|ειναι)?\s*(\d{2,3}(?:[.,]\d)?))|(?:(\d{2,3}(?:[.,]\d)?)\s*(?:cm|εκ\.?)?\s*(?:${source}))`, "u");
    const match = pattern.exec(t);
    const value = match?.[1] ?? match?.[2];
    if (value !== undefined) found[key] = Number(value.replace(",", "."));
  }
  if (Object.keys(found).length === 0) return null;
  const garment = /trousers|pants|jeans|παντελον/.test(t) ? "trousers" : /skirt|φουστα/.test(t) ? "skirt" : /dress|φορεμα/.test(t) ? "dress" : "top";
  return { garment, ...found };
}

const MEASURE_NAMES: Record<string, { en: string; el: string }> = { chest: { en: "chest", el: "στήθος" }, waist: { en: "waist", el: "μέση" }, hip: { en: "hip", el: "γοφούς" } };

export function searchQueryOf(text: string): string {
  const words = text.replace(ORDER_NUMBER, " ").split(/[^\p{L}\p{N}€.,-]+/u).filter((word) => word !== "" && !COMMAND_WORDS.has(fold(word)));
  return words.join(" ").trim() || text.trim();
}

/** Words a question about a photograph uses that name no kind of piece: "that suits this room", «που ταιριάζει». */
const PHOTO_WORDS = new Set(
  [
    "that", "this", "these", "those", "it", "match", "matches", "matching", "suit", "suits", "suiting", "go", "goes", "style", "piece", "pieces",
    "what", "would", "could", "colour", "colours", "color", "colors", "missing", "from", "something", "anything", "here", "photo", "picture",
    "που", "ταιριαζει", "ταιριαζουν", "δωματιο", "αυτο", "αυτη", "αυτα", "στιλ", "κομματι", "κομματια", "τι", "θα", "λειπει", "χρωματα", "ποια", "φωτογραφια",
  ].map((word) => word.normalize("NFD").replace(/\p{M}/gu, "")),
);

/** The kind of piece a question about a photograph names, or "" when it names none ("what would suit this room?"). */
export function kindQueryOf(text: string): string {
  // One letter names no piece: the "s" of "what's".
  const words = text.split(/[^\p{L}\p{N}-]+/u).filter((word) => word.length > 1 && !COMMAND_WORDS.has(fold(word)) && !PHOTO_WORDS.has(fold(word)));
  return words.join(" ").trim();
}

const TEMPLATES: [RegExp, string][] = [
  [/reading|αναγνωσ|διαβασ/, "reading-corner"],
  [/living|σαλονι/, "living-room"],
  [/dining|τραπεζαρι/, "dining"],
  [/bedroom|υπνοδωματ/, "bedroom"],
  [/gift|δωρ/, "gift-set"],
];

function bundleInput(text: string): Record<string, unknown> {
  const t = fold(text);
  const template = TEMPLATES.find(([pattern]) => pattern.test(t))?.[1] ?? "reading-corner";
  const budget = Number(/(\d[\d.,]*)/.exec(t)?.[1]?.replace(/[.,](?=\d{3}\b)/g, "").replace(",", ".") ?? "600");
  return { template, budgetEuros: Math.max(10, Math.min(50_000, Math.round(budget))) };
}

/** Words a request for a picture uses that name no piece: the verb, the room and its style. */
const PICTURE_WORDS = new Set(
  [
    "picture", "render", "visualise", "visualize", "imagine", "what", "would", "will", "does", "it", "this", "that", "look", "looks", "like", "how", "of", "make", "photo", "real",
    "style", "styled", "warm", "minimal", "scandinavian", "nordic", "dark", "moody", "mediterranean", "living", "space", "here", "one",
    "φαντασου", "φτιαξε", "εικονα", "πως", "θα", "φαινεται", "ενα", "δωματιο", "στιλ", "ζεστο", "μινιμαλ", "σκανδιναβικο", "σκοτεινο", "μεσογειακο", "εδω",
  ].map((word) => word.normalize("NFD").replace(/\p{M}/gu, "")),
);

/** The piece a picture is asked of ("picture a green sofa in a nordic room" → "green sofa"), or "" when none is named. */
export function pictureQueryOf(text: string): string {
  return searchQueryOf(text)
    .split(/[^\p{L}\p{N}-]+/u)
    .filter((word) => word.length > 1 && !PICTURE_WORDS.has(fold(word)))
    .join(" ")
    .trim();
}

/** Words a question about the way in uses that name no piece: the door, the stairs, the getting in. */
const WAY_WORDS = new Set(
  [
    "will", "would", "does", "it", "this", "that", "fit", "fits", "get", "through", "front", "door", "doors", "doorway", "hall", "hallway", "corridor",
    "up", "down", "stairs", "staircase", "into", "inside", "carry", "our", "home", "house", "flat", "apartment",
    "θα", "περασει", "περναει", "απο", "πορτα", "εξωπορτα", "σκαλες", "να", "μπει", "χωρεσει", "χωραει", "σπιτι", "διαμερισμα",
  ].map((word) => word.normalize("NFD").replace(/\p{M}/gu, "")),
);

/** The piece a question about the way in names ("will the Radford chair get through my door" → "Radford chair"). */
export function wayQueryOf(text: string): string {
  return searchQueryOf(text)
    .split(/[^\p{L}\p{N}-]+/u)
    .filter((word) => word.length > 1 && !WAY_WORDS.has(fold(word)))
    .join(" ")
    .trim();
}

/** Words a request about a board uses that name no piece. */
const BOARD_WORDS = new Set(
  ["board", "moodboard", "save", "keep", "on", "our", "πινακα", "πινακας", "κρατα", "αποθηκευσε", "στον", "στη"].map((word) => word.normalize("NFD").replace(/\p{M}/gu, "")),
);

/** "Add the Radford chair to my living room board" → the piece ("Radford chair") and the board ("living room"). */
export function boardRequestOf(text: string): { piece: string; board: string | undefined } {
  const named = /\b(?:to|on|onto) (?:my |the |our )?([\p{L}\d][\p{L}\d ]{1,38}?) board\b/iu.exec(text);
  const board = named?.[1]?.trim();
  const rest = board === undefined ? text : text.replace(named![0], " ");
  const piece = searchQueryOf(rest)
    .split(/[^\p{L}\p{N}-]+/u)
    .filter((word) => word.length > 1 && !BOARD_WORDS.has(fold(word)))
    .join(" ")
    .trim();
  return { piece, board: board === undefined || board.toLowerCase() === "my" ? undefined : board };
}

/** The showroom a picture is asked in; warm minimal when none is named. */
export function sceneStyleOf(text: string): "warm-minimal" | "scandinavian" | "dark-moody" | "mediterranean" {
  const t = fold(text);
  if (/scandinav|nordic|σκανδιναβ/.test(t)) return "scandinavian";
  if (/\b(dark|moody)\b|σκοτειν/.test(t)) return "dark-moody";
  if (/mediterran|μεσογει/.test(t)) return "mediterranean";
  return "warm-minimal";
}

/** Which window the words ask for: a curated theme, or a room and a budget of their own. */
function showcaseInput(text: string, locale: "en" | "el"): Record<string, unknown> {
  const t = fold(text);
  const caption = locale === "el" ? "Στήνω τη βιτρίνα" : "Setting up the window";
  if (/\d/.test(t)) return { ...bundleInput(text), caption };
  const themes: [RegExp, string][] = [
    [/\bgift|δωρ/, "small-gifts"],
    [/\bdining|τραπεζαρ/, "black-dining"],
    [/\bbed|υπνοδωματ|κρεβατ/, "oak-bedroom"],
    [/\bleather|δερμ/, "leather-living"],
    [/\bliving|lounge|σαλον/, "calm-living"],
  ];
  return { theme: themes.find(([pattern]) => pattern.test(t))?.[1] ?? "reading-corner", caption };
}

const say = (locale: "en" | "el", en: string, el: string): DemoStep => ({ kind: "text", text: locale === "el" ? el : en });

type Brief = { id: string; title: string; inStock?: boolean };
const productsIn = (output: unknown): Brief[] => ((output as { products?: Brief[] } | null)?.products ?? []);

/** The next step: tools to call, or the answer. */
export function demoStep(prompt: DemoPrompt): DemoStep {
  const { text, results, locale } = prompt;
  const offers = (name: string) => prompt.tools.includes(name);
  const intent = intentOf(text);
  const last = results.at(-1);
  const call = (toolName: string, input: Record<string, unknown>): DemoStep => (offers(toolName) ? { kind: "tools", calls: [{ toolName, input }] } : say(locale, "I can't do that here.", "Δεν μπορώ να το κάνω αυτό εδώ."));

  if (last?.denied === true) return say(locale, "Understood, I haven't done that.", "Εντάξει, δεν το έκανα.");

  // Nothing has run yet for this message: choose the first tool.
  if (last === undefined) {
    // A photograph with a question about pieces: the rules cannot see it, but the shop can read its colours.
    if (prompt.photo === true && ["browse", "room", "greet"].includes(intent)) return call("find_by_photo", {});
    const query = searchQueryOf(text);
    switch (intent) {
      case "greet":
        return say(
          locale,
          "Hello! I can find pieces, compare them, put a set together within a budget, add things to your cart and check on your orders. What are you looking for?",
          "Γεια! Μπορώ να βρω κομμάτια, να τα συγκρίνω, να φτιάξω ένα σετ μέσα σε έναν προϋπολογισμό, να προσθέσω στο καλάθι και να δω τις παραγγελίες σου. Τι ψάχνεις;",
        );
      case "person": {
        // Rules cannot summarise, so the shopper's own words are the summary, and they approve it first.
        const words = text.trim().slice(0, 500);
        const order = ORDER_NUMBER.exec(text)?.[0].toUpperCase();
        return call("hand_to_person", {
          summary: locale === "el" ? `Ζητήθηκε άνθρωπος από το κατάστημα: «${words}»` : `The shopper asked for a person: "${words}"`,
          topic: guessTopic(text),
          ...(order === undefined ? {} : { orderNumber: order }),
        });
      }
      case "size_advice":
        return call("suggest_size", measurementsOf(text)!);
      case "remember_size": {
        const size = sizeOf(text)!;
        return call("remember_preference", {
          patch: { sizes: { upper: size, lower: size, dress: size } },
          caption: locale === "el" ? `Θα θυμάμαι το νούμερο ${size}` : `Remembering size ${size}`,
        });
      }
      case "preferences":
        return call("get_preferences", {});
      case "comfort":
        return call("adjust_comfort", { settings: comfortRequestOf(text), caption: locale === "el" ? "Αλλαγή της εμφάνισης" : "Changing how the shop looks" });
      case "cart":
        return call("navigate", { href: "/cart", caption: locale === "el" ? "Άνοιγμα του καλαθιού" : "Opening the cart" });
      case "checkout":
        return call("start_checkout", {});
      case "orders":
        return call("get_orders", {});
      case "order_status":
        return call("get_order_status", { number: ORDER_NUMBER.exec(text)![0].toUpperCase() });
      case "return":
        return call("start_return", { number: ORDER_NUMBER.exec(text)![0].toUpperCase(), reason: "changed_mind" });
      case "bundle":
        return call("build_bundle", bundleInput(text));
      case "showcase":
        return call("compose_showcase", showcaseInput(text, locale));
      case "look":
        return call("shop_the_look", {});
      case "board": {
        const { piece } = boardRequestOf(text);
        if (piece === "") return say(locale, "Which piece shall I put on a board? Name it, for example \"add the Radford chair to my living room board\".", "Ποιο κομμάτι να βάλω σε πίνακα; Πες μου το, για παράδειγμα «βάλε την καρέκλα Radford στον πίνακα του σαλονιού».");
        return call("search_products", { query: piece, limit: 3 });
      }
      case "way_in": {
        const piece = wayQueryOf(text);
        if (piece === "") return say(locale, "Which piece shall I check? Name it, for example \"will the Radford chair get through my door?\"", "Ποιο κομμάτι να ελέγξω; Πες μου το, για παράδειγμα «θα περάσει η καρέκλα Radford από την πόρτα μου;»");
        return call("search_products", { query: piece, limit: 3 });
      }
      case "picture": {
        const piece = pictureQueryOf(text);
        if (piece === "") return say(locale, "Which piece shall I picture? Name it, for example \"picture a walnut sideboard in a Scandinavian room\".", "Ποιο κομμάτι να φανταστώ; Πες μου το, για παράδειγμα «φαντάσου μια καρυδένια μπουφέ σε σκανδιναβικό δωμάτιο».");
        return call("search_products", { query: piece, limit: 3 });
      }
      default:
        return call("search_products", { query, limit: intent === "compare" ? 4 : 6 });
    }
  }

  // Continue from what the last tool returned.
  const products = productsIn(last.output);
  switch (last.toolName) {
    case "search_products": {
      if (products.length === 0) return say(locale, "I couldn't find anything for that. Try other words, or a category.", "Δεν βρήκα κάτι γι' αυτό. Δοκίμασε άλλες λέξεις ή μια κατηγορία.");
      if (intent === "add") return call("add_to_cart", { productId: (products.find((product) => product.inStock !== false) ?? products[0])!.id, quantity: 1 });
      if (intent === "compare" && products.length >= 2) return call("compare_products", { ids: products.slice(0, Math.min(3, products.length)).map((product) => product.id) });
      // On a board: the one named, else the latest, else a new one.
      if (intent === "board") {
        const { board } = boardRequestOf(text);
        return call("add_to_board", { productId: products[0]!.id, ...(board === undefined ? {} : { board }) });
      }
      // The way in for the first piece found.
      if (intent === "way_in") return call("check_way_in", { productId: products[0]!.id });
      // A picture of the first piece found: in the photograph attached, or in the showroom named.
      if (intent === "picture") return call("picture_in_room", { productId: products[0]!.id, room: prompt.photo === true ? "photo" : sceneStyleOf(text) });
      // "…that matches my room" with a photograph of the room is a search, not a request to place a piece.
      if (intent === "room" && prompt.photo !== true) return call("place_in_room", { productId: products[0]!.id, caption: locale === "el" ? "Άνοιγμα στο δωμάτιό σου" : "Opening it in your room" });
      return call("show_products", { productIds: products.map((product) => product.id), caption: locale === "el" ? "Εμφάνιση προτάσεων" : "Showing what I found" });
    }
    case "find_by_photo": {
      const output = last.output as { ok?: boolean; colours?: string[] };
      if (output.ok !== true) return say(locale, "I couldn't read that photograph. Try attaching it again.", "Δεν μπόρεσα να διαβάσω τη φωτογραφία. Δοκίμασε να την επισυνάψεις ξανά.");
      // The question named a kind of piece ("a coffee table that suits this room"): that kind, in the photograph's main colour.
      const kind = kindQueryOf(text);
      if (kind !== "" && offers("search_products")) return call("search_products", { query: [kind, output.colours?.[0]].filter(Boolean).join(" "), limit: 6 });
      if (products.length === 0) return say(locale, "I read the colours of your photograph, but nothing in the shop matches them closely.", "Διάβασα τα χρώματα της φωτογραφίας σου, αλλά τίποτα στο κατάστημα δεν τους μοιάζει αρκετά.");
      return call("show_products", { productIds: products.map((product) => product.id), caption: locale === "el" ? "Κομμάτια στα χρώματα της φωτογραφίας σου" : "Pieces in your photograph's colours" });
    }
    case "show_products": {
      // After a photograph, say which colours were read: the rules read colour, not objects.
      const fromPhoto = results.find((result) => result.toolName === "find_by_photo")?.output as { colours?: string[] } | undefined;
      const colours = (fromPhoto?.colours ?? []).slice(0, 3);
      if (colours.length > 0)
        return say(
          locale,
          `I read ${colours.join(", ")} in your photograph and found ${products.length === 1 ? "one piece" : `${products.length} pieces`} in those colours. Want me to narrow it to one kind of piece?`,
          `Διάβασα ${colours.join(", ")} στη φωτογραφία σου και βρήκα ${products.length === 1 ? "ένα κομμάτι" : `${products.length} κομμάτια`} σε αυτά τα χρώματα. Να περιορίσω σε ένα είδος;`,
        );
      return say(locale, `Here ${products.length === 1 ? "is one piece that matches" : `are ${products.length} pieces that match`}. Want me to compare two of them or add one to your cart?`, `Να ${products.length === 1 ? "ένα κομμάτι που ταιριάζει" : `${products.length} κομμάτια που ταιριάζουν`}. Να συγκρίνω δύο ή να προσθέσω κάποιο στο καλάθι;`);
    }
    case "add_to_cart": {
      const output = last.output as { ok: boolean; title?: string; reason?: string };
      if (!output.ok) return say(locale, "I couldn't add that: it may be out of stock.", "Δεν μπόρεσα να το προσθέσω: ίσως έχει εξαντληθεί.");
      return say(locale, `Added ${output.title} to your cart. You can undo it from the actions list.`, `Πρόσθεσα το ${output.title} στο καλάθι σου. Μπορείς να το αναιρέσεις από τη λίστα ενεργειών.`);
    }
    case "compare_products":
      return say(locale, "Here they are side by side. The table shows prices, sizes, materials and ratings from the shop.", "Να τα δίπλα-δίπλα. Ο πίνακας δείχνει τιμές, διαστάσεις, υλικά και βαθμολογίες από το κατάστημα.");
    case "compose_showcase": {
      const found = (last.output as { found?: boolean }).found === true;
      return found
        ? say(locale, "Here is the window: pieces that go together, at their real sizes. Buy the whole window in one tap, or any piece on its own.", "Να η βιτρίνα: κομμάτια που ταιριάζουν, στο πραγματικό τους μέγεθος. Πάρε όλη τη βιτρίνα με ένα άγγιγμα ή όποιο κομμάτι θέλεις.")
        : say(locale, "I opened the window, but no complete set in stock fits that budget right now, so it shows what a search finds instead.", "Άνοιξα τη βιτρίνα, αλλά κανένα ολόκληρο σετ σε απόθεμα δεν χωρά τώρα σε αυτό το ποσό, οπότε δείχνει ό,τι βρίσκει μια αναζήτηση.");
    }
    case "build_bundle": {
      const bundles = (last.output as { bundles?: unknown[] }).bundles ?? [];
      return bundles.length === 0
        ? say(locale, "I couldn't fit a complete set in that budget. A little more room, or fewer pieces, would help.", "Δεν χώρεσε ολόκληρο σετ σε αυτόν τον προϋπολογισμό. Λίγο μεγαλύτερο ποσό ή λιγότερα κομμάτια θα βοηθούσαν.")
        : say(locale, `I put together ${bundles.length} ${bundles.length === 1 ? "set" : "sets"} within your budget, below.`, `Έφτιαξα ${bundles.length} ${bundles.length === 1 ? "σετ" : "σετ"} μέσα στον προϋπολογισμό σου, παρακάτω.`);
    }
    case "get_orders": {
      const orders = (last.output as { orders?: unknown[]; signedIn?: boolean }).orders ?? [];
      return orders.length === 0
        ? say(locale, "I don't see any orders for you here. If you ordered as a guest on another device, the link in your email opens it.", "Δεν βλέπω παραγγελίες σου εδώ. Αν παρήγγειλες χωρίς λογαριασμό από άλλη συσκευή, ο σύνδεσμος στο email σου την ανοίγει.")
        : say(locale, `You have ${orders.length} recent ${orders.length === 1 ? "order" : "orders"}; they're listed below.`, `Έχεις ${orders.length} πρόσφατ${orders.length === 1 ? "η παραγγελία" : "ες παραγγελίες"}· φαίνονται παρακάτω.`);
    }
    case "get_order_status": {
      const output = last.output as { found: boolean; number?: string; status?: string };
      return output.found ? say(locale, `Order ${output.number} is ${output.status?.replace(/_/g, " ")}.`, `Η παραγγελία ${output.number}: ${output.status?.replace(/_/g, " ")}.`) : say(locale, "I can't find that order among yours.", "Δεν βρίσκω αυτή την παραγγελία στις δικές σου.");
    }
    case "start_return": {
      const output = last.output as { ok: boolean };
      return output.ok ? say(locale, "Your return is requested. The shop will arrange the collection and your refund.", "Το αίτημα επιστροφής καταχωρίστηκε. Το κατάστημα θα κανονίσει την παραλαβή και την επιστροφή χρημάτων.") : say(locale, "That order can't be returned from here.", "Αυτή η παραγγελία δεν μπορεί να επιστραφεί από εδώ.");
    }
    case "hand_to_person": {
      const output = last.output as { ok: boolean; number?: string; reason?: string };
      if (output.ok) {
        return say(
          locale,
          `I've passed this to the team as ${output.number}. A person will reply within one working day, by email and on the ticket's page.`,
          `Το έδωσα στην ομάδα ως ${output.number}. Θα σου απαντήσει άνθρωπος μέσα σε μία εργάσιμη, με email και στη σελίδα του αιτήματος.`,
        );
      }
      if (output.reason === "needs_contact") {
        return say(
          locale,
          "A person needs an email to reply to, so I've opened the contact form with your message already written. Add your email there and send it.",
          "Για να σου απαντήσει άνθρωπος χρειάζεται ένα email, οπότε άνοιξα τη φόρμα επικοινωνίας με το μήνυμά σου ήδη γραμμένο. Πρόσθεσε εκεί το email σου και στείλ' το.",
        );
      }
      return say(locale, "I couldn't pass that on just now. The contact page reaches the same people.", "Δεν μπόρεσα να το προωθήσω αυτή τη στιγμή. Η σελίδα επικοινωνίας φτάνει στους ίδιους ανθρώπους.");
    }
    case "suggest_size": {
      const output = last.output as { size?: string; decidedBy?: string; apart?: number; beyondChart?: boolean; verdicts?: { measure: string; cm: number; upToCm: number }[]; problem?: string } | null;
      if (output?.size === undefined) {
        return say(
          locale,
          "I need your measurements in centimetres to work out a size: chest and waist for tops and dresses, waist and hip for trousers and skirts. \"Find your size\" on a piece's page does the same.",
          "Χρειάζομαι τις μετρήσεις σου σε εκατοστά: στήθος και μέση για μπλούζες και φορέματα, μέση και γοφούς για παντελόνια και φούστες. Το «Βρες το νούμερό σου» στη σελίδα κάθε κομματιού κάνει το ίδιο.",
        );
      }
      const decider = output.verdicts?.find((verdict) => verdict.measure === output.decidedBy);
      const name = MEASURE_NAMES[output.decidedBy ?? "chest"]!;
      const why = decider === undefined ? "" : locale === "el" ? ` Για ${name.el} ${decider.cm} εκ. το ${output.size} φτάνει έως ${decider.upToCm} εκ.` : ` For a ${name.en} of ${decider.cm} cm, ${output.size} goes up to ${decider.upToCm} cm.`;
      const apart = (output.apart ?? 0) >= 2 ? (locale === "el" ? " Οι μετρήσεις σου απέχουν αρκετά, οπότε κανένα νούμερο δεν εφαρμόζει καλά και στις δύο." : " Your measurements are far apart, so no size fits both closely.") : "";
      return say(
        locale,
        `I'd take ${output.size}.${why}${apart} Shall I remember ${output.size} as your size?`,
        `Θα έπαιρνα ${output.size}.${why}${apart} Να θυμάμαι το ${output.size} ως νούμερό σου;`,
      );
    }
    case "shop_the_look": {
      const output = last.output as { ok?: boolean; reason?: string; drawn?: boolean; pieces?: { kind: string | null }[] } | null;
      if (output?.ok !== true) {
        if (output?.reason === "no_photo") return say(locale, "Attach a photo of the room first, then ask me to shop the look.", "Επισύναψε πρώτα μια φωτογραφία του δωματίου και ζήτα μου να βρω το στιλ.");
        return say(locale, "I couldn't find pieces the shop sells in that photo.", "Δεν βρήκα σε αυτή τη φωτογραφία κομμάτια που πουλάει το κατάστημα.");
      }
      if (output.drawn === true) return say(locale, "Without the shop's AI I can't tell the pieces apart, so these match the whole photo's colours.", "Χωρίς την AI του καταστήματος δεν ξεχωρίζω τα κομμάτια, οπότε αυτά ταιριάζουν στα χρώματα όλης της φωτογραφίας.");
      const kinds = (output.pieces ?? []).map((piece) => piece.kind).filter((kind) => kind !== null);
      return say(locale, `I found ${kinds.length}: ${kinds.join(", ")}. Each has the shop's closest pieces below.`, `Βρήκα ${kinds.length}: ${kinds.join(", ")}. Για το καθένα, τα πιο κοντινά κομμάτια του καταστήματος είναι από κάτω.`);
    }
    case "add_to_board": {
      const output = last.output as { ok?: boolean; reason?: string; title?: string; board?: string } | null;
      if (output?.ok === true) return say(locale, `Done: ${output.title} is on "${output.board}". Open the board to share it, or to see what it all comes to.`, `Έγινε: το ${output.title} μπήκε στον πίνακα «${output.board}». Άνοιξε τον πίνακα για να τον μοιραστείς ή να δεις πόσο κάνουν όλα μαζί.`);
      if (output?.reason === "full") return say(locale, "That board is full: forty pieces. Start another one.", "Αυτός ο πίνακας είναι γεμάτος: σαράντα κομμάτια. Ξεκίνα έναν άλλο.");
      if (output?.reason === "too_many") return say(locale, "You have twelve boards already. Delete one, then ask me again.", "Έχεις ήδη δώδεκα πίνακες. Σβήσε έναν και ρώτα με ξανά.");
      return say(locale, "That piece couldn't go on a board.", "Αυτό το κομμάτι δεν μπόρεσε να μπει σε πίνακα.");
    }
    case "check_way_in": {
      const output = last.output as { ok?: boolean; reason?: string; title?: string; fits?: boolean; firstFailure?: number | null; steps?: { kind: string; marginCm: number }[] } | null;
      if (output?.ok === true) {
        if (output.fits === true) {
          const tightest = Math.min(...(output.steps ?? []).map((step) => step.marginCm));
          return say(locale, `Yes: ${output.title} gets in, with ${tightest} cm to spare at the tightest step.`, `Ναι: το ${output.title} μπαίνει, με ${tightest} εκ. περιθώριο στο πιο στενό βήμα.`);
        }
        const failing = output.firstFailure ?? 0;
        const short = -(output.steps?.[failing]?.marginCm ?? 0);
        return say(locale, `No: ${output.title} won't get past step ${failing + 1}, it is ${short} cm too big there.`, `Όχι: το ${output.title} δεν περνάει από το βήμα ${failing + 1}, του λείπουν ${short} εκ. εκεί.`);
      }
      if (output?.reason === "no_way_in") return say(locale, "Measure your way in first: I've opened the page for it, under your preferences.", "Μέτρησε πρώτα τη διαδρομή σου: σου άνοιξα τη σελίδα, στις προτιμήσεις σου.");
      return say(locale, "That piece isn't one that has to be carried in.", "Αυτό το κομμάτι δεν χρειάζεται να περάσει από πόρτες.");
    }
    case "picture_in_room": {
      const output = last.output as { ok?: boolean; reason?: string; title?: string; ready?: boolean } | null;
      if (output?.ok === true) {
        return output.ready === true
          ? say(locale, `Here is ${output.title}, in a room someone already asked for, so it was free.`, `Ορίστε το ${output.title}, σε ένα δωμάτιο που είχε ζητήσει ήδη κάποιος, οπότε ήταν δωρεάν.`)
          : say(locale, `I'm making a picture of ${output.title}. It develops below in about twenty seconds.`, `Φτιάχνω μια εικόνα με το ${output.title}. Εμφανίζεται από κάτω σε περίπου είκοσι δευτερόλεπτα.`);
      }
      if (output?.reason === "no_photo") return say(locale, "Attach a photo of your room first, then ask me again.", "Επισύναψε πρώτα μια φωτογραφία του δωματίου σου και ρώτα με ξανά.");
      if (output?.reason === "not_for_rooms") return say(locale, "That piece isn't one for a room, so there's no picture to make.", "Αυτό το κομμάτι δεν είναι για δωμάτιο, οπότε δεν υπάρχει εικόνα να φτιάξω.");
      if (output?.reason === "allowance") return say(locale, "That's today's pictures. The ready showroom pictures on the piece's page are still free.", "Αυτές ήταν οι σημερινές εικόνες. Τα έτοιμα δωμάτια στη σελίδα του κομματιού είναι ακόμα δωρεάν.");
      return say(locale, "The picture couldn't be started right now. Try again in a moment.", "Η εικόνα δεν μπόρεσε να ξεκινήσει τώρα. Δοκίμασε ξανά σε λίγο.");
    }
    case "place_in_room": {
      const output = last.output as { placeable?: boolean; roomsSaved?: number; fits?: { room: string; fits: boolean; spareCm: number }[] } | null;
      if (output?.placeable !== true) return say(locale, "That piece can't be placed in a room photo: it has no floor measurements.", "Αυτό το κομμάτι δεν μπαίνει σε φωτογραφία δωματίου: δεν έχει μετρήσεις δαπέδου.");
      if ((output.roomsSaved ?? 0) === 0) {
        return say(
          locale,
          "I've opened it in the room planner. Save your room's wall below the photo and I can tell you whether it fits.",
          "Το άνοιξα στο εργαλείο δωματίου. Αποθήκευσε τον τοίχο σου κάτω από τη φωτογραφία και θα σου πω αν χωράει.",
        );
      }
      const fitting = (output.fits ?? []).filter((fit) => fit.fits);
      if (fitting.length === 0) {
        return say(
          locale,
          "It's too wide for the walls you saved, leaving room to walk past. I've opened it in the planner so you can see it anyway.",
          "Είναι πολύ φαρδύ για τους τοίχους που αποθήκευσες, αν αφήσεις χώρο για να περνάς. Το άνοιξα στο εργαλείο δωματίου για να το δεις.",
        );
      }
      const first = fitting[0]!;
      return say(
        locale,
        `It fits your ${first.room} wall with ${first.spareCm} cm to spare. I've opened it in the planner so you can see it in a photo of the room.`,
        `Χωράει στον τοίχο «${first.room}» με ${first.spareCm} εκ. περιθώριο. Το άνοιξα στο εργαλείο δωματίου για να το δεις σε φωτογραφία του χώρου.`,
      );
    }
    case "remember_preference":
      return say(
        locale,
        "Kept. Sizes start there on every piece, and you can change it any time under Your shop in your account.",
        "Το κράτησα. Τα νούμερα ξεκινούν από εκεί σε κάθε κομμάτι, και το αλλάζεις όποτε θέλεις από το Το κατάστημά σου στον λογαριασμό.",
      );
    case "get_preferences": {
      const prefs = last.output as { sizes?: Record<string, string>; rooms?: unknown[]; empty?: boolean } | null;
      if (prefs === null || prefs.empty === true)
        return say(locale, "You haven't told me anything about yourself yet: sizes, rooms or what you like. Your shop, in your account, is where it all goes.", "Δεν μου έχεις πει τίποτα ακόμη: νούμερα, δωμάτια ή τι σου αρέσει. Όλα μπαίνουν στο Το κατάστημά σου, στον λογαριασμό σου.");
      const sizes = [...new Set(Object.values(prefs.sizes ?? {}))].join(", ");
      const rooms = prefs.rooms?.length ?? 0;
      return say(
        locale,
        `I know ${sizes === "" ? "no sizes" : `your size (${sizes})`} and ${rooms} room${rooms === 1 ? "" : "s"}. Everything I keep is under What we know about you in your account, where you can delete any of it.`,
        `Ξέρω ${sizes === "" ? "κανένα νούμερο" : `το νούμερό σου (${sizes})`} και ${rooms} ${rooms === 1 ? "δωμάτιο" : "δωμάτια"}. Ό,τι κρατάω είναι στο Τι ξέρουμε για σένα στον λογαριασμό σου, όπου μπορείς να σβήσεις οτιδήποτε.`,
      );
    }
    case "adjust_comfort":
      return say(
        locale,
        "Done: it's changed on this device. The Aa button at the top changes it back, or you can undo it from the actions list.",
        "Έγινε: άλλαξε σε αυτή τη συσκευή. Το κουμπί Aa στην κορυφή το επαναφέρει, ή μπορείς να το αναιρέσεις από τη λίστα ενεργειών.",
      );
    case "start_checkout": {
      const output = last.output as { ok: boolean };
      return output.ok ? say(locale, "Checkout is open: check your order and pay there.", "Άνοιξε η ολοκλήρωση αγοράς: έλεγξε την παραγγελία και πλήρωσε εκεί.") : say(locale, "Your cart is empty, so there's nothing to check out yet.", "Το καλάθι σου είναι άδειο, οπότε δεν υπάρχει κάτι για ολοκλήρωση ακόμη.");
    }
    default:
      return say(locale, "Done.", "Έγινε.");
  }
}
