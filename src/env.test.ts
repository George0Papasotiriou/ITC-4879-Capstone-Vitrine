/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Unit tests for the environment variable contract.
 */

import { describe, expect, it } from "vitest";

import { parseEnvironment } from "@/env";

/**
 * The environment contract decides which infrastructure the app believes it
 * has. Getting it wrong in production is silent and expensive — jobs running
 * inside the web server, customer photos written to a disk that vanishes on the
 * next deploy — so the guard against that is tested here, not just written.
 */

const base = {
  APP_URL: "http://localhost:3000",
  DATABASE_URL: "postgres://postgres:postgres@127.0.0.1:5433/postgres",
};
const localSecret = { LOCAL_STORAGE_SECRET: "x".repeat(32) };
// Production needs both signing secrets; tests about one of them remove it explicitly.
const cookieSecret = { COOKIE_SECRET: "c".repeat(32), BETTER_AUTH_SECRET: "a".repeat(32) };
const s3 = {
  S3_ENDPOINT: "https://bucket.example.com",
  S3_BUCKET: "vitrine",
  S3_ACCESS_KEY_ID: "id",
  S3_SECRET_ACCESS_KEY: "secret",
};

describe("driver selection", () => {
  it("uses the local stand-ins when no Redis or bucket is configured", () => {
    const result = parseEnvironment({ ...base, ...localSecret });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.jobsDriver).toBe("inline");
      expect(result.data.storageDriver).toBe("local");
    }
  });

  it("infers the production drivers from their credentials", () => {
    const result = parseEnvironment({ ...base, ...s3, REDIS_URL: "redis://127.0.0.1:6379" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.jobsDriver).toBe("bullmq");
      expect(result.data.storageDriver).toBe("s3");
    }
  });

  it("treats an empty value as unset, the way hosts often pass blanks", () => {
    const result = parseEnvironment({ ...base, ...localSecret, REDIS_URL: "", S3_ENDPOINT: "" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.jobsDriver).toBe("inline");
  });
});

describe("required only when the driver needs it", () => {
  it("requires REDIS_URL for bullmq", () => {
    const result = parseEnvironment({ ...base, ...localSecret, JOBS_DRIVER: "bullmq" });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain("REDIS_URL");
  });

  it("requires every S3 credential for the s3 driver", () => {
    const result = parseEnvironment({ ...base, STORAGE_DRIVER: "s3", S3_ENDPOINT: "https://b.example.com" });
    expect(result.success).toBe(false);
    const paths = result.error?.issues.map((issue) => issue.path.join(".")) ?? [];
    expect(paths).toEqual(expect.arrayContaining(["S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"]));
  });

  it("requires a signing secret of at least 32 characters for local storage", () => {
    expect(parseEnvironment({ ...base }).success).toBe(false);
    expect(parseEnvironment({ ...base, LOCAL_STORAGE_SECRET: "short" }).success).toBe(false);
  });
});

describe("the production guard", () => {
  it("refuses the local stand-ins in production", () => {
    const result = parseEnvironment({ ...base, ...localSecret, NODE_ENV: "production" });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain("refused in production");
  });

  it("refuses even one stand-in: real Redis does not excuse local file storage", () => {
    const result = parseEnvironment({
      ...base,
      ...localSecret,
      NODE_ENV: "production",
      REDIS_URL: "redis://127.0.0.1:6379",
    });
    expect(result.success).toBe(false);
  });

  it("allows them when the process declares itself the local stack", () => {
    // `next start` sets NODE_ENV=production, so the local end-to-end run needs this.
    const result = parseEnvironment({ ...base, ...localSecret, ...cookieSecret, NODE_ENV: "production", VITRINE_LOCAL: "1" });
    expect(result.success).toBe(true);
  });

  it("accepts a real production configuration", () => {
    const result = parseEnvironment({
      ...base,
      ...s3,
      ...cookieSecret,
      NODE_ENV: "production",
      REDIS_URL: "redis://redis.internal:6379",
    });
    expect(result.success).toBe(true);
  });

  it("requires a cookie secret of at least 32 characters in production, not in development", () => {
    const production = { ...base, ...s3, NODE_ENV: "production", REDIS_URL: "redis://redis.internal:6379" };
    const missing = parseEnvironment(production);
    expect(missing.success).toBe(false);
    expect(missing.error?.issues.map((issue) => issue.path.join("."))).toContain("COOKIE_SECRET");
    expect(parseEnvironment({ ...production, COOKIE_SECRET: "short" }).success).toBe(false);
    expect(parseEnvironment({ ...base, ...localSecret }).success).toBe(true);
  });

  it("requires an auth secret of at least 32 characters in production (docs/adr/016)", () => {
    const production = { ...base, ...s3, NODE_ENV: "production", REDIS_URL: "redis://redis.internal:6379", COOKIE_SECRET: "c".repeat(32) };
    const missing = parseEnvironment(production);
    expect(missing.error?.issues.map((issue) => issue.path.join("."))).toEqual(["BETTER_AUTH_SECRET"]);
    expect(parseEnvironment({ ...production, BETTER_AUTH_SECRET: "short" }).success).toBe(false);
    expect(parseEnvironment({ ...production, BETTER_AUTH_SECRET: "a".repeat(32) }).success).toBe(true);
  });

  it("takes Google sign-in credentials as a pair or not at all", () => {
    expect(parseEnvironment({ ...base, ...localSecret, GOOGLE_CLIENT_ID: "id" }).success).toBe(false);
    expect(parseEnvironment({ ...base, ...localSecret, GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "secret" }).success).toBe(true);
  });
});
