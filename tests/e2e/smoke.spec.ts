/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Fast smoke tests for health and core pages.
 */

import { expect, test } from "@playwright/test";

/**
 * @smoke tests are the ones `/verify` runs after every change. They must be
 * fast, independent of seed data, and honest about failure.
 */

type Health = {
  status: string;
  requestId: string | null;
  components: Record<string, { status: "ok" | "error" | "skipped"; detail?: string; driver?: string }>;
};

test("@smoke the home page renders", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page).toHaveTitle(/Vitrine/);
});

test("@smoke no health component reports an error", async ({ request }) => {
  const response = await request.get("/api/health");
  const body = (await response.json()) as Health;

  // Name the failing component, rather than only that the status was 503.
  const failing = Object.entries(body.components)
    .filter(([, component]) => component.status === "error")
    .map(([name, component]) => `${name}: ${component.detail ?? "unknown"}`);

  expect(failing, `unhealthy components -> ${failing.join("; ")}`).toEqual([]);
  expect(response.status()).toBe(200);
  expect(body.status).toBe("ok");

  // The database is never optional, whichever drivers are selected.
  expect(body.components["database"]?.status).toBe("ok");
});

test("@smoke the health check carries the request id it was served with", async ({ request }) => {
  const response = await request.get("/api/health");
  const body = (await response.json()) as Health;
  expect(body.requestId).toBe(response.headers()["x-request-id"]);
});
