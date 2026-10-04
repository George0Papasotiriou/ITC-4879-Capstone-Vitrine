/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Environment contract: declares and validates every environment variable the app reads.
 */

import { z } from "zod";

import { isLocalStack, servesHttps } from "@/lib/local-stack";

/**
 * Environment contract.
 *
 * Every variable the application reads is declared and validated here, once, at
 * startup. Nothing else in the codebase touches `process.env` directly, so a
 * missing or malformed variable fails loudly on boot instead of producing a
 * confusing runtime error three layers deep.
 *
 * `.env.example` mirrors the names below without values. The app itself never
 * reads a `.env` file: locally, `pnpm local` passes the environment to the
 * processes it starts; in production, the host provides it.
 *
 * Drivers (ADR-008). Jobs and file storage each have a production driver and a
 * local stand-in:
 *
 * | Concern | Production        | Local stand-in                         |
 * |---------|-------------------|----------------------------------------|
 * | Jobs    | `bullmq` (Redis)  | `inline`: processors run in-process    |
 * | Storage | `s3` (bucket)     | `local`: files on disk, signed URLs    |
 *
 * A driver is chosen explicitly, or inferred from which credentials are present.
 * Only the variables the chosen driver needs are required — so a laptop with no
 * Redis does not have to pretend to have one. The stand-ins are refused in
 * production unless `VITRINE_LOCAL=1` says the process is the local stack, so a
 * misconfigured deployment cannot silently run jobs inside the web server or
 * write customer uploads to an ephemeral disk.
 */

const optionalString = z
  .string()
  .optional()
  .transform((value) => (value === "" ? undefined : value));

const rawSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  /** Public base URL, no trailing slash. */
  APP_URL: z.url(),

  /** PostgreSQL with pgvector. Locally, the PGlite server started by `pnpm local`. */
  DATABASE_URL: z.string().min(1),

  /** Marks the local stack, which is allowed to use the stand-in drivers. */
  VITRINE_LOCAL: z
    .enum(["0", "1"])
    .optional()
    .transform((value) => value === "1"),

  JOBS_DRIVER: z.enum(["bullmq", "inline"]).optional(),
  /** Redis for BullMQ, rate limits and caches. Required by the `bullmq` driver. */
  REDIS_URL: optionalString,

  STORAGE_DRIVER: z.enum(["s3", "local"]).optional(),
  /** S3-compatible bucket. Required by the `s3` driver. */
  S3_ENDPOINT: optionalString.pipe(z.url().optional()),
  S3_REGION: z.string().min(1).default("auto"),
  S3_BUCKET: optionalString,
  S3_ACCESS_KEY_ID: optionalString,
  S3_SECRET_ACCESS_KEY: optionalString,
  /**
   * `1` for providers that need path-style addresses (MinIO, Railway buckets
   * made before it switched). Railway's new buckets, AWS and R2 use the
   * virtual-hosted style, the default.
   */
  S3_FORCE_PATH_STYLE: z
    .enum(["0", "1"])
    .optional()
    .transform((value) => value === "1"),
  /** Where the `local` storage driver keeps files. */
  LOCAL_STORAGE_DIR: z.string().min(1).default(".local/storage"),
  /** Signs local storage URLs. Required by the `local` driver. */
  LOCAL_STORAGE_SECRET: optionalString.pipe(z.string().min(32).optional()),

  /**
   * Signs the guest cart cookie and guest order links (Phase 5). Required in
   * production; `pnpm local` generates one. Rotating it empties guest carts.
   */
  COOKIE_SECRET: optionalString.pipe(z.string().min(32).optional()),

  /**
   * Accounts (docs/adr/016). BETTER_AUTH_SECRET signs and encrypts sessions,
   * two-factor secrets and verification tokens: required in production, and
   * `pnpm local` generates one. Rotating it signs everyone out.
   * GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET turn on "Continue with Google";
   * both or neither.
   */
  BETTER_AUTH_SECRET: optionalString.pipe(z.string().min(32).optional()),
  GOOGLE_CLIENT_ID: optionalString,
  GOOGLE_CLIENT_SECRET: optionalString,

  /**
   * Stripe in test mode (docs/adr/038): all three or none. Without them the
   * local test payment stands in. Live keys are refused: this shop must never
   * take real money.
   */
  STRIPE_SECRET_KEY: optionalString.pipe(z.string().startsWith("sk_test_", "Only a Stripe test key (sk_test_…) is accepted.").optional()),
  STRIPE_PUBLISHABLE_KEY: optionalString.pipe(z.string().startsWith("pk_test_", "Only a Stripe test key (pk_test_…) is accepted.").optional()),
  STRIPE_WEBHOOK_SECRET: optionalString.pipe(z.string().startsWith("whsec_", "The webhook's signing secret starts with whsec_.").optional()),
  /** The Content Security Policy (docs/adr/046): enforced by default; "report" only reports, "off" sends none. */
  CSP_MODE: optionalString.pipe(z.enum(["enforce", "report", "off"]).optional()),
  /** Web Push (docs/adr/044): the shop's VAPID key pair, from `pnpm push keys`, and a contact for the push services. All three or none. */
  VAPID_PUBLIC_KEY: optionalString.pipe(z.string().regex(/^[A-Za-z0-9_-]{87}$/, "The VAPID public key is 87 base64url characters (a P-256 point); make one with pnpm push keys.").optional()),
  VAPID_PRIVATE_KEY: optionalString.pipe(z.string().regex(/^[A-Za-z0-9_-]{43}$/, "The VAPID private key is 43 base64url characters; make one with pnpm push keys.").optional()),
  VAPID_SUBJECT: optionalString.pipe(z.string().regex(/^(mailto:[^\s@]+@[^\s@]+|https:\/\/\S+)$/, "A mailto: address or an https: page where the push services can reach the shop.").optional()),
  /**
   * Comma-separated addresses that become admins once they sign in with the
   * address confirmed (docs/adr/016): how the first admin exists in production.
   * Not a secret.
   */
  ADMIN_EMAILS: optionalString.transform((value) =>
    (value ?? "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter((email) => email !== ""),
  ),

  /**
   * Email (docs/adr/016). With RESEND_API_KEY, emails go out through Resend as
   * well as into the outbox; without it they are only kept in the outbox, which
   * the local stack shows. EMAIL_FROM must be an address on a domain verified in
   * Resend.
   */
  RESEND_API_KEY: optionalString,
  EMAIL_FROM: z.string().min(3).default("Vitrine <onboarding@resend.dev>"),

  /**
   * Prices by country (docs/adr/013). GEOIP_DATABASE: path to an IP-to-country
   * database, preferably the compiled `.bin` that `pnpm geoip update` writes next
   * to the DB-IP Lite CSV (loads in milliseconds; the CSV takes seconds and is
   * still accepted). GEO_COUNTRY_HEADER: a request
   * header that already carries the country, set only behind a CDN that
   * overwrites it (Cloudflare: cf-ipcountry). Both optional; without them prices
   * are shown for Greece until the shopper chooses a country.
   */
  GEOIP_DATABASE: optionalString,
  GEO_COUNTRY_HEADER: optionalString.pipe(z.string().regex(/^[a-z0-9-]+$/).optional()),

  /**
   * AI (docs/PLAN.md Part 3, docs/adr/019). AI_PROVIDER picks where the models
   * come from: "google" (Gemini, the backbone), or "demo", a scripted stand-in
   * that answers without any key, labelled as a demo in the interface. Unset, it
   * is "google" when a Gemini key is present, "demo" on the local stack, and
   * "off" otherwise (a deployment without a key hides the AI features rather
   * than failing). Keys are secrets and are pasted into the host by George.
   */
  AI_PROVIDER: z.enum(["google", "demo", "off"]).optional(),
  GOOGLE_GENERATIVE_AI_API_KEY: optionalString,
  /**
   * Realtime voice (docs/adr/030). VOICE_PROVIDER picks who carries a spoken
   * session: "openai" (with OPENAI_API_KEY), "google" (with the Gemini key
   * above), or "browser", the browser's own speech, which needs no key. A
   * provider without its key falls back to the browser, so voice never breaks.
   */
  OPENAI_API_KEY: optionalString,
  VOICE_PROVIDER: z.enum(["browser", "google", "openai"]).default("google"),
  /**
   * AI pictures of a piece in a room (docs/adr/053, docs/adr/060). "off" (the
   * default): no picture is made, and "Picture it" shows only showroom pictures
   * the AI has already made, or nothing. "google": the image model makes them,
   * through the cost guard and the shopper's allowance — turned on by George
   * once he has seen the price. "fixture": the tests' stand-in, which hands back
   * a real photograph it was given; refused in production. "drawn" was the old
   * keyless preview (removed: only photoreal pictures reach a shopper) and is
   * read as "off", so a deployment that still sets it starts as before.
   */
  PICTURES_PROVIDER: z
    .enum(["off", "google", "fixture", "drawn"])
    .default("off")
    .transform((value) => (value === "drawn" ? "off" : value)),
  /** Which image model: "pro" (Nano Banana Pro, the default, the most faithful) or "flash" (Nano Banana 2, about a quarter cheaper). */
  PICTURES_MODEL: z.enum(["pro", "flash"]).default("pro"),
  /**
   * The learned ranking stage of search (docs/adr/057): LambdaMART trees the
   * project trained on ESCI, run in the shop after fusion. "off" goes back to
   * fusion and business re-ranking alone, without a deploy of code.
   */
  SEARCH_RANKER: z.enum(["on", "off"]).default("on"),
  /** Virtual try-on (Phase 9). Without it try-on runs in demo mode or not at all. */
  FASHN_API_KEY: optionalString,
  /**
   * fal.ai, for AI 3D models made from a piece's photograph (docs/adr/059). Only
   * the hand-run batch (scripts/models.ts ai) uses it, after George's yes; without
   * it every piece keeps the shop's own made model.
   */
  FAL_KEY: optionalString,
  /** The whole shop's AI spend per day, in euros; past it, AI features pause until midnight UTC. */
  AI_DAILY_BUDGET_EUR: z.coerce.number().min(0).max(1000).default(3),
  /** "1" turns every AI feature off at once; the shop falls back to classic search and hides the Concierge. */
  AI_KILL_SWITCH: z
    .enum(["0", "1"])
    .optional()
    .transform((value) => value === "1"),

  /** Observability. Optional so local development works without accounts. */
  SENTRY_DSN: optionalString,
  LOG_LEVEL: z
    .enum(["trace", "debug", "info", "warn", "error", "fatal", "silent"])
    .default("info"),

  /**
   * Shared secret for the Phase 1 `/api/dev/ping` probe. When unset the route
   * returns 404, so production is not left with an unauthenticated way to
   * enqueue work. Removed once real authentication exists (Phase 5).
   */
  DEV_PING_TOKEN: optionalString.pipe(z.string().min(16).optional()),

  PORT: z.coerce.number().int().positive().default(3000),
});

