/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Drizzle database schema: catalogue, search, interactions, carts and orders.
 */

import { sql, type SQL } from "drizzle-orm";
import {
  bigint,
  boolean,
  char,
  check,
  customType,
  date,
  doublePrecision,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
} from "drizzle-orm/pg-core";
import { uuidv7 } from "uuidv7";

// Relative, not "@/": drizzle-kit loads this file without the TypeScript path aliases.
import { ORDER_STATUSES } from "../commerce/order-state";
import { ROLES } from "../auth/roles";

/**
 * Database schema.
 *
 * Conventions (docs/PLAN.md 2.4): UUIDv7 identifiers, `timestamptz` in UTC,
 * money as integer cents plus a currency code, `created_at` and `updated_at`
 * everywhere. Schema changes go through generated, reviewed migrations only —
 * never `drizzle-kit push` against a real database.
 *
 * Tables arrive with the phase that uses them: settings (Phase 1), the
 * catalogue (Phase 3), behaviour (Phase 8), commerce (Phase 5). The Concierge
 * and media follow.
 */

/**
 * UUIDv7 rather than v4: the first 48 bits are a timestamp, so new rows land at
 * the end of a B-tree index instead of at random positions, which keeps inserts
 * fast and indexes compact as the catalogue grows.
 */
const id = () =>
  uuid("id")
    .primaryKey()
    .$defaultFn(() => uuidv7());

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

/* -------------------------------------------------------------------------- */
/* Settings                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Global runtime switches read by both services: the AI kill switch, daily
 * budgets and similar operational values (docs/PLAN.md 3.3). Kept as key/value
 * so an admin can change behaviour without a deploy.
 */
export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  description: text("description"),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type AppSetting = typeof appSettings.$inferSelect;
export type NewAppSetting = typeof appSettings.$inferInsert;

/* -------------------------------------------------------------------------- */
/* Catalogue                                                                  */
/* -------------------------------------------------------------------------- */

const tsvector = customType<{ data: string }>({
  dataType: () => "tsvector",
});

/** Where a product came from; drives licensing and attribution. */
export const productSource = pgEnum("product_source", ["abo", "capsule"]);

export const productStatus = pgEnum("product_status", ["draft", "active", "archived"]);

/**
 * How the Greek copy of a product was produced. Greek pages show Greek copy
 * only when it exists; machine translations are marked as such until George
 * reviews them (Phase 3, step 3).
 */
export const translationStatus = pgEnum("translation_status", ["none", "machine", "reviewed"]);

export const mediaKind = pgEnum("media_kind", ["image", "spin", "model", "video"]);

export const categories = pgTable(
  "categories",
  {
    id: id(),
    slug: text("slug").notNull(),
    parentId: uuid("parent_id"),
    nameEn: text("name_en").notNull(),
    nameEl: text("name_el").notNull(),
    descriptionEn: text("description_en"),
    descriptionEl: text("description_el"),
    position: integer("position").notNull().default(0),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("categories_slug_key").on(t.slug),
    index("categories_parent_idx").on(t.parentId),
    foreignKey({ name: "categories_parent_id_fk", columns: [t.parentId], foreignColumns: [t.id] }).onDelete("set null"),
  ],
);

