/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * End-to-end tests for verified reviews and customer returns, from delivery to the product page and the refund.
 */

import { randomInt } from "node:crypto";

import { expect, test } from "@playwright/test";

import { fillAndSubmit, freshPage, LAMP, linkFromOutbox } from "./support/accounts";
import { moveAtDesk, paidGuestOrder, signInAdmin } from "./support/orders";

/**
 * Reviews and returns (docs/adr/017). A guest orders and pays; the admin packs,
 * ships and delivers at the desk; the guest then reviews from the order's own
 * page, or sends it back. Review text carries a random word so each test finds
 * its own review among those the other device project wrote.
 */

const DELIVER = [
  { action: "pack", status: "Packed" },
  { action: "ship", status: "Shipped" },
  { action: "deliver", status: "Delivered" },
];

test("@smoke a delivered order's piece is reviewed, and the review appears on the product page as verified", async ({ browser }, info) => {
  const guest = await freshPage(browser);
  const order = await paidGuestOrder(guest);
  // Before delivery there is nothing to review.
  await expect(guest.locator('[data-agent-id="order:reviews"]')).toHaveCount(0);

  const staff = await freshPage(browser);
  await signInAdmin(staff, info);
  await moveAtDesk(staff, order.number, DELIVER);

  // The delivered email invites a review.
  const delivered = await linkFromOutbox(guest, order.email, "order_delivered");
  await guest.goto(delivered);
  const reviews = guest.locator('[data-agent-id="order:reviews"]');
  await expect(reviews).toBeVisible();
  const marker = `marker${randomInt(1e9)}`;
  await reviews.locator('[data-agent-id^="review:open:"]').first().click();
  await guest.locator('[data-agent-id="review:stars:5"]').check({ force: true });
  await fillAndSubmit(
    guest,
    { "review:title": "Warm, even light", "review:body": `The linen shade softens the light nicely and the base is steady. ${marker}` },
    `review:submit:${await reviews.locator('[data-agent-id^="review:item:"]').first().getAttribute("data-agent-id").then((id) => id!.replace("review:item:", ""))}`,
  );
  await expect(guest.getByText("Thank you. Your review is published.", { exact: true })).toBeVisible();

  await guest.goto(LAMP, { waitUntil: "domcontentloaded" });
  const mine = guest.locator('[data-agent-id="product:reviews"] li').filter({ hasText: marker });
  await expect(mine).toContainText("Verified purchase");
  await expect(mine).toContainText("Maria G.");
  await expect(mine.getByRole("img", { name: "5 stars" })).toBeVisible();
  const jsonLd = JSON.parse((await guest.locator('script[type="application/ld+json"]').first().textContent())!) as { aggregateRating?: { reviewCount: number } }[];
  expect(jsonLd[0]!.aggregateRating!.reviewCount).toBeGreaterThan(0);
  await guest.context().close();
  await staff.context().close();
});

test("a review is refused before delivery, and too short a review is explained", async ({ browser }) => {
  const guest = await freshPage(browser);
  const order = await paidGuestOrder(guest);
  const url = new URL(order.url);
  const id = url.pathname.split("/").at(-1)!;
  const token = url.searchParams.get("t")!;
  const response = await guest.request.post(`/api/orders/${id}/reviews`, {
    data: { token, orderItemId: "01890000-0000-7000-8000-000000000000", locale: "en", review: { rating: 5, body: "Lovely lamp, would buy again without a doubt." } },
  });
  expect(response.status()).toBe(404);
  const short = await guest.request.post(`/api/orders/${id}/reviews`, {
    data: { token, orderItemId: "01890000-0000-7000-8000-000000000000", locale: "en", review: { rating: 5, body: "Nice." } },
  });
  expect(short.status()).toBe(422);
  expect(((await short.json()) as { fields: Record<string, string> }).fields.body).toBe("too_short");
  await guest.context().close();
});

