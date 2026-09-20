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

export type DemoToolResult = { toolName: string; output: unknown; denied?: boolean };

export type DemoPrompt = {
  /** The shopper's last message. */
  text: string;
  /** Tool results since that message, oldest first. */
  results: DemoToolResult[];
  /** Tools this surface offers. */
  tools: readonly string[];
  locale: "en" | "el";
};

export type DemoCall = { toolName: string; input: Record<string, unknown> };
export type DemoStep = { kind: "tools"; calls: DemoCall[] } | { kind: "text"; text: string };

type Intent = "greet" | "cart" | "checkout" | "orders" | "order_status" | "return" | "compare" | "add" | "bundle" | "room" | "browse";

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
  if (/\b(return|send (it|this|them) back)\b|επιστρ/.test(t) && ORDER_NUMBER.test(t)) return "return";
  if (ORDER_NUMBER.test(t)) return "order_status";
  if (/\border|παραγγελ/.test(t)) return "orders";
  if (/\b(check ?out|pay)\b|ολοκληρωσ|πληρωμ/.test(t)) return "checkout";
  if (/\b(compare|versus|vs)\b|συγκριν/.test(t)) return "compare";
  // A budget with a room or a set is a bundle, even when it says "put together".
  if (/\b(set|bundle|corner|budget)\b|σετ|γωνια/.test(t) && /\d/.test(t)) return "bundle";
  if (/\b(add|put|buy)\b|προσθεσ|βαλε/.test(t)) return "add";
  if (/\bmy room\b|δωματιο μου/.test(t)) return "room";
  if (/\b(cart|basket)\b|καλαθι/.test(t)) return "cart";
  return "browse";
}

export function searchQueryOf(text: string): string {
  const words = text.replace(ORDER_NUMBER, " ").split(/[^\p{L}\p{N}€.,-]+/u).filter((word) => word !== "" && !COMMAND_WORDS.has(fold(word)));
  return words.join(" ").trim() || text.trim();
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
    const query = searchQueryOf(text);
    switch (intent) {
      case "greet":
        return say(
          locale,
          "Hello! I can find pieces, compare them, put a set together within a budget, add things to your cart and check on your orders. What are you looking for?",
          "Γεια! Μπορώ να βρω κομμάτια, να τα συγκρίνω, να φτιάξω ένα σετ μέσα σε έναν προϋπολογισμό, να προσθέσω στο καλάθι και να δω τις παραγγελίες σου. Τι ψάχνεις;",
        );
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
      if (intent === "room") return call("open_viewer", { productId: products[0]!.id, viewer: "room", caption: locale === "el" ? "Άνοιγμα στο δωμάτιό σου" : "Opening it in your room" });
      return call("show_products", { productIds: products.map((product) => product.id), caption: locale === "el" ? "Εμφάνιση προτάσεων" : "Showing what I found" });
    }
    case "show_products":
      return say(locale, `Here ${products.length === 1 ? "is one piece that matches" : `are ${products.length} pieces that match`}. Want me to compare two of them or add one to your cart?`, `Να ${products.length === 1 ? "ένα κομμάτι που ταιριάζει" : `${products.length} κομμάτια που ταιριάζουν`}. Να συγκρίνω δύο ή να προσθέσω κάποιο στο καλάθι;`);
    case "add_to_cart": {
      const output = last.output as { ok: boolean; title?: string; reason?: string };
      if (!output.ok) return say(locale, "I couldn't add that: it may be out of stock.", "Δεν μπόρεσα να το προσθέσω: ίσως έχει εξαντληθεί.");
      return say(locale, `Added ${output.title} to your cart. You can undo it from the actions list.`, `Πρόσθεσα το ${output.title} στο καλάθι σου. Μπορείς να το αναιρέσεις από τη λίστα ενεργειών.`);
    }
    case "compare_products":
      return say(locale, "Here they are side by side. The table shows prices, sizes, materials and ratings from the shop.", "Να τα δίπλα-δίπλα. Ο πίνακας δείχνει τιμές, διαστάσεις, υλικά και βαθμολογίες από το κατάστημα.");
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
    case "start_checkout": {
      const output = last.output as { ok: boolean };
      return output.ok ? say(locale, "Checkout is open: check your order and pay there.", "Άνοιξε η ολοκλήρωση αγοράς: έλεγξε την παραγγελία και πλήρωσε εκεί.") : say(locale, "Your cart is empty, so there's nothing to check out yet.", "Το καλάθι σου είναι άδειο, οπότε δεν υπάρχει κάτι για ολοκλήρωση ακόμη.");
    }
    default:
      return say(locale, "Done.", "Έγινε.");
  }
}