export const brands = pgTable(
  "brands",
  {
    id: id(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    ...timestamps,
  },
  (t) => [uniqueIndex("brands_slug_key").on(t.slug)],
);

/** Width, depth and height in whole centimetres. */
export type DimensionsCm = { w: number; d: number; h: number };

export const products = pgTable(
  "products",
  {
    id: id(),
    slug: text("slug").notNull(),
    source: productSource("source").notNull(),
    /** The identifier in the source dataset (the ABO item id), for idempotent re-imports. */
    sourceId: text("source_id").notNull(),
    status: productStatus("status").notNull().default("active"),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "restrict" }),
    brandId: uuid("brand_id").references(() => brands.id, { onDelete: "set null" }),

    /** ABO product type, e.g. CHAIR. */
    kind: text("kind").notNull(),
    titleEn: text("title_en").notNull(),
    titleEl: text("title_el"),
    descriptionEn: text("description_en"),
    descriptionEl: text("description_el"),
    /** Short selling points (ABO bullet points). */
    highlightsEn: text("highlights_en").array().notNull().default(sql`'{}'::text[]`),
    highlightsEl: text("highlights_el").array(),
    translation: translationStatus("translation").notNull().default("none"),

    /** The colour as the source names it, for display ("Light Blue"). */
    colorLabel: text("color_label"),
    /** Canonical ids ("blue", "oak") that search filters and facets use. */
    colors: text("colors").array().notNull().default(sql`'{}'::text[]`),
    materials: text("materials").array().notNull().default(sql`'{}'::text[]`),
    attributes: jsonb("attributes").$type<Record<string, string>>().notNull().default({}),
    dimsCm: jsonb("dims_cm").$type<DimensionsCm>(),
    weightGrams: integer("weight_grams"),

    priceCents: integer("price_cents").notNull(),
    compareAtCents: integer("compare_at_cents"),
    currency: char("currency", { length: 3 }).notNull().default("EUR"),

    ratingSum: integer("rating_sum").notNull().default(0),
    ratingCount: integer("rating_count").notNull().default(0),
    popularity: integer("popularity").notNull().default(0),

    license: text("license").notNull(),
    attribution: text("attribution").notNull(),

    /**
     * Search text, folded by `src/lib/search/normalize.ts` when the product is
     * written (lower case, no accents, final sigma as sigma). Folding in the
     * application rather than with SQL `unaccent` keeps one definition of
     * "the same word" for queries and documents alike.
     */
    searchTitle: text("search_title").notNull().default(""),
    searchMeta: text("search_meta").notNull().default(""),
    searchAttributes: text("search_attributes").notNull().default(""),
    searchDescription: text("search_description").notNull().default(""),

    /**
     * The lexical index (A1): title A, kind, brand and category B, colours and
     * materials C, description D. Each field is indexed with both the English
     * and the Greek stemmers, because a field can hold both languages and the
     * query may be in either; on text in the other script a stemmer simply
     * keeps the word as it is.
     */
    searchTsv: tsvector("search_tsv")
      .notNull()
      .generatedAlwaysAs(
        (): SQL => sql`
          setweight(to_tsvector('english', ${products.searchTitle}) || to_tsvector('greek', ${products.searchTitle}), 'A') ||
          setweight(to_tsvector('english', ${products.searchMeta}) || to_tsvector('greek', ${products.searchMeta}), 'B') ||
          setweight(to_tsvector('english', ${products.searchAttributes}) || to_tsvector('greek', ${products.searchAttributes}), 'C') ||
          setweight(to_tsvector('english', ${products.searchDescription}) || to_tsvector('greek', ${products.searchDescription}), 'D')`,
      ),

    /** Semantic search (A1) and content neighbours (A2); filled by the embedding job. */
    textEmbedding: vector("text_embedding", { dimensions: 768 }),

    /**
     * Set when staff edit the product (docs/adr/018). From then on the shop owns
     * its text, prices and photos: the catalogue sync that runs on every deploy
     * still adds new products, but leaves an edited one as staff left it.
     */
    staffEditedAt: timestamp("staff_edited_at", { withTimezone: true }),

    ...timestamps,
  },
  (t) => [
    uniqueIndex("products_slug_key").on(t.slug),
    uniqueIndex("products_source_key").on(t.source, t.sourceId),
    index("products_category_idx").on(t.categoryId, t.status),
    index("products_brand_idx").on(t.brandId),
    index("products_price_idx").on(t.priceCents),
    index("products_colors_idx").using("gin", t.colors),
    index("products_materials_idx").using("gin", t.materials),
    index("products_search_tsv_idx").using("gin", t.searchTsv),
    index("products_search_title_trgm_idx").using("gin", t.searchTitle.op("gin_trgm_ops")),
    index("products_text_embedding_idx").using("hnsw", t.textEmbedding.op("vector_cosine_ops")),
    check("products_price_nonnegative", sql`${t.priceCents} >= 0`),
    check(
      "products_compare_at_above_price",
      sql`${t.compareAtCents} IS NULL OR ${t.compareAtCents} > ${t.priceCents}`,
    ),
    check("products_rating_counts_nonnegative", sql`${t.ratingCount} >= 0 AND ${t.ratingSum} >= 0`),
    check("products_popularity_nonnegative", sql`${t.popularity} >= 0`),
  ],
);

