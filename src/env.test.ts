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

  it("refuses the AI pictures' test stand-in in production, and reads the old drawn previews as off (docs/adr/060)", () => {
    const production = { ...base, ...s3, ...cookieSecret, NODE_ENV: "production", REDIS_URL: "redis://redis.internal:6379" };
    const fixture = parseEnvironment({ ...production, PICTURES_PROVIDER: "fixture" });
    expect(fixture.success).toBe(false);
    expect(JSON.stringify(fixture.error?.issues)).toContain("PICTURES_PROVIDER=fixture");
    // A deployment that still says "drawn" starts, with no picture made.
    const drawn = parseEnvironment({ ...production, PICTURES_PROVIDER: "drawn" });
    expect(drawn.success && drawn.data.PICTURES_PROVIDER).toBe("off");
    const unset = parseEnvironment(production);
    expect(unset.success && unset.data.PICTURES_PROVIDER).toBe("off");
    expect(unset.success && unset.data.PICTURES_MODEL).toBe("pro");
    // The local stack may use it, as it uses the other stand-ins.
    expect(parseEnvironment({ ...base, ...localSecret, PICTURES_PROVIDER: "fixture" }).success).toBe(true);
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

  it("picks the AI mode: Gemini with a key, the demo locally, off in a deployment without a key (docs/adr/019)", () => {
    const production = { ...base, ...s3, ...cookieSecret, NODE_ENV: "production", REDIS_URL: "redis://redis.internal:6379" };
    expect(parseEnvironment({ ...base, ...localSecret }).data?.aiMode).toBe("demo");
    expect(parseEnvironment(production).data?.aiMode).toBe("off");
    expect(parseEnvironment({ ...production, GOOGLE_GENERATIVE_AI_API_KEY: "key" }).data?.aiMode).toBe("google");
    expect(parseEnvironment({ ...production, AI_PROVIDER: "demo" }).data?.aiMode).toBe("demo");
    // Asking for Gemini without its key is a configuration error, not a silent fallback.
    expect(parseEnvironment({ ...base, ...localSecret, AI_PROVIDER: "google" }).success).toBe(false);
    expect(parseEnvironment({ ...base, ...localSecret, AI_KILL_SWITCH: "1" }).data?.AI_KILL_SWITCH).toBe(true);
    expect(parseEnvironment({ ...base, ...localSecret }).data?.AI_DAILY_BUDGET_EUR).toBe(3);
  });
});

describe("the local stack and the deployment that carries its flag (2026-09-29)", () => {
  it("is the local stack only on this machine's address, never on a deployment's", () => {
    expect(parseEnvironment({ ...base, ...localSecret, VITRINE_LOCAL: "1" }).data?.localStack).toBe(true);
    const deployed = parseEnvironment({ ...base, ...localSecret, ...cookieSecret, NODE_ENV: "production", VITRINE_LOCAL: "1", APP_URL: "https://shop.up.railway.app" });
    expect(deployed.success).toBe(true);
    expect(deployed.data?.localStack).toBe(false);
  });

  it("marks cookies Secure whenever the shop is served over https", () => {
    expect(parseEnvironment({ ...base, ...localSecret, ...cookieSecret, NODE_ENV: "production", VITRINE_LOCAL: "1", APP_URL: "https://shop.up.railway.app" }).data?.secureCookies).toBe(true);
    expect(parseEnvironment({ ...base, ...localSecret }).data?.secureCookies).toBe(false);
  });
});

describe("Stripe (docs/adr/038)", () => {
  const stripe = { STRIPE_SECRET_KEY: "sk_test_abc", STRIPE_PUBLISHABLE_KEY: "pk_test_abc", STRIPE_WEBHOOK_SECRET: "whsec_abc" };

  it("pays with Stripe when all three keys are set, and with the local test payment otherwise", () => {
    expect(parseEnvironment({ ...base, ...localSecret, ...stripe }).data?.paymentProvider).toBe("stripe");
    expect(parseEnvironment({ ...base, ...localSecret }).data?.paymentProvider).toBe("local_test");
  });

  it("takes the three keys together or not at all", () => {
    expect(parseEnvironment({ ...base, ...localSecret, STRIPE_SECRET_KEY: "sk_test_abc" }).success).toBe(false);
  });

  it("refuses live keys: this shop never takes real money", () => {
    expect(parseEnvironment({ ...base, ...localSecret, ...stripe, STRIPE_SECRET_KEY: "sk_live_abc" }).success).toBe(false);
    expect(parseEnvironment({ ...base, ...localSecret, ...stripe, STRIPE_PUBLISHABLE_KEY: "pk_live_abc" }).success).toBe(false);
  });
});

describe("Web Push (docs/adr/044)", () => {
  const vapid = { VAPID_PUBLIC_KEY: `B${"a".repeat(86)}`, VAPID_PRIVATE_KEY: "k".repeat(43), VAPID_SUBJECT: "mailto:shop@example.com" };

  it("offers notifications only when the three VAPID variables are set", () => {
    expect(parseEnvironment({ ...base, ...localSecret, ...vapid }).data?.vapid).toEqual({ publicKey: vapid.VAPID_PUBLIC_KEY, privateKey: vapid.VAPID_PRIVATE_KEY, subject: "mailto:shop@example.com" });
    expect(parseEnvironment({ ...base, ...localSecret }).data?.vapid).toBeNull();
    expect(parseEnvironment({ ...base, ...localSecret, VAPID_PUBLIC_KEY: vapid.VAPID_PUBLIC_KEY }).success).toBe(false);
  });

  it("refuses keys of the wrong shape and a subject push services cannot use", () => {
    expect(parseEnvironment({ ...base, ...localSecret, ...vapid, VAPID_PRIVATE_KEY: "short" }).success).toBe(false);
    expect(parseEnvironment({ ...base, ...localSecret, ...vapid, VAPID_SUBJECT: "shop@example.com" }).success).toBe(false);
    expect(parseEnvironment({ ...base, ...localSecret, ...vapid, VAPID_SUBJECT: "https://vitrine.example/contact" }).success).toBe(true);
  });
});
