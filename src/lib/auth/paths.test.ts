/**
 * Vitrine — AI-native e-shop (ITC 4879 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Tests for the post-sign-in redirect guard and the device description.
 */

import { describe, expect, it } from "vitest";

import { describeDevice, safeNext } from "@/lib/auth/paths";

describe("safeNext", () => {
  it("returns to a page on this site, keeping its query and hash", () => {
    expect(safeNext("/el/checkout", "el")).toBe("/el/checkout");
    expect(safeNext("/en/orders/abc?t=1#items", "en")).toBe("/en/orders/abc?t=1#items");
  });

  it("falls back to the account page for anything that could leave the site", () => {
    for (const hostile of [
      "https://evil.example/",
      "//evil.example/",
      "/\\evil.example",
      "\\\\evil.example",
      "javascript:alert(1)",
      "/%0d%0aSet-Cookie:x",
      `/${String.fromCharCode(0)}x`,
      "evil.example",
      "",
      null,
      undefined,
    ]) {
      const result = safeNext(hostile, "en");
      expect(result.startsWith("/") && !result.startsWith("//")).toBe(true);
      if (hostile !== "/%0d%0aSet-Cookie:x") expect(result).toBe("/en/account");
    }
  });
});

describe("describeDevice", () => {
  it("names the browser and system people would recognise", () => {
    expect(
      describeDevice("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36"),
    ).toEqual({ browser: "Chrome", system: "Windows" });
    expect(
      describeDevice("Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1"),
    ).toEqual({ browser: "Safari", system: "iOS" });
    expect(
      describeDevice("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0"),
    ).toEqual({ browser: "Edge", system: "Windows" });
    expect(describeDevice("Mozilla/5.0 (Android 15; Mobile; rv:140.0) Gecko/140.0 Firefox/140.0")).toEqual({ browser: "Firefox", system: "Android" });
    expect(describeDevice("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15")).toEqual({
      browser: "Safari",
      system: "macOS",
    });
  });

  it("admits when it cannot tell", () => {
    expect(describeDevice(null)).toEqual({ browser: null, system: null });
    expect(describeDevice("curl/8.9.1")).toEqual({ browser: null, system: null });
  });
});
