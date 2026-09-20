/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Commerce database store: carts, stock holds, orders and order events.
 */

import type postgres from "postgres";
import { uuidv7 } from "uuidv7";

import { money, type Money } from "@/lib/commerce/money";
import {
  PAYMENT_WINDOW_MINUTES,
  transition,
  type Actor,
  type OrderEventType,
  type OrderStatus,
  type SideEffect,
} from "@/lib/commerce/order-state";
import { MAX_LINES, MAX_QUANTITY_PER_LINE, priceCart, type ShippingMethodId, type Totals } from "@/lib/commerce/pricing";
import { BASE_COUNTRY, localizeCents, outsideVatArea, type OutsideVatAreaPlace } from "@/lib/commerce/vat";
import { hashToken, newAccessToken, newOrderNumber, tokenMatches } from "@/lib/commerce/tokens";
import type { ShippingAddress } from "@/lib/db/schema";

/**
 * Carts and orders in the database (docs/PLAN.md Phase 5).
 *
 * Every price and stock figure is read inside the operation that uses it, and
 * totals come from `priceCart` on the server (CLAUDE.md golden rule 5). Placing
 * an order and applying an order event are single transactions: stock is taken
 * with `UPDATE … WHERE stock >= quantity`, so two shoppers racing for the last
 * lamp cannot both get it, and a state change, its history row and its stock
 * effects commit together or not at all.
 *
 * Dates go to the database as ISO strings with `::timestamptz`, and JSON as a
 * string with `::text::jsonb`: the shared postgres.js client has Drizzle's
 * serialisers installed, which break `sql.json()` and Date parameters, and which
 * JSON-encode a parameter the server types as jsonb a second time, storing a
 * string instead of an object; typing it as text first avoids that (ADR-010).
 */

type Sql = postgres.Sql;
type Tx = postgres.TransactionSql;

export type CartLine = {
  variantId: string;
  productId: string;
  slug: string;
  sku: string;
  title: string;
  kindLabelKey: string;
  image: { src: string; width: number; height: number; alt: string } | null;
  /** In the country the cart is priced for. */
  unitPrice: Money;
  /** The stored (Greek) unit price, which pricing converts. */
  baseUnitCents: number;
  quantity: number;
  stock: number;
  /** False when the product was archived or sold out since it was added. */
  available: boolean;
};

export type CartView = {
  cartId: string | null;
  lines: CartLine[];
  /** Totals over the available lines only. */
  totals: Totals;
};

export type CartChange =
  | { ok: true; cartId: string; quantity: number; limitedTo: number | null }
  | { ok: false; reason: "not_found" | "out_of_stock" | "cart_full" };

export type PlaceOrderInput = {
  cartId: string;
  /** The signed-in account placing it, if any (docs/adr/016). */
  userId?: string | null;
  locale: string;
  email: string;
  address: ShippingAddress;
  shipping: ShippingMethodId;
  idempotencyKey: string;
  paymentProvider: string;
  now?: Date;
};

export type PlaceOrderResult =
  | { ok: true; orderId: string; number: string; accessToken: string | null; replayed: boolean }
  | { ok: false; reason: "empty_cart" }
  | { ok: false; reason: "not_deliverable" }
  | { ok: false; reason: "outside_vat_area"; place: OutsideVatAreaPlace }
  | { ok: false; reason: "unavailable"; variantIds: string[] };

export type OrderView = {
  id: string;
  number: string;
  status: OrderStatus;
  locale: string;
  email: string;
  address: ShippingAddress;
  shippingMethod: ShippingMethodId;
  subtotal: Money;
  shipping: Money;
  total: Money;
  vat: Money;
  vatRatePerMille: number;
  vatCountry: string;
  paymentProvider: string;
  paid: boolean;
  createdAt: Date;
  paymentExpiresAt: Date;
  deliveredAt: Date | null;
  items: { id: string; title: string; sku: string; imageSrc: string | null; unitPrice: Money; quantity: number; line: Money; productSlug: string | null }[];
  events: { from: OrderStatus | null; to: OrderStatus; event: string; actor: Actor; at: Date; reason: string | null; actorName: string | null }[];
};

