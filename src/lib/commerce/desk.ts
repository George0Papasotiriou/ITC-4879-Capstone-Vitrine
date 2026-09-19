/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * The staff order desk's views: which orders each queue holds and in what order they are worked.
 */

import { availableEvents, type OrderEventType, type OrderSnapshot, type OrderStatus } from "@/lib/commerce/order-state";

/**
 * The order desk (docs/PLAN.md Phase 5, docs/adr/016) is organised as queues of
 * work rather than one long table: each view is the orders waiting for the same
 * next step. Queues are worked oldest first, so nobody's parcel waits behind
 * newer ones; the "all" view is a lookup and shows the newest first.
 */
export const DESK_VIEWS = ["pack", "ship", "transit", "returns", "unpaid", "closed", "all"] as const;
export type DeskView = (typeof DESK_VIEWS)[number];

export const DESK_STATUSES: Readonly<Record<DeskView, readonly OrderStatus[] | null>> = {
  pack: ["paid"],
  ship: ["packed"],
  transit: ["shipped"],
  returns: ["return_requested"],
  unpaid: ["pending_payment"],
  closed: ["delivered", "cancelled", "refunded", "returned"],
  all: null,
};

export function isDeskView(value: string | undefined): value is DeskView {
  return value !== undefined && (DESK_VIEWS as readonly string[]).includes(value);
}

/** Work queues oldest first; the lookup views newest first. */
export function oldestFirst(view: DeskView): boolean {
  return view === "pack" || view === "ship" || view === "transit" || view === "returns";
}

/** How many orders each view holds, from a count per status. */
export function viewCounts(byStatus: Partial<Record<OrderStatus, number>>): Record<DeskView, number> {
  const total = (statuses: readonly OrderStatus[] | null) =>
    statuses === null ? Object.values(byStatus).reduce((sum, count) => sum + (count ?? 0), 0) : statuses.reduce((sum, status) => sum + (byStatus[status] ?? 0), 0);
  return Object.fromEntries(DESK_VIEWS.map((view) => [view, total(DESK_STATUSES[view])])) as Record<DeskView, number>;
}

/**
 * What staff may do to an order now: the state machine's answer for the staff
 * actor, in the order a person would do them. Cancelling and refunding are
 * listed last because they are the ones to think twice about.
 */
const ORDER: readonly OrderEventType[] = ["pack", "ship", "deliver", "request_return", "receive_return", "refund", "cancel"];

export function staffActions(order: OrderSnapshot, now: Date): OrderEventType[] {
  const available = availableEvents(order, "staff", now);
  return ORDER.filter((event) => available.includes(event));
}

/** The actions that cannot be undone and must carry a reason in the order's history. */
export function needsReason(event: OrderEventType): boolean {
  return event === "cancel" || event === "refund";
}