type Raw = z.infer<typeof rawSchema>;

function resolveDrivers(raw: Raw) {
  return {
    jobsDriver: raw.JOBS_DRIVER ?? (raw.REDIS_URL !== undefined ? "bullmq" : "inline"),
    storageDriver: raw.STORAGE_DRIVER ?? (raw.S3_ENDPOINT !== undefined ? "s3" : "local"),
    aiMode: raw.AI_PROVIDER ?? (raw.GOOGLE_GENERATIVE_AI_API_KEY !== undefined ? "google" : raw.VITRINE_LOCAL || raw.NODE_ENV !== "production" ? "demo" : "off"),
  } as const;
}

const serverSchema = rawSchema
  .superRefine((raw, ctx) => {
    const { jobsDriver, storageDriver } = resolveDrivers(raw);
    const require = (key: keyof Raw, because: string) => {
      if (raw[key] === undefined) {
        ctx.addIssue({ code: "custom", path: [key], message: `Required ${because}.` });
      }
    };

    if (jobsDriver === "bullmq") require("REDIS_URL", "by the bullmq jobs driver");

    if (storageDriver === "s3") {
      for (const key of ["S3_ENDPOINT", "S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"] as const) {
        require(key, "by the s3 storage driver");
      }
    } else {
      require("LOCAL_STORAGE_SECRET", "by the local storage driver (at least 32 characters)");
    }

    if (raw.NODE_ENV === "production") require("COOKIE_SECRET", "in production to sign cart cookies and order links (at least 32 characters)");
    if (raw.NODE_ENV === "production") require("BETTER_AUTH_SECRET", "in production to sign sessions (at least 32 characters)");
    if (raw.AI_PROVIDER === "google") require("GOOGLE_GENERATIVE_AI_API_KEY", "by AI_PROVIDER=google");
    const stripeKeys = [raw.STRIPE_SECRET_KEY, raw.STRIPE_PUBLISHABLE_KEY, raw.STRIPE_WEBHOOK_SECRET].filter((value) => value !== undefined).length;
    if (stripeKeys !== 0 && stripeKeys !== 3) {
      ctx.addIssue({ code: "custom", path: ["STRIPE_SECRET_KEY"], message: "Set STRIPE_SECRET_KEY, STRIPE_PUBLISHABLE_KEY and STRIPE_WEBHOOK_SECRET together, or none of them." });
    }
    const vapidKeys = [raw.VAPID_PUBLIC_KEY, raw.VAPID_PRIVATE_KEY, raw.VAPID_SUBJECT].filter((value) => value !== undefined).length;
    if (vapidKeys !== 0 && vapidKeys !== 3) {
      ctx.addIssue({ code: "custom", path: ["VAPID_PUBLIC_KEY"], message: "Set VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT together, or none of them." });
    }
    if ((raw.GOOGLE_CLIENT_ID === undefined) !== (raw.GOOGLE_CLIENT_SECRET === undefined)) {
      ctx.addIssue({ code: "custom", path: ["GOOGLE_CLIENT_SECRET"], message: "Set both GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET, or neither." });
    }

    const standIns = [
      jobsDriver === "inline" ? "JOBS_DRIVER=inline" : null,
      storageDriver === "local" ? "STORAGE_DRIVER=local" : null,
      raw.PICTURES_PROVIDER === "fixture" ? "PICTURES_PROVIDER=fixture" : null,
    ].filter((value) => value !== null);

    if (raw.NODE_ENV === "production" && !raw.VITRINE_LOCAL && standIns.length > 0) {
      ctx.addIssue({
        code: "custom",
        path: ["NODE_ENV"],
        message:
          `Local stand-in drivers (${standIns.join(", ")}) are refused in production. ` +
          "Configure REDIS_URL and the S3_* variables, or set VITRINE_LOCAL=1 for the local stack.",
      });
    }
  })
  .transform((raw) => ({
    ...raw,
    ...resolveDrivers(raw),
    /** The flag and an address on this machine: never true for a deployment (src/lib/local-stack.ts). */
    localStack: isLocalStack(raw),
    /** Cookies carry Secure whenever the shop is served over https. */
    secureCookies: servesHttps(raw.APP_URL),
    /** Who takes payment: Stripe (test mode) when its keys are set, else the local test payment. */
    paymentProvider: raw.STRIPE_SECRET_KEY !== undefined ? ("stripe" as const) : ("local_test" as const),
    /** Web Push when its keys are set; without them the shop offers no notifications. */
    vapid:
      raw.VAPID_PUBLIC_KEY !== undefined && raw.VAPID_PRIVATE_KEY !== undefined && raw.VAPID_SUBJECT !== undefined
        ? { publicKey: raw.VAPID_PUBLIC_KEY, privateKey: raw.VAPID_PRIVATE_KEY, subject: raw.VAPID_SUBJECT }
        : null,
  }));