export const productVariants = pgTable(
  "product_variants",
  {
    id: id(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    sku: text("sku").notNull(),
    colorLabel: text("color_label"),
    size: text("size"),
    /** Null means the product price applies. */
    priceCents: integer("price_cents"),
    stock: integer("stock").notNull().default(0),
    position: integer("position").notNull().default(0),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("product_variants_sku_key").on(t.sku),
    index("product_variants_product_idx").on(t.productId, t.position),
    check("product_variants_stock_nonnegative", sql`${t.stock} >= 0`),
    check("product_variants_price_nonnegative", sql`${t.priceCents} IS NULL OR ${t.priceCents} >= 0`),
  ],
);

export const productMedia = pgTable(
  "product_media",
  {
    id: id(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    kind: mediaKind("kind").notNull(),
    /**
     * An application path the browser can load: `/media/<storage key>` for
     * imported files, or `/products/<file>` for the specimen photographs that
     * ship with the code.
     */
    src: text("src").notNull(),
    width: integer("width"),
    height: integer("height"),
    bytes: integer("bytes"),
    altEn: text("alt_en").notNull(),
    altEl: text("alt_el"),
    position: integer("position").notNull().default(0),
    /** Visual search and look-alike neighbours; filled by the embedding job. */
    imageEmbedding: vector("image_embedding", { dimensions: 768 }),
    /** True when the photograph was verified to sit on a white studio ground (plinth blend). */
    whiteGround: boolean("white_ground").notNull().default(false),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("product_media_position_key").on(t.productId, t.kind, t.position),
    index("product_media_image_embedding_idx").using("hnsw", t.imageEmbedding.op("vector_cosine_ops")),
    check("product_media_src_is_path", sql`${t.src} LIKE '/%'`),
  ],
);

/* -------------------------------------------------------------------------- */
/* Behaviour and recommendations (A2)                                         */
/* -------------------------------------------------------------------------- */

export const interactionKind = pgEnum("interaction_kind", ["view", "dwell", "cart", "purchase", "wishlist", "search_click", "tot_choice"]);

/**
 * What shoppers do, recorded only with their consent to personalisation
 * (docs/PLAN.md 2.8, CLAUDE.md rule 9). The actor is an anonymous id from a
 * cookie, never a name or an email; forgetting a shopper deletes their rows.
 * `synthetic` marks sessions generated by scripts/simulate-shoppers.ts, so they
 * can be told apart from real behaviour in every analysis and removed at once.
 */
export const interactions = pgTable(
  "interactions",
  {
    id: id(),
    actorId: text("actor_id").notNull(),
    sessionId: text("session_id").notNull(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    kind: interactionKind("kind").notNull(),
    /** Seconds on the page for a dwell event; null otherwise. */
    dwellSeconds: integer("dwell_seconds"),
    synthetic: boolean("synthetic").notNull().default(false),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("interactions_actor_idx").on(t.actorId, t.occurredAt),
    index("interactions_session_idx").on(t.sessionId, t.occurredAt),
    index("interactions_product_idx").on(t.productId),
    index("interactions_occurred_idx").on(t.occurredAt),
    check("interactions_dwell_nonnegative", sql`${t.dwellSeconds} IS NULL OR ${t.dwellSeconds} >= 0`),
  ],
);

export const neighborKind = pgEnum("neighbor_kind", ["behavior", "content", "blend"]);

/**
 * Precomputed neighbour lists: the Taste Graph's edges, top 50 per product and
 * kind, rebuilt by a worker job. `score` is the transition probability for
 * `blend` (rows sum to 1) and the raw similarity for the other kinds.
 */
export const itemNeighbors = pgTable(
  "item_neighbors",
  {
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    kind: neighborKind("kind").notNull(),
    neighborId: uuid("neighbor_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    score: doublePrecision("score").notNull(),
    rank: integer("rank").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.productId, t.kind, t.neighborId] }),
    index("item_neighbors_rank_idx").on(t.productId, t.kind, t.rank),
    check("item_neighbors_not_self", sql`${t.productId} <> ${t.neighborId}`),
  ],
);

/* -------------------------------------------------------------------------- */
/* Commerce (Phase 5)                                                         */
/* -------------------------------------------------------------------------- */

/**
 * A cart is only its lines. Guests hold it by a signed cookie with its id
 * (src/lib/commerce/server.ts); a signed-in shopper's cart belongs to their
 * account, and a guest cart is merged into it on sign-in. Prices are never
 * stored here: every view reads current prices and stock, so a cart can never
 * show a stale price.
 */
export const carts = pgTable(
  "carts",
  {
    id: id(),
    /** The owner, once signed in; null for a guest cart. One cart per account. */
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    ...timestamps,
  },
  (t) => [uniqueIndex("carts_user_key").on(t.userId)],
);

export const cartItems = pgTable(
  "cart_items",
  {
    id: id(),
    cartId: uuid("cart_id")
      .notNull()
      .references(() => carts.id, { onDelete: "cascade" }),
    variantId: uuid("variant_id")
      .notNull()
      .references(() => productVariants.id, { onDelete: "cascade" }),
    quantity: integer("quantity").notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("cart_items_cart_variant_key").on(t.cartId, t.variantId),
    // 10 is MAX_QUANTITY_PER_LINE in src/lib/commerce/pricing.ts.
    check("cart_items_quantity_range", sql`${t.quantity} BETWEEN 1 AND 10`),
  ],
);

export const orderStatus = pgEnum("order_status", ORDER_STATUSES);
export const orderActor = pgEnum("order_actor", ["customer", "staff", "system"]);

export type ShippingAddress = {
  name: string;
  line1: string;
  line2?: string;
  city: string;
  postcode: string;
  /** ISO 3166-1 alpha-2. */
  country: string;
  /** State, province or territory code, where the country needs one (US, CA, AU). */
  region?: string;
  phone?: string;
};

/**
 * An order is a snapshot: totals, lines and the address are copied at checkout
 * and never recomputed, so a later price change cannot alter what was bought.
 * Stock is reserved when the order is created and released by the state
 * machine's side effects if it is cancelled or expires.
 */
export const orders = pgTable(
  "orders",
  {
    id: id(),
    /** Human-readable, for emails and support: VT-XXXX-XXXX. */
    number: text("number").notNull(),
    status: orderStatus("status").notNull().default("pending_payment"),
    locale: text("locale").notNull(),
    email: text("email").notNull(),
    shippingAddress: jsonb("shipping_address").$type<ShippingAddress>().notNull(),
    shippingMethod: text("shipping_method").notNull(),
    currency: char("currency", { length: 3 }).notNull().default("EUR"),
    subtotalCents: integer("subtotal_cents").notNull(),
    shippingCents: integer("shipping_cents").notNull(),
    totalCents: integer("total_cents").notNull(),
    vatCents: integer("vat_cents").notNull(),
    /**
     * The VAT charged: the delivery country's standard rate in tenths of a
     * percent (docs/adr/013), recorded with the country, so the receipt stays
     * right after rates change.
     */
    vatRatePerMille: integer("vat_rate_per_mille").notNull(),
    vatCountry: char("vat_country", { length: 2 }).notNull(),
    /** "local_test" until Stripe is connected. */
    paymentProvider: text("payment_provider").notNull(),
    paymentReference: text("payment_reference"),
    /** Sent by the checkout form; a repeated submission returns the same order. */
    idempotencyKey: text("idempotency_key").notNull(),
    /**
     * The account that placed it, when signed in. Null for a guest order; a guest
     * order also appears in the account whose verified email it was placed with.
     * Kept (set null) if the account is deleted: the order is a legal record.
     */
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    /** SHA-256 of the secret in the guest's order link; the secret itself is never stored. */
    accessTokenHash: text("access_token_hash").notNull(),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    /** An unpaid order holds its stock until then. */
    paymentExpiresAt: timestamp("payment_expires_at", { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("orders_number_key").on(t.number),
    uniqueIndex("orders_idempotency_key").on(t.idempotencyKey),
    index("orders_status_idx").on(t.status, t.createdAt),
    index("orders_email_idx").on(t.email),
    index("orders_user_idx").on(t.userId, t.createdAt),
    check("orders_amounts_nonnegative", sql`${t.subtotalCents} >= 0 AND ${t.shippingCents} >= 0 AND ${t.vatCents} >= 0`),
    check("orders_total_adds_up", sql`${t.totalCents} = ${t.subtotalCents} + ${t.shippingCents}`),
    check("orders_vat_rate_range", sql`${t.vatRatePerMille} BETWEEN 0 AND 300`),
  ],
);

export const orderItems = pgTable(
  "order_items",
  {
    id: id(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    /** Kept when the product is later deleted: the order still says what was bought. */
    productId: uuid("product_id").references(() => products.id, { onDelete: "set null" }),
    variantId: uuid("variant_id").references(() => productVariants.id, { onDelete: "set null" }),
    sku: text("sku").notNull(),
    title: text("title").notNull(),
    imageSrc: text("image_src"),
    unitCents: integer("unit_cents").notNull(),
    quantity: integer("quantity").notNull(),
    lineCents: integer("line_cents").notNull(),
    ...timestamps,
  },
  (t) => [
    index("order_items_order_idx").on(t.orderId),
    check("order_items_quantity_positive", sql`${t.quantity} > 0`),
    check("order_items_line_adds_up", sql`${t.lineCents} = ${t.unitCents} * ${t.quantity}`),
  ],
);

/** The order's history: every transition, who caused it and why. Append-only. */
export const orderEvents = pgTable(
  "order_events",
  {
    id: id(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    /** Null for the event that created the order. */
    fromStatus: orderStatus("from_status"),
    toStatus: orderStatus("to_status").notNull(),
    event: text("event").notNull(),
    actor: orderActor("actor").notNull(),
    /** The person, when the actor is a customer or staff member with an account (docs/adr/016). */
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("order_events_order_idx").on(t.orderId, t.createdAt)],
);

/* -------------------------------------------------------------------------- */
/* Accounts (Phase 5, Better Auth, docs/adr/016)                              */
/* -------------------------------------------------------------------------- */

/**
 * The tables Better Auth needs for email and password, email verification,
 * passkeys, TOTP two-factor and roles. The field list comes from Better Auth
 * itself (`getAuthTables` for this configuration), not from memory; the
 * property names are the ones it reads and writes, and the columns follow this
 * schema's conventions (snake_case, plural table names, UUIDv7 ids, timestamptz).
 */
export const users = pgTable(
  "users",
  {
    id: id(),
    name: text("name").notNull(),
    /** Stored lower-case by Better Auth; unique. */
    email: text("email").notNull(),
    emailVerified: boolean("email_verified").notNull().default(false),
    image: text("image"),
    twoFactorEnabled: boolean("two_factor_enabled").default(false),
    /** One of ROLES (src/lib/auth/roles.ts), or several joined by commas, as Better Auth stores them. */
    role: text("role").notNull().default("customer"),
    banned: boolean("banned").default(false),
    banReason: text("ban_reason"),
    banExpires: timestamp("ban_expires", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("users_email_key").on(t.email),
    // Better Auth lower-cases addresses; the check makes sure nothing else writes one that is not.
    check("users_email_lowercase", sql`${t.email} = lower(${t.email})`),
    check("users_role_known", sql`${t.role} ~ ${sql.raw(`'^(${ROLES.join("|")})(,(${ROLES.join("|")}))*$'`)}`),
  ],
);

/**
 * A signed-in browser. The token is what the session cookie carries; the
 * address and browser are kept so the account page can show "where you are
 * signed in" and let the owner sign a device out.
 */
export const sessions = pgTable(
  "sessions",
  {
    id: id(),
    token: text("token").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    /** Set when staff act as this customer (admin plugin). */
    impersonatedBy: uuid("impersonated_by").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [uniqueIndex("sessions_token_key").on(t.token), index("sessions_user_idx").on(t.userId)],
);

/** A way to sign in: the password (provider "credential") or an outside provider such as Google. */
export const accounts = pgTable(
  "accounts",
  {
    id: id(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    /** A scrypt hash, never the password. */
    password: text("password"),
    ...timestamps,
  },
  (t) => [uniqueIndex("accounts_provider_key").on(t.providerId, t.accountId), index("accounts_user_idx").on(t.userId)],
);

/** Short-lived tokens: email verification and password reset links, and passkey challenges. */
export const verifications = pgTable(
  "verifications",
  {
    id: id(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (t) => [index("verifications_identifier_idx").on(t.identifier)],
);

/** TOTP two-factor: the shared secret and the one-time backup codes, both encrypted by Better Auth. */
export const twoFactors = pgTable(
  "two_factors",
  {
    id: id(),
    secret: text("secret").notNull(),
    backupCodes: text("backup_codes").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    verified: boolean("verified").default(true),
    failedVerificationCount: integer("failed_verification_count").default(0),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
  },
  (t) => [index("two_factors_user_idx").on(t.userId), index("two_factors_secret_idx").on(t.secret)],
);

/** A passkey (WebAuthn credential): only its public key is stored. */
export const passkeys = pgTable(
  "passkeys",
  {
    id: id(),
    name: text("name"),
    publicKey: text("public_key").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    credentialID: text("credential_id").notNull(),
    counter: integer("counter").notNull(),
    deviceType: text("device_type").notNull(),
    backedUp: boolean("backed_up").notNull(),
    transports: text("transports"),
    aaguid: text("aaguid"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [index("passkeys_user_idx").on(t.userId), uniqueIndex("passkeys_credential_key").on(t.credentialID)],
);

/**
 * Every email the shop sends, as sent (docs/adr/016). Until an email provider
 * is connected this IS the delivery: the local outbox page shows it, and the
 * end-to-end tests follow verification links from it. Rows hold one-time links,
 * so they are readable only on the local stack or by an admin, and are deleted
 * after a week.
 */
export const emailOutbox = pgTable(
  "email_outbox",
  {
    id: id(),
    toAddress: text("to_address").notNull(),
    /** verify_email, reset_password, order_confirmation, … */
    kind: text("kind").notNull(),
    locale: text("locale").notNull(),
    subject: text("subject").notNull(),
    textBody: text("text_body").notNull(),
    htmlBody: text("html_body").notNull(),
    /** "outbox" when only stored here; "resend" when also handed to Resend. */
    transport: text("transport").notNull(),
    providerId: text("provider_id"),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("email_outbox_to_idx").on(t.toAddress, t.createdAt), index("email_outbox_created_idx").on(t.createdAt)],
);

/* -------------------------------------------------------------------------- */
/* Reviews (Phase 5 step 6, docs/adr/017)                                     */
/* -------------------------------------------------------------------------- */

export const reviewStatus = pgEnum("review_status", ["published", "hidden"]);

/**
 * A review is tied to the order line it reviews, which is what makes it
 * "verified": it can only be written for a piece that was delivered, one per
 * purchased line. It is published at once and counted in the product's
 * rating_sum and rating_count in the same transaction; staff can hide it,
 * which takes it out of both. The text is untrusted: it is only ever rendered
 * as text, and never given to the Concierge as instructions.
 */
export const reviews = pgTable(
  "reviews",
  {
    id: id(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    orderItemId: uuid("order_item_id")
      .notNull()
      .references(() => orderItems.id, { onDelete: "cascade" }),
    /** The account that wrote it, when there is one; guests review from their order link. */
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    rating: integer("rating").notNull(),
    title: text("title"),
    body: text("body").notNull(),
    /** "Eleni P.": first name and initial, from the delivery name. */
    authorName: text("author_name").notNull(),
    locale: text("locale").notNull(),
    status: reviewStatus("status").notNull().default("published"),
    moderationReason: text("moderation_reason"),
    moderatedBy: uuid("moderated_by").references(() => users.id, { onDelete: "set null" }),
    moderatedAt: timestamp("moderated_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("reviews_order_item_key").on(t.orderItemId),
    index("reviews_product_idx").on(t.productId, t.status, t.createdAt),
    index("reviews_status_idx").on(t.status, t.createdAt),
    check("reviews_rating_range", sql`${t.rating} BETWEEN 1 AND 5`),
    check("reviews_body_length", sql`char_length(${t.body}) BETWEEN 1 AND 4000`),
  ],
);

export type Review = typeof reviews.$inferSelect;

/* -------------------------------------------------------------------------- */
/* Running the shop (Phase 11, docs/adr/018)                                  */
/* -------------------------------------------------------------------------- */

/**
 * Who changed what, for changes that keep no history of their own: product
 * edits, stock, review moderation, roles. Order changes are not repeated here;
 * `order_events` already records each one with the person behind it. Only the
 * fields that changed are kept, before and after, written in the same
 * transaction as the change itself. The actor's email is copied so the entry
 * still reads after an account is deleted.
 */
export const auditLog = pgTable(
  "audit_log",
  {
    id: id(),
    /** Null for the system (the ADMIN_EMAILS grant, a script without an account). */
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    actorEmail: text("actor_email"),
    /** "product.update", "stock.set", "review.hide", "review.restore", "role.grant", "role.revoke". */
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    /** { field: { before, after } } for each field that changed. */
    changes: jsonb("changes").$type<Record<string, { before: unknown; after: unknown }>>().notNull(),
    /** Why, when the person had to say: a stock correction, a hidden review. */
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("audit_log_entity_idx").on(t.entityType, t.entityId, t.createdAt), index("audit_log_created_idx").on(t.createdAt)],
);

export const searchSource = pgEnum("search_source", ["page", "api"]);

/**
 * What people search for, for the search dashboard: top queries and the ones
 * that find nothing. No user, session or address is kept, digit runs that
 * could be a phone or card number are masked before the query is stored, and
 * rows are deleted after 90 days (src/lib/search/analytics.ts).
 */
export const searchEvents = pgTable(
  "search_events",
  {
    id: id(),
    /** Folded (lower case, no accents) and masked. */
    query: text("query").notNull(),
    locale: text("locale").notNull(),
    results: integer("results").notNull(),
    /** Filters were dropped to find something. */
    relaxed: boolean("relaxed").notNull().default(false),
    /** A word was corrected for spelling. */
    corrected: boolean("corrected").notNull().default(false),
    tookMs: integer("took_ms").notNull(),
    source: searchSource("source").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("search_events_occurred_idx").on(t.occurredAt), check("search_events_results_nonnegative", sql`${t.results} >= 0`)],
);

/* -------------------------------------------------------------------------- */
/* AI usage, allowances and budgets (docs/PLAN.md 3.3, docs/adr/019)         */
/* -------------------------------------------------------------------------- */

/**
 * One row per AI call: which feature, which model, what it used and what it
 * cost, in millionths of a euro. The daily budget and the AI-spend dashboard
 * read it. The actor is a key ("user:<id>" or "guest:<random id>"), never a
 * name, address or message text; demo-mode calls are recorded too, with the
 * "demo" provider and no cost, so they can be told apart.
 */
export const aiUsage = pgTable(
  "ai_usage",
  {
    id: id(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    feature: text("feature").notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    /** Where the call came from: chat, voice, support, a job or a script. */
    surface: text("surface").notNull(),
    actorKey: text("actor_key"),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    /** Images, seconds, minutes or calls, for models priced per unit. */
    units: doublePrecision("units").notNull().default(0),
    /** Null when the model's price is not confirmed (src/lib/ai/models.ts). */
    costMicros: bigint("cost_micros", { mode: "number" }),
  },
  (t) => [
    index("ai_usage_occurred_idx").on(t.occurredAt),
    index("ai_usage_feature_idx").on(t.feature, t.occurredAt),
    check("ai_usage_counts_nonnegative", sql`${t.inputTokens} >= 0 AND ${t.outputTokens} >= 0 AND ${t.units} >= 0 AND (${t.costMicros} IS NULL OR ${t.costMicros} >= 0)`),
  ],
);

/**
 * Each shopper's allowance for the day (UTC): Concierge turns taken and
 * credits spent on costly actions. One row per actor and day, incremented only
 * when still under the cap, in one statement, so two requests at once cannot
 * both take the last turn.
 */
export const aiAllowances = pgTable(
  "ai_allowances",
  {
    actorKey: text("actor_key").notNull(),
    day: date("day", { mode: "string" }).notNull(),
    turns: integer("turns").notNull().default(0),
    credits: integer("credits").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.actorKey, t.day] }),
    check("ai_allowances_nonnegative", sql`${t.turns} >= 0 AND ${t.credits} >= 0`),
  ],
);

/**
 * A shopper waiting for a price to fall (docs/PLAN.md Phase 11 step 5). One
 * watch per person per product; the nightly job emails them when the shop's
 * price for their country reaches the target, and then rests that watch.
 */
export const priceWatches = pgTable(
  "price_watches",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    /** The price the shopper is waiting for, in cents of the shop's currency. */
    targetCents: integer("target_cents").notNull(),
    locale: text("locale").notNull().default("en"),
    notifiedAt: timestamp("notified_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("price_watches_person_product_key").on(t.userId, t.productId),
    index("price_watches_product_idx").on(t.productId),
    check("price_watches_target_positive", sql`${t.targetCents} > 0`),
  ],
);

/**
 * A report the worker produced (the weekly PDF): where the file is and the
 * figures it was built from, so the admin page can list them without
 * opening the files.
 */
export const reports = pgTable(
  "reports",
  {
    id: id(),
    kind: text("kind").notNull(),
    periodStart: date("period_start", { mode: "string" }).notNull(),
    periodEnd: date("period_end", { mode: "string" }).notNull(),
    /** Key in the shop's storage; the admin page signs a short-lived link to it. */
    storageKey: text("storage_key").notNull(),
    bytes: integer("bytes").notNull().default(0),
    summary: jsonb("summary").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("reports_kind_idx").on(t.kind, t.periodEnd)],
);

export type AuditLogRow = typeof auditLog.$inferSelect;
export type AiUsageRow = typeof aiUsage.$inferSelect;
export type PriceWatch = typeof priceWatches.$inferSelect;
export type ReportRow = typeof reports.$inferSelect;
export type SearchEvent = typeof searchEvents.$inferSelect;

export type User = typeof users.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type EmailOutboxRow = typeof emailOutbox.$inferSelect;

export type Cart = typeof carts.$inferSelect;
export type CartItem = typeof cartItems.$inferSelect;
export type Order = typeof orders.$inferSelect;
export type OrderItem = typeof orderItems.$inferSelect;
export type OrderEventRow = typeof orderEvents.$inferSelect;

export type Interaction = typeof interactions.$inferSelect;
export type ItemNeighbor = typeof itemNeighbors.$inferSelect;

export type Category = typeof categories.$inferSelect;
export type Brand = typeof brands.$inferSelect;
export type Product = typeof products.$inferSelect;
export type NewProduct = typeof products.$inferInsert;
export type ProductVariant = typeof productVariants.$inferSelect;
export type ProductMedia = typeof productMedia.$inferSelect;
