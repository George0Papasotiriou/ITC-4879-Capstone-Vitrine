/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Tests for the shop's own address for a product photograph.
 */

import { describe, expect, it } from "vitest";

import { ABO_MEDIA_URL } from "@/lib/catalog/input";
import { sameOriginImage } from "@/lib/catalog/media-url";

describe("sameOriginImage", () => {
  it("sends a remote photograph through the shop's image optimizer", () => {
    expect(sameOriginImage("https://amazon-berkeley-objects.s3.amazonaws.com/images/original/14/14fe8812.jpg", 1080)).toBe(
      "/_next/image?url=https%3A%2F%2Famazon-berkeley-objects.s3.amazonaws.com%2Fimages%2Foriginal%2F14%2F14fe8812.jpg&w=1080&q=75",
    );
  });

  it("leaves the shop's own files as they are", () => {
    expect(sameOriginImage("/products/b07mbfd87n.webp", 1080)).toBe("/products/b07mbfd87n.webp");
    expect(sameOriginImage("/media/catalog/abo/x/y.webp", 828)).toBe("/media/catalog/abo/x/y.webp");
  });
});

describe("ABO_MEDIA_URL", () => {
  const bucket = "https://amazon-berkeley-objects.s3.amazonaws.com";

  it("accepts ABO's original photographs and turntable frames", () => {
    expect(ABO_MEDIA_URL.test(`${bucket}/images/original/14/14fe8812.jpg`)).toBe(true);
    expect(ABO_MEDIA_URL.test(`${bucket}/spins/original/0a/0a4f1ab2_18.jpg`)).toBe(true);
  });

  it("refuses other sizes, other files, other hosts and climbing out of the folder", () => {
    expect(ABO_MEDIA_URL.test(`${bucket}/images/small/14/14fe8812.jpg`)).toBe(false);
    expect(ABO_MEDIA_URL.test(`${bucket}/3dmodels/original/9/B075QFCHM9.glb`)).toBe(false);
    expect(ABO_MEDIA_URL.test(`${bucket}/images/original/../3dmodels/original/x.jpg`)).toBe(false);
    expect(ABO_MEDIA_URL.test("https://example.com/images/original/14/14fe8812.jpg")).toBe(false);
    expect(ABO_MEDIA_URL.test(`http://amazon-berkeley-objects.s3.amazonaws.com/images/original/14/14fe8812.jpg`)).toBe(false);
  });
});
