/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * End-to-end checks of the job queue and signed storage paths.
 */

import { readFileSync } from "node:fs";

import { expect, test } from "@playwright/test";

import { E2E_PING_TOKEN } from "../../playwright.config";
import { sign } from "../../src/lib/storage/signing";

/**
 * The paths through the infrastructure, exercised over HTTP (ADR-008).
 *
 * A green health check proves the components answer. These prove work actually
 * flows through them: a request enqueues a job and the job runs; a signed URL
 * stores a file and a signed URL reads it back; and the storage route refuses
 * everything that is not exactly what was signed.
 *
 * They run against the local stack. Against a deployment (BASE_URL set) the
 * storage tests are skipped, because the bucket is reached directly and the
 * local signing secret does not exist there.
 */

const LOCAL = process.env.BASE_URL === undefined;

test.describe("jobs", () => {
  test("@smoke a request enqueues a job and the job runs", async ({ request }) => {
    const before = await request.get("/api/health").then((r) => r.json());
    const succeededBefore: number = before.components.worker.succeeded ?? 0;

    const enqueued = await request.post("/api/dev/ping", {
      headers: { "x-vitrine-dev-token": E2E_PING_TOKEN },
    });
    expect(enqueued.status()).toBe(202);
    expect((await enqueued.json()).jobId).toBeTruthy();

    await expect
      .poll(async () => (await request.get("/api/health").then((r) => r.json())).components.worker.succeeded, {
        timeout: 10_000,
      })
      .toBeGreaterThan(succeededBefore);
  });

  test("the enqueue route refuses a request without the token", async ({ request }) => {
    const response = await request.post("/api/dev/ping");
    // 404, not 401: an unauthenticated caller learns nothing about the route.
    expect(response.status()).toBe(404);
  });
});

test.describe("local storage", () => {
  test.skip(!LOCAL, "The local storage route only exists on the local stack.");

  const secret = () => readFileSync(".local/storage-secret", "utf8").trim();
  const key = `e2e/${Date.now()}/photo.webp`;
  const contentType = "image/webp";
  const bytes = Buffer.from("RIFF....WEBPVP8 fake image bytes for the round trip");

  function signedUrl(method: "GET" | "PUT", options: { key?: string; expires?: number; ct?: string } = {}) {
    const k = options.key ?? key;
    const expires = options.expires ?? Math.floor(Date.now() / 1000) + 300;
    const ct = options.ct ?? contentType;
    const signature =
      method === "PUT"
        ? sign({ method, key: k, expires, contentType: ct }, secret())
        : sign({ method, key: k, expires }, secret());
    const params = new URLSearchParams({ expires: String(expires), sig: signature });
    if (method === "PUT") params.set("ct", ct);
    return `/api/storage/${k}?${params.toString()}`;
  }

  test("@smoke a signed upload is stored and a signed read returns the same bytes", async ({ request }) => {
    const put = await request.put(signedUrl("PUT"), { data: bytes, headers: { "content-type": contentType } });
    expect(put.status()).toBe(204);

    const get = await request.get(signedUrl("GET"));
    expect(get.status()).toBe(200);
    expect(get.headers()["content-type"]).toBe(contentType);
    expect(get.headers()["cache-control"]).toContain("no-store");
    expect(Buffer.from(await get.body()).equals(bytes)).toBe(true);
  });

  test("an unsigned or tampered read is refused", async ({ request }) => {
    expect((await request.get(`/api/storage/${key}`)).status()).toBe(403);

    const tampered = signedUrl("GET").replace(/sig=([^&]+)/, (_, sig: string) => `sig=${sig.slice(0, -2)}xx`);
    expect((await request.get(tampered)).status()).toBe(403);
  });

  test("an expired URL is refused", async ({ request }) => {
    const expired = signedUrl("GET", { expires: Math.floor(Date.now() / 1000) - 5 });
    expect((await request.get(expired)).status()).toBe(403);
  });

  test("an upload sent with a different content type than was signed is refused", async ({ request }) => {
    const response = await request.put(signedUrl("PUT", { key: `e2e/${Date.now()}/x.webp` }), {
      data: "<script>alert(1)</script>",
      headers: { "content-type": "text/html" },
    });
    expect(response.status()).toBe(403);
  });

  test("a read signature cannot be used to upload", async ({ request }) => {
    const readUrl = signedUrl("GET", { key: `e2e/${Date.now()}/y.webp` });
    const response = await request.put(readUrl, { data: bytes, headers: { "content-type": contentType } });
    expect(response.status()).toBe(403);
  });

  test("path traversal cannot reach files outside storage, even when signed", async ({ request }) => {
    // Signed with the real secret: the key itself must be refused.
    const response = await request.get(signedUrl("GET", { key: "..%2F..%2Fpackage.json" }));
    expect([403, 404]).toContain(response.status());
    expect(await response.text()).not.toContain('"name": "vitrine"');
  });
});
