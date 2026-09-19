/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Server-side session and role checks: currentUser, requireUser, requireRole and authorize.
 */

import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";

import { auth } from "@/lib/auth/server";
import { can, parseRoles, type Permission, type Role } from "@/lib/auth/roles";

/**
 * The only way pages, server actions and route handlers learn who is asking.
 * Every check here runs on the server against the session in the database;
 * the proxy's cookie check is only a fast redirect for people who are plainly
 * signed out (CLAUDE.md: "auth checks there are optimistic only").
 */

export type CurrentUser = {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  roles: Role[];
  twoFactorEnabled: boolean;
  /** The session's id, so the account page can mark "this device". */
  sessionId: string;
};

export async function currentUser(): Promise<CurrentUser | null> {
  await connection();
  const session = await auth().api.getSession({ headers: await headers() });
  if (session === null) return null;
  const user = session.user as typeof session.user & { role?: string | null; twoFactorEnabled?: boolean | null };
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    emailVerified: user.emailVerified,
    roles: parseRoles(user.role),
    twoFactorEnabled: user.twoFactorEnabled === true,
    sessionId: session.session.id,
  };
}

/** Where to send someone who must sign in first, returning them here afterwards. */
export function signInPath(locale: string, returnTo: string): string {
  return `/${locale}/account/sign-in?next=${encodeURIComponent(returnTo)}`;
}

/** A signed-in person, or a redirect to sign in and come back. */
export async function requireUser(locale: string, returnTo: string): Promise<CurrentUser> {
  const user = await currentUser();
  if (user === null) redirect(signInPath(locale, returnTo));
  return user;
}

/**
 * A signed-in person with the permission, for staff pages. Someone without it
 * gets "not found" rather than "forbidden": a customer learns nothing about
 * which staff pages exist.
 */
export async function requirePermission(locale: string, returnTo: string, permission: Permission): Promise<CurrentUser> {
  const user = await requireUser(locale, returnTo);
  if (!can(user.roles, permission)) notFound();
  return user;
}

/** Plan name for the same check (docs/PLAN.md Phase 5): a role instead of a permission. */
export async function requireRole(locale: string, returnTo: string, ...roles: Role[]): Promise<CurrentUser> {
  const user = await requireUser(locale, returnTo);
  if (!user.roles.some((role) => roles.includes(role))) notFound();
  return user;
}

/** For route handlers: a typed answer instead of a redirect. */
export async function authorize(permission: Permission): Promise<{ ok: true; user: CurrentUser } | { ok: false; status: 401 | 403 }> {
  const user = await currentUser();
  if (user === null) return { ok: false, status: 401 };
  if (!can(user.roles, permission)) return { ok: false, status: 403 };
  return { ok: true, user };
}
