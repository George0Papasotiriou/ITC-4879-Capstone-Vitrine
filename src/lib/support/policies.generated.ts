/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * The shop's policies as the support assistant reads them. Generated from docs/policies.md; do not edit.
 */

/** Written by `pnpm support policies`. The document itself is docs/policies.md, which George approves. */
export const POLICIES = `# Vitrine shop policies

- Status: **draft, written by Claude Code from what the shop actually does. George approves it
  before the support assistant is allowed to answer from it.**
- Last checked against the code: 2026-09-20
- Purpose: one source of truth for the support desk. The support assistant answers **only** from
  this file; anything not written here is handed to a person.

Everything below matches the code it names. When the code changes, this file changes in the same
step, because the assistant quotes it.

Lines marked **[George decides]** are the ones that are not in the code yet.

---

## 1. What Vitrine is

Vitrine is a student project for ITC 4949 at the American College of Greece. The shop works end to
end, but:

- product photography comes from the Amazon Berkeley Objects dataset (CC BY-NC 4.0);
- prices are synthetic — they are not any real shop's prices;
- payment is a **test payment**: no card is charged and nothing is dispatched.

Support must never let a customer believe a real order is coming.

## 2. Prices and tax (\`src/lib/commerce/vat.ts\`, ADR-013, ADR-015)

- Prices on the site include Greek VAT (24%) and are shown in euros.
- Which prices you see follows the country the shop thinks you are in; you can change it yourself
  at the bottom of any page.
- **What you are charged follows the delivery address**, not the country you are browsing from.
  - Delivery inside the EU: the VAT of the delivery country (Greece 24%, Germany 19%, and so on).
  - Delivery outside the EU: no Greek VAT. The order is an export.
- Exports: the United Kingdom is charged UK VAT (20%) on orders up to about €160 (£135), because
  the seller must collect it. Everywhere else outside the EU, import tax and duty are paid by the
  customer on delivery, to the carrier or customs, and are not part of the order total.

## 3. Delivery (\`src/lib/commerce/pricing.ts\`)

Working days, from dispatch.

| Where | Standard | Free standard over | Express |
|---|---|---|---|
| Greece | €6.90, 2–4 days | €150 | €14.90, next day |
| Cyprus | €19.90, 4–7 days | €400 | €39.90, 2–3 days |
| Rest of the EU | €24.90, 5–9 days | €500 | €49.90, 2–4 days |
| United Kingdom, Norway, Switzerland, Liechtenstein, Iceland | €39.90 without VAT, 6–12 days | €800 without VAT | €79.90, 3–5 days |
| United States, Canada, Australia, New Zealand, Japan | €79.90 without VAT, 10–20 days | no free delivery | €149.90, 4–7 days |

- The shop delivers to the EU and to those ten countries. Anywhere else, checkout says so before
  any details are entered.
- Delivery dates are estimates, never promises. Support does not give a date the shop has not
  given.
- **[George decides]** whether islands or remote areas carry a surcharge. Until he does, there is
  none, and support says there is none.

## 4. Payment

- The shop takes a **test payment** at checkout: the order is placed and confirmed by email, and
  nothing is charged.
- Stripe test mode arrives when George has an account; card details are never asked for by
  support, by email, or by the Concierge, and never will be.

## 5. Orders, changes and cancellation (\`src/lib/commerce/order-state.ts\`)

An order moves: placed → paid → packed → shipped → delivered. It can be cancelled while it is
placed, paid or packed. Once it is shipped, it is a return, not a cancellation.

- A customer can ask to cancel by replying to their order email or through support.
- Address changes are possible while the order is not yet packed. **[George decides]** whether the
  desk may edit an address; today the answer is to cancel and order again.
- Every change sends the customer an email.

## 6. Returns and refunds (ADR-017, \`src/lib/commerce/returns.ts\`)

- **14 days from delivery.** The order page shows the date the window closes.
- The customer chooses a reason: changed my mind, damaged, not as described, wrong item, other.
- The piece must come back in the condition it arrived in, with anything that came with it.
- The refund is the price paid for the returned lines, including the VAT charged on them.
- **[George decides]**: who pays return postage (today the shop arranges collection and the
  customer is told the cost before anything is collected), and whether the original delivery charge
  is refunded. Support says "we will tell you the cost before we collect" until he decides.
- Damaged, wrong or not as described: the shop pays, and support apologises and arranges it without
  asking for anything else.
- Refunds are made to the original payment. **[George decides]** how many working days to state;
  until then support says "as soon as the return arrives, and you will get an email".

## 7. Stock

- What the product page says is what the database says, at that moment.
- Nothing is held in a cart. **[George decides]** the 30-minute hold at checkout named in the plan;
  until it exists, support does not promise one.
- A piece that runs out between adding and paying is refused at checkout with the reason, and
  nothing is charged.

## 8. Reviews (ADR-017)

- Only customers who bought the piece and had it delivered can review it, one review per line of a
  delivered order.
- Reviews appear at once and can be rewritten by their author.
- The shop hides a review only when it is abusive, names a person, or is not about the piece; the
  author is told why. The shop never hides a review for being critical.

## 9. Accounts (ADR-016)

- An account needs a confirmed email address. Sign-in is by password, passkey, or Google.
- Two-step sign-in with an authenticator app is available in the account page.
- Support never asks for a password, a code from an authenticator, or a one-time link. Support
  cannot see any of them.
- A customer can ask for their account and its data to be deleted; the desk passes it to an admin.

## 10. Privacy (docs/PLAN.md 2.9, ADR-018, ADR-019)

- Searches are recorded without any identifier, and only for 90 days, to find searches that return
  nothing. Anything that looks like an email address or a phone number is removed before it is
  written.
- AI calls are recorded with the feature, the model and what they cost. **No message text and no
  personal data are recorded.**
- Photos a customer uploads for the Fitting Room or "See it in your room" (Phase 9) need consent,
  are kept for 24 hours and are then deleted, and never appear in logs.
- Price watches belong to an account and go when the account does.

## 11. Price watches (ADR-020)

- A signed-in customer can name a price below today's on any product page. The shop emails them
  once, the day the price reaches it.
- One watch per piece, twenty per person. Watching again after the price goes back up needs no
  action: the watch arms itself.
- Watching a price is not a promise that the price will fall, and no discount can be requested
  through it.

## 12. What the AI does and does not do (ADR-019)

- The Concierge searches, compares, recommends, builds sets, fills the cart and moves the page.
- It never pays, never enters personal details, never changes a price and never promises anything
  the shop has not said. Checkout and returns always ask the customer first.
- It says when an answer comes from demo rules rather than a model.
- Anyone can ask for a person instead, at any point, and support takes over with what was said so
  far.

## 13. Contacting support

- Through the contact page, by replying to any order email, or by asking the Concierge for a
  person.
- **First reply within one working day** (24 hours) — this is the promise the desk's timers are
  built on.
- The desk is open **[George decides]** (hours and days). Until he decides, the shop states only
  the 24-hour first reply.

## 14. Rules for whoever answers, person or assistant

1. Never promise a delivery date, a refund amount, a discount or a timescale that is not in this
   file.
2. Never ask for a password, a card number, a code, or a copy of an identity document.
3. Quote the customer's own order number back to them; never mention another customer's order.
4. If the answer is not here, say so and pass it to a person. That is always better than a guess.
5. Say what happens next and when, in one sentence, at the end of every reply.
`;