/** One line of an account's order history. */
export type OrderSummary = {
  id: string;
  number: string;
  status: OrderStatus;
  total: Money;
  createdAt: Date;
  itemCount: number;
  imageSrc: string | null;
};

/** One row of the staff order desk. */
export type DeskOrder = {
  id: string;
  number: string;
  status: OrderStatus;
  email: string;
  name: string;
  country: string;
  total: Money;
  itemCount: number;
  createdAt: Date;
};

/** What an order email needs to know about its order. */
export type OrderContact = {
  id: string;
  number: string;
  status: OrderStatus;
  email: string;
  name: string;
  locale: string;
  userId: string | null;
  accessTokenHash: string;
};

/** Who is asking about an order when they hold no guest link: an account, with its address only if confirmed. */
export type OrderOwner = { userId: string; verifiedEmail: string | null };

export type ApplyEventResult =
  | { ok: true; from: OrderStatus; to: OrderStatus; effects: SideEffect[] }
  | { ok: false; reason: "not_found" | "not_allowed" | "wrong_actor" | "return_window_closed" | "nothing_to_refund" };

type LineRow = {
  variant_id: string;
  product_id: string;
  slug: string;
  sku: string;
  title_en: string;
  title_el: string | null;
  kind: string;
  unit_cents: number;
  currency: string;
  quantity: number;
  stock: number;
  active: boolean;
  image: { src: string; width: number | null; height: number | null; altEn: string; altEl: string | null } | null;
};

export type CommerceStoreOptions = {
  /** How an order's link token is made; random by default, derived from a secret in the app (tokens.orderLinkToken). */
  orderToken?: (orderId: string) => string;
};

