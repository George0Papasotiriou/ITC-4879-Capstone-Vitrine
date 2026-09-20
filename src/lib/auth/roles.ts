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
 * - merchandiser: edits the catalogue, moderates reviews, reads the dashboards.
 * - admin: everything, including roles, bans, the email outbox and the audit log.
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
  /** Dashboards and CSV exports (docs/adr/018). */
  "reports:read",
  /** Who changed what: the audit log. */
  "audit:read",
  /** The AI's switches: the kill switch and the daily budget (docs/adr/020). */
  "ai:manage",
  /** Building the weekly report out of turn, which emails every admin a link to it. */
  "reports:generate",
  /** The support desk: reading other people's tickets and answering them (docs/adr/021). */
  "support:work",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

/** Who may do what. Read as: a role grants these permissions. */
export const GRANTS: Readonly<Record<Role, readonly Permission[]>> = {
  customer: ["orders:own"],
  support: ["orders:own", "orders:manage", "reviews:moderate", "support:work"],
  merchandiser: ["orders:own", "reviews:moderate", "catalog:edit", "reports:read"],
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

/**
 * A stored role string with one role added or removed, in the order of ROLES
 * and without duplicates: what `pnpm accounts grant` and ADMIN_EMAILS write.
 * Removing the last role leaves "customer", never an empty string.
 */
export function withRole(stored: string | null | undefined, role: Role): string {
  const roles = new Set<Role>(parseRoles(stored));
  roles.add(role);
  if (role !== "customer" && roles.size > 1) roles.delete("customer");
  return ROLES.filter((known) => roles.has(known)).join(",");
}

export function withoutRole(stored: string | null | undefined, role: Role): string {
  const roles = parseRoles(stored).filter((known) => known !== role);
  return roles.length === 0 ? "customer" : ROLES.filter((known) => roles.includes(known)).join(",");
}

/** Staff are the people who can see other customers' data. */
export function isStaff(roles: readonly Role[]): boolean {
  return roles.some((role) => role !== "customer");
}
