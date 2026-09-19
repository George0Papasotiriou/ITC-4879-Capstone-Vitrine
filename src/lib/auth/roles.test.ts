/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * The role matrix: every role against every permission, and how stored role strings are read.
 */

import { describe, expect, it } from "vitest";

import { can, isStaff, parseRoles, PERMISSIONS, ROLES, withoutRole, withRole, type Permission, type Role } from "@/lib/auth/roles";

/**
 * docs/PLAN.md Phase 5 asks for a role-matrix test. The expected table is
 * written out in full here rather than derived from GRANTS, so a change to who
 * may do what has to be made twice, deliberately.
 */
const EXPECTED: Record<Role, Record<Permission, boolean>> = {
  customer: { "orders:own": true, "orders:manage": false, "reviews:moderate": false, "catalog:edit": false, "users:manage": false, "outbox:read": false, "reports:read": false, "audit:read": false },
  support: { "orders:own": true, "orders:manage": true, "reviews:moderate": true, "catalog:edit": false, "users:manage": false, "outbox:read": false, "reports:read": false, "audit:read": false },
  merchandiser: { "orders:own": true, "orders:manage": false, "reviews:moderate": true, "catalog:edit": true, "users:manage": false, "outbox:read": false, "reports:read": true, "audit:read": false },
  admin: { "orders:own": true, "orders:manage": true, "reviews:moderate": true, "catalog:edit": true, "users:manage": true, "outbox:read": true, "reports:read": true, "audit:read": true },
};

describe("role matrix", () => {
  for (const role of ROLES) {
    for (const permission of PERMISSIONS) {
      it(`${role} ${EXPECTED[role][permission] ? "may" : "may not"} ${permission}`, () => {
        expect(can([role], permission)).toBe(EXPECTED[role][permission]);
      });
    }
  }

  it("combines the permissions of several roles", () => {
    expect(can(["support", "merchandiser"], "catalog:edit")).toBe(true);
    expect(can(["support", "merchandiser"], "orders:manage")).toBe(true);
    expect(can(["support", "merchandiser"], "users:manage")).toBe(false);
  });
});

describe("parseRoles", () => {
  it("reads Better Auth's comma-joined roles", () => {
    expect(parseRoles("support,merchandiser")).toEqual(["support", "merchandiser"]);
    expect(parseRoles(" admin ")).toEqual(["admin"]);
  });

  it("grants nothing for a name it does not know, and treats no role as a customer", () => {
    expect(parseRoles("root")).toEqual(["customer"]);
    expect(parseRoles("admin,root")).toEqual(["admin"]);
    expect(parseRoles("")).toEqual(["customer"]);
    expect(parseRoles(null)).toEqual(["customer"]);
  });

  it("adds and removes a role, keeping the stored string tidy", () => {
    expect(withRole("customer", "admin")).toBe("admin");
    expect(withRole("support", "merchandiser")).toBe("support,merchandiser");
    expect(withRole("merchandiser,support", "support")).toBe("support,merchandiser");
    expect(withRole(null, "support")).toBe("support");
    expect(withoutRole("support,merchandiser", "support")).toBe("merchandiser");
    expect(withoutRole("admin", "admin")).toBe("customer");
    expect(withoutRole("customer", "admin")).toBe("customer");
  });

  it("tells staff from customers", () => {
    expect(isStaff(["customer"])).toBe(false);
    expect(isStaff(["customer", "support"])).toBe(true);
  });
});
