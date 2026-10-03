/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Tests for room boards' links and roles: who may look, who may change, and new links retiring old ones.
 */

import { describe, expect, it } from "vitest";

import { boardHref, boardLinkToken, canEdit, roleFor } from "@/lib/boards/boards";

const SECRET = "s".repeat(32);
const board = { id: "01890000-0000-7000-8000-0000000000b1", ownerKey: "user:owner", linkVersion: 1 };

describe("room board links (docs/adr/056)", () => {
  it("knows the owner by who they are, and everyone else by the link they came with", () => {
    expect(roleFor(board, { actorKey: "user:owner", token: null }, SECRET)).toBe("owner");
    expect(roleFor(board, { actorKey: "guest:friend", token: boardLinkToken(board.id, "edit", 1, SECRET) }, SECRET)).toBe("editor");
    expect(roleFor(board, { actorKey: null, token: boardLinkToken(board.id, "view", 1, SECRET) }, SECRET)).toBe("viewer");
    expect(roleFor(board, { actorKey: "guest:stranger", token: null }, SECRET)).toBeNull();
  });

  it("refuses a link for another board, another secret, a made-up token, or a retired version", () => {
    expect(roleFor(board, { actorKey: null, token: boardLinkToken("01890000-0000-7000-8000-0000000000b2", "edit", 1, SECRET) }, SECRET)).toBeNull();
    expect(roleFor(board, { actorKey: null, token: boardLinkToken(board.id, "edit", 1, "t".repeat(32)) }, SECRET)).toBeNull();
    expect(roleFor(board, { actorKey: null, token: "x".repeat(32) }, SECRET)).toBeNull();
    expect(roleFor(board, { actorKey: null, token: "short" }, SECRET)).toBeNull();
    // "New links": the version moves on and the old edit link stops working.
    expect(roleFor({ ...board, linkVersion: 2 }, { actorKey: null, token: boardLinkToken(board.id, "edit", 1, SECRET) }, SECRET)).toBeNull();
  });

  it("makes view and edit links that differ, and pages that carry them", () => {
    const view = boardLinkToken(board.id, "view", 1, SECRET);
    const edit = boardLinkToken(board.id, "edit", 1, SECRET);
    expect(view).not.toBe(edit);
    expect(view).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(boardHref(board.id, view)).toBe(`/b/${board.id}?k=${view}`);
    expect([canEdit("owner"), canEdit("editor"), canEdit("viewer"), canEdit(null)]).toEqual([true, true, false, false]);
  });
});
