/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * The staff desks and the permission each needs, listed once for the account page and the staff hub.
 */

import { can, type Permission, type Role } from "@/lib/auth/roles";

export type StaffDesk = {
  key: "orders" | "support" | "reviews" | "products" | "dashboard" | "ai" | "audit";
  href: string;
  permission: Permission;
  /** The Concierge's handle on the link (CLAUDE.md conventions). */
  agentId: string;
};

export const STAFF_DESKS: readonly StaffDesk[] = [
  { key: "orders", href: "/staff/orders", permission: "orders:manage", agentId: "action:open-order-desk" },
  { key: "support", href: "/staff/support", permission: "support:work", agentId: "action:open-support-desk" },
  { key: "reviews", href: "/staff/reviews", permission: "reviews:moderate", agentId: "action:open-review-desk" },
  { key: "products", href: "/staff/products", permission: "catalog:edit", agentId: "action:open-products" },
  { key: "dashboard", href: "/admin", permission: "reports:read", agentId: "action:open-dashboard" },
  { key: "ai", href: "/admin/ai", permission: "reports:read", agentId: "action:open-ai" },
  { key: "audit", href: "/admin/audit", permission: "audit:read", agentId: "action:open-audit" },
];

/** The desks these roles may open, in a stable order. */
export function desksFor(roles: readonly Role[]): StaffDesk[] {
  return STAFF_DESKS.filter((desk) => can(roles, desk.permission));
}