export function createCommerceStore(sql: Sql, { orderToken }: CommerceStoreOptions = {}) {
  const lineColumns = sql`
    v.id AS variant_id, p.id AS product_id, p.slug, v.sku, p.title_en, p.title_el, p.kind,
    COALESCE(v.price_cents, p.price_cents) AS unit_cents, p.currency, ci.quantity, v.stock,
    (p.status = 'active') AS active,
    (
      SELECT json_build_object('src', m.src, 'width', m.width, 'height', m.height, 'altEn', m.alt_en, 'altEl', m.alt_el)
      FROM product_media m WHERE m.product_id = p.id AND m.kind = 'image' ORDER BY m.position LIMIT 1
    ) AS image
  `;

  const toLine = (row: LineRow, locale: string, country: string): CartLine => ({
    variantId: row.variant_id,
    productId: row.product_id,
    slug: row.slug,
    sku: row.sku,
    title: locale === "el" ? (row.title_el ?? row.title_en) : row.title_en,
    kindLabelKey: row.kind,
    image:
      row.image === null
        ? null
        : { src: row.image.src, width: row.image.width ?? 1000, height: row.image.height ?? 1000, alt: locale === "el" ? (row.image.altEl ?? row.image.altEn) : row.image.altEn },
    unitPrice: money(localizeCents(row.unit_cents, country), row.currency),
    baseUnitCents: row.unit_cents,
    quantity: row.quantity,
    stock: row.stock,
    available: row.active && row.stock > 0,
  });

  async function readLines(db: Sql | Tx, cartId: string): Promise<LineRow[]> {
    return db<LineRow[]>`
      SELECT ${lineColumns}
      FROM cart_items ci
      JOIN product_variants v ON v.id = ci.variant_id
      JOIN products p ON p.id = v.product_id
      WHERE ci.cart_id = ${cartId}
      ORDER BY ci.created_at, v.sku
    `;
  }

  /** The cart priced for a country: the shopper's while browsing, the delivery country at checkout. */
  async function viewCart(
    cartId: string | null,
    locale: string,
    { shipping = "standard", country = BASE_COUNTRY }: { shipping?: ShippingMethodId; country?: string } = {},
  ): Promise<CartView> {
    const rows = cartId === null ? [] : await readLines(sql, cartId);
    const lines = rows.map((row) => toLine(row, locale, country));
    const priced = lines.filter((line) => line.available).map((line) => ({ unitCents: line.baseUnitCents, quantity: Math.min(line.quantity, line.stock) }));
    return { cartId, lines, totals: priceCart(priced, { shipping, country }) };
  }

  async function itemCount(cartId: string | null): Promise<number> {
    if (cartId === null) return 0;
    const [row] = await sql<{ count: number }[]>`SELECT COALESCE(sum(quantity), 0)::int AS count FROM cart_items WHERE cart_id = ${cartId}`;
    return row?.count ?? 0;
  }

  /**
   * The cart to write to. An id that does not exist gets a new cart, never the
   * id it asked for: ids never come from the shopper.
   *
   * `adopt` is the one exception, for the Concierge (docs/adr/019): a chat
   * answer is a stream, so the guest's cart cookie must be written before the
   * first tool runs. That id is minted by the server in the same request and
   * signed into the cookie, so the cart is created under it.
   */
  async function ensureCart(tx: Tx, cartId: string | null, ownerId: string | null, adopt = false): Promise<string> {
    if (cartId !== null) {
      const [existing] = await tx<{ id: string }[]>`SELECT id FROM carts WHERE id = ${cartId}`;
      if (existing !== undefined) return existing.id;
    }
    const id = adopt && cartId !== null ? cartId : uuidv7();
    await tx`INSERT INTO carts (id, user_id) VALUES (${id}, ${ownerId})`;
    return id;
  }

  /**
   * The cart of a guest holding this cookie, if it is still a guest cart. Once
   * a cart belongs to an account it is only reachable by signing in: signing
   * out must not leave the account's cart open to whoever uses the browser next.
   */
  async function guestCart(cartId: string | null): Promise<string | null> {
    if (cartId === null) return null;
    const [row] = await sql<{ id: string }[]>`SELECT id FROM carts WHERE id = ${cartId} AND user_id IS NULL`;
    return row?.id ?? null;
  }

  /**
   * An account's cart, taking in the guest cart the browser held before
   * signing in (docs/PLAN.md Phase 5 step 2). With no account cart yet, the
   * guest cart simply becomes it. Otherwise its lines are added to the
   * account's, each capped at the per-line maximum, and the guest cart is
   * deleted. Locked, so two tabs signing in at once cannot merge twice.
   */
  async function claimCart(userId: string, guestCartId: string | null): Promise<string | null> {
    return sql.begin(async (tx) => {
      const [owned] = await tx<{ id: string }[]>`SELECT id FROM carts WHERE user_id = ${userId} FOR UPDATE`;
      const [guest] =
        guestCartId === null ? [] : await tx<{ id: string }[]>`SELECT id FROM carts WHERE id = ${guestCartId} AND user_id IS NULL FOR UPDATE`;
      if (guest === undefined) return owned?.id ?? null;
      if (owned === undefined) {
        await tx`UPDATE carts SET user_id = ${userId}, updated_at = now() WHERE id = ${guest.id}`;
        return guest.id;
      }
      const lines = await tx<{ variant_id: string; quantity: number }[]>`SELECT variant_id, quantity FROM cart_items WHERE cart_id = ${guest.id} ORDER BY created_at`;
      for (const line of lines) {
        const [counted] = await tx<{ lines: number; has: boolean }[]>`
          SELECT count(*)::int AS lines, bool_or(variant_id = ${line.variant_id}) AS has FROM cart_items WHERE cart_id = ${owned.id}
        `;
        if (!(counted?.has ?? false) && (counted?.lines ?? 0) >= MAX_LINES) continue;
        await tx`
          INSERT INTO cart_items (id, cart_id, variant_id, quantity)
          VALUES (${uuidv7()}, ${owned.id}, ${line.variant_id}, ${Math.min(line.quantity, MAX_QUANTITY_PER_LINE)})
          ON CONFLICT (cart_id, variant_id) DO UPDATE
            SET quantity = LEAST(cart_items.quantity + excluded.quantity, ${MAX_QUANTITY_PER_LINE}), updated_at = now()
        `;
      }
      await tx`DELETE FROM carts WHERE id = ${guest.id}`;
      await tx`UPDATE carts SET updated_at = now() WHERE id = ${owned.id}`;
      return owned.id;
    });
  }

  /**
   * Adds to a line (`mode: "add"`) or sets it (`"set"`). The quantity is capped
   * at the stock and at the per-line maximum, and the caller learns the cap.
   * Setting 0 removes the line.
   */
  async function changeLine(
    cartId: string | null,
    variantId: string,
    quantity: number,
    mode: "add" | "set",
    ownerId: string | null = null,
    { adoptCartId = false }: { adoptCartId?: boolean } = {},
  ): Promise<CartChange> {
    return sql.begin(async (tx) => {
      const [variant] = await tx<{ stock: number; active: boolean }[]>`
        SELECT v.stock, (p.status = 'active') AS active
        FROM product_variants v JOIN products p ON p.id = v.product_id
        WHERE v.id = ${variantId}
      `;
      if (variant === undefined || !variant.active) return { ok: false, reason: "not_found" } as const;

      const id = await ensureCart(tx, cartId, ownerId, adoptCartId);
      const [current] = await tx<{ quantity: number }[]>`SELECT quantity FROM cart_items WHERE cart_id = ${id} AND variant_id = ${variantId}`;
      const wanted = mode === "add" ? (current?.quantity ?? 0) + quantity : quantity;

      if (wanted <= 0) {
        await tx`DELETE FROM cart_items WHERE cart_id = ${id} AND variant_id = ${variantId}`;
        return { ok: true, cartId: id, quantity: 0, limitedTo: null } as const;
      }
      if (variant.stock <= 0) return { ok: false, reason: "out_of_stock" } as const;

      const [counted] = await tx<{ lines: number }[]>`SELECT count(*)::int AS lines FROM cart_items WHERE cart_id = ${id}`;
      if (current === undefined && (counted?.lines ?? 0) >= MAX_LINES) return { ok: false, reason: "cart_full" } as const;

      const cap = Math.min(variant.stock, MAX_QUANTITY_PER_LINE);
      const next = Math.min(wanted, cap);
      await tx`
        INSERT INTO cart_items (id, cart_id, variant_id, quantity)
        VALUES (${uuidv7()}, ${id}, ${variantId}, ${next})
        ON CONFLICT (cart_id, variant_id) DO UPDATE SET quantity = excluded.quantity, updated_at = now()
      `;
      await tx`UPDATE carts SET updated_at = now() WHERE id = ${id}`;
      return { ok: true, cartId: id, quantity: next, limitedTo: next < wanted ? cap : null } as const;
    });
  }

  /** The variant a product page adds: the first one in stock, else the first. */
  async function defaultVariant(productId: string): Promise<string | null> {
    const [row] = await sql<{ id: string }[]>`
      SELECT id FROM product_variants WHERE product_id = ${productId}
      ORDER BY (stock > 0) DESC, position, sku LIMIT 1
    `;
    return row?.id ?? null;
  }

  async function placeOrder(input: PlaceOrderInput): Promise<PlaceOrderResult> {
    const now = input.now ?? new Date();
    // VAT and delivery follow the delivery address (docs/adr/013).
    const country = input.address.country;
    const excluded = outsideVatArea(country, input.address.postcode);
    if (excluded !== null) return { ok: false, reason: "outside_vat_area", place: excluded };
    if (priceCart([], { country }).deliverable === false) return { ok: false, reason: "not_deliverable" };

    return sql.begin(async (tx) => {
      // A repeated submission (double click, retry after a timeout) returns the order already placed.
      const [existing] = await tx<{ id: string; number: string }[]>`SELECT id, number FROM orders WHERE idempotency_key = ${input.idempotencyKey}`;
      if (existing !== undefined) return { ok: true, orderId: existing.id, number: existing.number, accessToken: null, replayed: true } as const;

      const rows = await readLines(tx, input.cartId);
      if (rows.length === 0) return { ok: false, reason: "empty_cart" } as const;

      // Reserve stock line by line; any shortfall aborts the whole order.
      const short: string[] = [];
      for (const row of rows) {
        if (!row.active) {
          short.push(row.variant_id);
          continue;
        }
        const taken = await tx`UPDATE product_variants SET stock = stock - ${row.quantity}, updated_at = now() WHERE id = ${row.variant_id} AND stock >= ${row.quantity} RETURNING id`;
        if (taken.length === 0) short.push(row.variant_id);
      }
      if (short.length > 0) {
        // Throwing rolls back the reservations already made in this transaction.
        throw new UnavailableError(short);
      }

      const lines = rows.map((row) => toLine(row, input.locale, country));
      const totals = priceCart(
        lines.map((line) => ({ unitCents: line.baseUnitCents, quantity: line.quantity })),
        { shipping: input.shipping, country, currency: rows[0]!.currency },
      );
      const orderId = uuidv7();
      const accessToken = orderToken?.(orderId) ?? newAccessToken();
      const expires = new Date(now.getTime() + PAYMENT_WINDOW_MINUTES * 60_000);

      let number = newOrderNumber();
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const [clash] = await tx`SELECT 1 FROM orders WHERE number = ${number}`;
        if (clash === undefined) break;
        number = newOrderNumber();
      }

      await tx`
        INSERT INTO orders (
          id, number, status, locale, email, shipping_address, shipping_method, currency,
          subtotal_cents, shipping_cents, total_cents, vat_cents, vat_rate_per_mille, vat_country, payment_provider,
          idempotency_key, access_token_hash, user_id, payment_expires_at, created_at, updated_at
        ) VALUES (
          ${orderId}, ${number}, 'pending_payment', ${input.locale}, ${input.email.toLowerCase()}, ${JSON.stringify(input.address)}::text::jsonb, ${input.shipping}, ${totals.total.currency},
          ${totals.subtotal.cents}, ${totals.shipping.cents}, ${totals.total.cents}, ${totals.vat.cents}, ${totals.vatRatePerMille}, ${country}, ${input.paymentProvider},
          ${input.idempotencyKey}, ${hashToken(accessToken)}, ${input.userId ?? null}, ${expires.toISOString()}::timestamptz, ${now.toISOString()}::timestamptz, ${now.toISOString()}::timestamptz
        )
      `;
      for (const [index, line] of lines.entries()) {
        await tx`
          INSERT INTO order_items (id, order_id, product_id, variant_id, sku, title, image_src, unit_cents, quantity, line_cents)
          VALUES (${uuidv7()}, ${orderId}, ${line.productId}, ${line.variantId}, ${line.sku}, ${line.title}, ${line.image?.src ?? null},
                  ${totals.lines[index]!.localUnitCents}, ${line.quantity}, ${totals.lines[index]!.lineCents})
        `;
      }
      await tx`
        INSERT INTO order_events (id, order_id, from_status, to_status, event, actor, created_at)
        VALUES (${uuidv7()}, ${orderId}, NULL, 'pending_payment', 'checkout', 'customer', ${now.toISOString()}::timestamptz)
      `;
      await tx`DELETE FROM cart_items WHERE cart_id = ${input.cartId}`;
      return { ok: true, orderId, number, accessToken, replayed: false } as const;
    }).catch((error: unknown) => {
      if (error instanceof UnavailableError) return { ok: false, reason: "unavailable", variantIds: error.variantIds } as const;
      throw error;
    });
  }

  /**
   * The only way an order changes state. Locks the order row, asks the pure
   * state machine, and in the same transaction writes the new status, the
   * history row, and the database side effects (stock). Effects outside the
   * database (emails, refunds with a provider) are returned for the caller.
   */
  async function applyEvent(
    orderId: string,
    type: OrderEventType,
    actor: Actor,
    { now = new Date(), reason = null as string | null, actorUserId = null as string | null } = {},
  ): Promise<ApplyEventResult> {
    return sql.begin(async (tx) => {
      const [order] = await tx<{ status: OrderStatus; paid_at: Date | null; delivered_at: Date | null }[]>`
        SELECT status, paid_at, delivered_at FROM orders WHERE id = ${orderId} FOR UPDATE
      `;
      if (order === undefined) return { ok: false, reason: "not_found" } as const;

      const result = transition(
        // A Date, whatever the client returns: clients wrapped by Drizzle hand timestamps back as strings.
        { status: order.status, paid: order.paid_at !== null, deliveredAt: order.delivered_at === null ? null : new Date(order.delivered_at) },
        { type, actor, at: now },
      );
      if (!result.ok) return { ok: false, reason: result.reason } as const;

      const at = now.toISOString();
      await tx`
        UPDATE orders SET
          status = ${result.to},
          paid_at = CASE WHEN ${result.to} = 'paid' THEN ${at}::timestamptz ELSE paid_at END,
          delivered_at = CASE WHEN ${result.to} = 'delivered' THEN ${at}::timestamptz ELSE delivered_at END,
          updated_at = ${at}::timestamptz
        WHERE id = ${orderId}
      `;
      await tx`
        INSERT INTO order_events (id, order_id, from_status, to_status, event, actor, actor_user_id, reason, created_at)
        VALUES (${uuidv7()}, ${orderId}, ${result.from}, ${result.to}, ${type}, ${actor}, ${actorUserId}, ${reason}, ${at}::timestamptz)
      `;
      if (result.effects.includes("release_stock") || result.effects.includes("restock_returned")) {
        await tx`
          UPDATE product_variants v SET stock = v.stock + i.quantity, updated_at = now()
          FROM order_items i WHERE i.order_id = ${orderId} AND i.variant_id = v.id
        `;
      }
      return { ok: true, from: result.from, to: result.to, effects: result.effects } as const;
    });
  }

  /** Expires an unpaid order whose payment window has passed; returns whether it did. */
  async function expireIfDue(orderId: string, now = new Date()): Promise<boolean> {
    const [order] = await sql<{ status: OrderStatus; payment_expires_at: Date }[]>`SELECT status, payment_expires_at FROM orders WHERE id = ${orderId}`;
    if (order === undefined || order.status !== "pending_payment" || new Date(order.payment_expires_at).getTime() > now.getTime()) return false;
    const result = await applyEvent(orderId, "payment_expired", "system", { now, reason: "payment window passed" });
    return result.ok;
  }

  /** An order for a guest holding its link; null for a wrong id or token. */
  async function orderForToken(orderId: string, token: string): Promise<OrderView | null> {
    const [row] = await sql<{ access_token_hash: string }[]>`SELECT access_token_hash FROM orders WHERE id = ${orderId}`;
    if (row === undefined || !tokenMatches(token, row.access_token_hash)) return null;
    return readOrder(orderId);
  }

  /**
   * An order for its account: placed while signed in, or placed as a guest
   * with the address the account has confirmed. An unconfirmed address proves
   * nothing, so it opens nothing.
   */
  async function orderForOwner(orderId: string, owner: OrderOwner): Promise<OrderView | null> {
    const [row] = await sql<{ id: string }[]>`
      SELECT id FROM orders
      WHERE id = ${orderId} AND (user_id = ${owner.userId} OR (${owner.verifiedEmail}::text IS NOT NULL AND email = ${owner.verifiedEmail}))
    `;
    return row === undefined ? null : readOrder(orderId);
  }

  /** An account's orders, newest first, by the same rule as orderForOwner. */
  async function ordersForOwner(owner: OrderOwner, limit = 50): Promise<OrderSummary[]> {
    const rows = await sql<{ id: string; number: string; status: OrderStatus; total_cents: number; currency: string; created_at: Date; item_count: number; image_src: string | null }[]>`
      SELECT o.id, o.number, o.status, o.total_cents, o.currency, o.created_at,
             (SELECT COALESCE(sum(i.quantity), 0)::int FROM order_items i WHERE i.order_id = o.id) AS item_count,
             (SELECT i.image_src FROM order_items i WHERE i.order_id = o.id ORDER BY i.created_at, i.sku LIMIT 1) AS image_src
      FROM orders o
      WHERE o.user_id = ${owner.userId} OR (${owner.verifiedEmail}::text IS NOT NULL AND o.email = ${owner.verifiedEmail})
      ORDER BY o.created_at DESC, o.id DESC
      LIMIT ${limit}
    `;
    return rows.map((row) => ({
      id: row.id,
      number: row.number,
      status: row.status,
      total: money(row.total_cents, row.currency),
      createdAt: new Date(row.created_at),
      itemCount: row.item_count,
      imageSrc: row.image_src,
    }));
  }

  /**
   * The order desk's rows: orders in the given statuses (all when null),
   * optionally matching an order number or email, oldest or newest first.
   */
  async function deskOrders({
    statuses,
    query = null,
    oldestFirst = false,
    limit = 100,
  }: {
    statuses: readonly OrderStatus[] | null;
    query?: string | null;
    oldestFirst?: boolean;
    limit?: number;
  }): Promise<DeskOrder[]> {
    const inStatus = statuses === null ? sql`TRUE` : sql`o.status::text = ANY(${[...statuses]}::text[])`;
    // A typed "%" or "_" is a character to find, not a LIKE wildcard.
    const term = query === null || query.trim() === "" ? null : `%${query.trim().replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
    const matches = term === null ? sql`TRUE` : sql`(o.number ILIKE ${term} OR o.email ILIKE ${term})`;
    const direction = oldestFirst ? sql`ASC` : sql`DESC`;
    const rows = await sql<{ id: string; number: string; status: OrderStatus; email: string; name: string | null; country: string | null; total_cents: number; currency: string; item_count: number; created_at: Date }[]>`
      SELECT o.id, o.number, o.status, o.email, o.shipping_address->>'name' AS name, o.shipping_address->>'country' AS country,
             o.total_cents, o.currency, o.created_at,
             (SELECT COALESCE(sum(i.quantity), 0)::int FROM order_items i WHERE i.order_id = o.id) AS item_count
      FROM orders o
      WHERE ${inStatus} AND ${matches}
      ORDER BY o.created_at ${direction}, o.id ${direction}
      LIMIT ${limit}
    `;
    return rows.map((row) => ({
      id: row.id,
      number: row.number,
      status: row.status,
      email: row.email,
      name: row.name ?? "",
      country: row.country ?? "",
      total: money(row.total_cents, row.currency),
      itemCount: row.item_count,
      createdAt: new Date(row.created_at),
    }));
  }

  /** How many orders are in each status, for the desk's tabs. */
  async function statusCounts(): Promise<Partial<Record<OrderStatus, number>>> {
    const rows = await sql<{ status: OrderStatus; count: number }[]>`SELECT status, count(*)::int AS count FROM orders GROUP BY status`;
    return Object.fromEntries(rows.map((row) => [row.status, row.count]));
  }

  async function orderContact(orderId: string): Promise<OrderContact | null> {
    const [row] = await sql<{ id: string; number: string; status: OrderStatus; email: string; name: string | null; locale: string; user_id: string | null; access_token_hash: string }[]>`
      SELECT id, number, status, email, shipping_address->>'name' AS name, locale, user_id, access_token_hash FROM orders WHERE id = ${orderId}
    `;
    return row === undefined
      ? null
      : { id: row.id, number: row.number, status: row.status, email: row.email, name: row.name ?? "", locale: row.locale, userId: row.user_id, accessTokenHash: row.access_token_hash };
  }

  async function readOrder(orderId: string): Promise<OrderView | null> {
    type OrderRow = {
      id: string;
      number: string;
      status: OrderStatus;
      locale: string;
      email: string;
      shipping_address: ShippingAddress;
      shipping_method: ShippingMethodId;
      currency: string;
      subtotal_cents: number;
      shipping_cents: number;
      total_cents: number;
      vat_cents: number;
      vat_rate_per_mille: number;
      vat_country: string;
      payment_provider: string;
      paid_at: Date | null;
      created_at: Date;
      payment_expires_at: Date;
      delivered_at: Date | null;
    };
    const [order] = await sql<OrderRow[]>`SELECT * FROM orders WHERE id = ${orderId}`;
    if (order === undefined) return null;
    const items = await sql<{ id: string; title: string; sku: string; image_src: string | null; unit_cents: number; quantity: number; line_cents: number; slug: string | null }[]>`
      SELECT i.id, i.title, i.sku, i.image_src, i.unit_cents, i.quantity, i.line_cents, p.slug
      FROM order_items i LEFT JOIN products p ON p.id = i.product_id
      WHERE i.order_id = ${orderId} ORDER BY i.created_at, i.sku
    `;
    const events = await sql<{ from_status: OrderStatus | null; to_status: OrderStatus; event: string; actor: Actor; created_at: Date; reason: string | null; actor_name: string | null }[]>`
      SELECT e.from_status, e.to_status, e.event, e.actor, e.created_at, e.reason, u.name AS actor_name
      FROM order_events e LEFT JOIN users u ON u.id = e.actor_user_id
      WHERE e.order_id = ${orderId} ORDER BY e.created_at, e.id
    `;
    const m = (cents: number) => money(cents, order.currency);
    return {
      id: order.id,
      number: order.number,
      status: order.status,
      locale: order.locale,
      email: order.email,
      address: order.shipping_address,
      shippingMethod: order.shipping_method,
      subtotal: m(order.subtotal_cents),
      shipping: m(order.shipping_cents),
      total: m(order.total_cents),
      vat: m(order.vat_cents),
      vatRatePerMille: order.vat_rate_per_mille,
      vatCountry: order.vat_country,
      paymentProvider: order.payment_provider,
      paid: order.paid_at !== null,
      createdAt: new Date(order.created_at),
      paymentExpiresAt: new Date(order.payment_expires_at),
      deliveredAt: order.delivered_at === null ? null : new Date(order.delivered_at),
      items: items.map((item) => ({
        id: item.id,
        title: item.title,
        sku: item.sku,
        imageSrc: item.image_src,
        unitPrice: m(item.unit_cents),
        quantity: item.quantity,
        line: m(item.line_cents),
        productSlug: item.slug,
      })),
      events: events.map((event) => ({
        from: event.from_status,
        to: event.to_status,
        event: event.event,
        actor: event.actor,
        at: new Date(event.created_at),
        reason: event.reason,
        actorName: event.actor_name,
      })),
    };
  }

  return {
    viewCart,
    itemCount,
    changeLine,
    defaultVariant,
    guestCart,
    claimCart,
    placeOrder,
    applyEvent,
    expireIfDue,
    orderForToken,
    orderForOwner,
    ordersForOwner,
    deskOrders,
    statusCounts,
    orderContact,
    readOrder,
  };
}

class UnavailableError extends Error {
  constructor(readonly variantIds: string[]) {
    super("Some cart lines are no longer available");
    this.name = "UnavailableError";
  }
}

export type CommerceStore = ReturnType<typeof createCommerceStore>;