export type ServerEnv = z.infer<typeof serverSchema>;

/**
 * `next build` runs without the real environment, and so does `tsc`. Setting
 * SKIP_ENV_VALIDATION lets those steps pass; it must never be set at runtime.
 */
const skipValidation = process.env.SKIP_ENV_VALIDATION === "1";

function parseServerEnv(): ServerEnv {
  const parsed = serverSchema.safeParse(process.env);

  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `  ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    throw new Error(
      `Invalid environment variables:\n${problems}\n\n` +
        "Locally, start the app with `pnpm local`. In production, set them on the host " +
        "and mirror the names in .env.example.",
    );
  }

  return parsed.data;
}

let cached: ServerEnv | undefined;

/**
 * Server-only environment. Calling this from a Client Component is a bug and
 * throws, rather than silently shipping secrets to the browser.
 */
export function serverEnv(): ServerEnv {
  if (typeof window !== "undefined") {
    throw new Error("serverEnv() was called in the browser.");
  }
  if (skipValidation) {
    return process.env as unknown as ServerEnv;
  }
  cached ??= parseServerEnv();
  return cached;
}

/** Validates an arbitrary environment object. Used by tests. */
export function parseEnvironment(source: Record<string, string | undefined>) {
  return serverSchema.safeParse(source);
}

/* -------------------------------------------------------------------------- */
/* Logging configuration                                                      */
/* -------------------------------------------------------------------------- */

const logSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z
    .enum(["trace", "debug", "info", "warn", "error", "fatal", "silent"])
    .default("info"),
  VITRINE_SERVICE: z.enum(["web", "worker"]).default("web"),
});

export type LogConfig = z.infer<typeof logSchema>;

/**
 * The logger's own slice of the environment, validated separately.
 *
 * Logging must not depend on the database or the bucket being configured: the
 * moment something is misconfigured is exactly when the error needs to be
 * written down. If the logger called `serverEnv()`, a missing DATABASE_URL
 * would throw while importing the logger, and the error explaining the missing
 * DATABASE_URL would never be logged.
 *
 * Invalid values fall back to the defaults instead of throwing, for the same
 * reason.
 */
/**
 * The site's public origin, for absolute URLs in metadata (canonical links,
 * hreflang, Open Graph images). Unlike serverEnv() it never throws: a static
 * page rendered by `next build` has no environment, and should get relative
 * URLs rather than fail the build.
 */
export function publicOrigin(): URL | undefined {
  const parsed = z.url().safeParse(process.env.APP_URL);
  return parsed.success ? new URL(parsed.data) : undefined;
}

export function logConfig(): LogConfig {
  const parsed = logSchema.safeParse(process.env);
  return parsed.success ? parsed.data : logSchema.parse({});
}