test("a customer returns a delivered order with a reason; staff receive it and refund", async ({ browser }, info) => {
  const guest = await freshPage(browser);
  const order = await paidGuestOrder(guest);
  const staff = await freshPage(browser);
  await signInAdmin(staff, info);
  await moveAtDesk(staff, order.number, DELIVER);

  await guest.goto(order.url, { waitUntil: "domcontentloaded" });
  const panel = guest.locator('[data-agent-id="order:return"]');
  await expect(panel).toContainText("You can send this order back until");
  await guest.locator('[data-agent-id="action:open-return"]').click();
  await guest.locator('[data-agent-id="action:request-return"]').click();
  await expect(guest.getByText("Choose a reason.")).toBeVisible();
  await guest.locator('[data-agent-id="return:reason:damaged"]').check();
  await fillAndSubmit(guest, { "return:note": "The box was crushed at one corner" }, "action:request-return");
  await expect(guest.locator('[data-agent-id="order:status"]')).toHaveText("Return requested");
  await linkFromOutbox(guest, order.email, "order_returnRequested");

  await moveAtDesk(staff, order.number, [{ action: "receive_return", status: "Returned" }]);
  await expect(staff.locator('[data-agent-id="staff:history"]')).toContainText("It arrived damaged — The box was crushed at one corner");
  await staff.locator('[data-agent-id="staff:action:refund"]').click();
  await fillAndSubmit(staff, { "staff:reason": "Damaged in transit" }, "staff:confirm:refund");
  await expect(staff.locator('[data-agent-id="staff:status"]')).toHaveText("Refunded");
  await linkFromOutbox(guest, order.email, "order_refunded");
  await guest.context().close();
  await staff.context().close();
});

test("staff hide a review, which leaves the product page and its rating, and can restore it", async ({ browser }, info) => {
  const guest = await freshPage(browser);
  const order = await paidGuestOrder(guest);
  const staff = await freshPage(browser);
  await signInAdmin(staff, info);
  await moveAtDesk(staff, order.number, DELIVER);

  await guest.goto(order.url, { waitUntil: "domcontentloaded" });
  const marker = `marker${randomInt(1e9)}`;
  const item = guest.locator('[data-agent-id^="review:item:"]').first();
  const itemId = (await item.getAttribute("data-agent-id"))!.replace("review:item:", "");
  await guest.locator(`[data-agent-id="review:open:${itemId}"]`).click();
  await guest.locator('[data-agent-id="review:stars:1"]').check({ force: true });
  await fillAndSubmit(guest, { "review:body": `My phone number is 690 000 0000, call me about it. ${marker}` }, `review:submit:${itemId}`);
  await expect(guest.getByText("Thank you. Your review is published.", { exact: true })).toBeVisible();

  await staff.goto("/en/staff/reviews", { waitUntil: "domcontentloaded" });
  const row = staff.locator('[data-agent-id^="staff:review:"]').filter({ hasText: marker });
  const reviewId = (await row.getAttribute("data-agent-id"))!.replace("staff:review:", "");
  await staff.locator(`[data-agent-id="staff:review-hide:${reviewId}"]`).click();
  await fillAndSubmit(staff, { "staff:review-reason": "Personal details in the text" }, `staff:review-confirm-hide:${reviewId}`);
  await expect(staff.getByText("Review hidden.", { exact: true })).toBeVisible();

  await guest.goto(LAMP, { waitUntil: "domcontentloaded" });
  await expect(guest.locator('[data-agent-id="product:reviews"]')).not.toContainText(marker);

  await staff.goto("/en/staff/reviews?view=hidden", { waitUntil: "domcontentloaded" });
  await expect(staff.locator(`[data-agent-id="staff:review:${reviewId}"]`)).toContainText("Hidden: Personal details in the text");
  await staff.locator(`[data-agent-id="staff:review-restore:${reviewId}"]`).click();
  await expect(staff.getByText("Review restored.", { exact: true })).toBeVisible();
  await guest.goto(LAMP, { waitUntil: "domcontentloaded" });
  await expect(guest.locator('[data-agent-id="product:reviews"]')).toContainText(marker);
  await guest.context().close();
  await staff.context().close();
});
