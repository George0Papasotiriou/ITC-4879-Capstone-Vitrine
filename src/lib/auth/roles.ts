/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Roles and what each may do: the single table every server-side authorization check reads.
 */

/**
 * Four roles (docs/PLAN.md 1.6, docs/adr/016). A person can hold several; Better
 * Auth stores them comma-joined in `users.role` ("support,merchandiser").
 *
 * - customer: shops, sees their own orders and reviews.
 * - support: works the order desk (pack, ship, deliver, refund) and moderates reviews.
 * - merchandiser: edits the catalogue and moderates reviews.
 * - admin: everything, including roles, bans and the email outbox.
 *
 * Authorization is always decided on the server from this table; what the
 * interface shows is a convenience, never the check (CLAUDE.md, proxy.ts).
 */

export const ROLES = ["customer", "support", "merchandiser", "admin"] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  "orders:own",
  "orders:manage",
  "reviews:moderate",
  "catalog:edit",
  "users:manage",
  "outbox:read",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

/** Who may do what. Read as: a role grants these permissions. */
export const GRANTS: Readonly<Record<Role, readonly Permission[]>> = {
  customer: ["orders:own"],
  support: ["orders:own", "orders:manage", "reviews:moderate"],
  merchandiser: ["orders:own", "reviews:moderate", "catalog:edit"],
  admin: PERMISSIONS,
};

export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

/**
 * The roles in a stored role string. Unknown names are dropped rather than
 * trusted: a typo in the database grants nothing. An empty result means
 * "customer", which is what Better Auth assigns on sign-up.
 */
export function parseRoles(stored: string | null | undefined): Role[] {
  const roles = (stored ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(isRole);
  return roles.length === 0 ? ["customer"] : [...new Set(roles)];
}

export function can(roles: readonly Role[], permission: Permission): boolean {
  return roles.some((role) => GRANTS[role].includes(permission));
}

/** Staff are the people who can see other customers' data. */
export function isStaff(roles: readonly Role[]): boolean {
  return roles.some((role) => role !== "customer");
}
