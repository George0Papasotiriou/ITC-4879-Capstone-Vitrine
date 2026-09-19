/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * The shop's roles expressed in Better Auth's access control, for its admin endpoints.
 */

import { createAccessControl } from "better-auth/plugins/access";
import { adminAc, defaultStatements } from "better-auth/plugins/admin/access";

/**
 * Better Auth's admin plugin guards its own endpoints (list users, change a
 * role, ban, impersonate) with an access-control table of its own. This maps
 * the shop's four roles onto it: only admins manage people; support may look a
 * customer up, which the order desk needs; nobody else touches accounts.
 * Shared by the server and the client plugin, which must agree.
 */
export const ac = createAccessControl(defaultStatements);

export const authRoles = {
  customer: ac.newRole({ user: [], session: [] }),
  support: ac.newRole({ user: ["list", "get"], session: [] }),
  merchandiser: ac.newRole({ user: [], session: [] }),
  admin: ac.newRole(adminAc.statements),
};
