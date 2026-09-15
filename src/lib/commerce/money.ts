/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Money type: integer minor units with currency, arithmetic and formatting.
 */

/**
 * Money (docs/PLAN.md conventions, CLAUDE.md)
 *
 * Money is an integer number of minor units plus an ISO 4217 currency code.
 * Never a float: `0.1 + 0.2 !== 0.3`, and a cart that is one cent wrong is a
 * bug a customer will find. Totals are always recomputed on the server; this
 * module only does arithmetic and formatting.
 */

export type Money = {
  /** Minor units (cents for EUR). Always an integer, may be negative. */
  readonly cents: number;
  /** ISO 4217 code, uppercase. */
  readonly currency: string;
};

export const DEFAULT_CURRENCY = "EUR";

/**
 * Currencies whose minor unit is the major unit (no decimal part). The store
 * sells in EUR, but formatting must not silently divide by 100 if that ever
 * changes.
 */
const ZERO_DECIMAL_CURRENCIES = new Set(["JPY", "KRW", "VND", "CLP", "ISK"]);

export function minorUnitsPerMajor(currency: string): number {
  return ZERO_DECIMAL_CURRENCIES.has(currency.toUpperCase()) ? 1 : 100;
}

export function money(cents: number, currency: string = DEFAULT_CURRENCY): Money {
  if (!Number.isInteger(cents)) {
    throw new TypeError(
      `Money must be an integer number of minor units, received ${cents}.`,
    );
  }
  return { cents, currency: currency.toUpperCase() };
}

/** Adds amounts. Mixing currencies is a programming error, not a conversion. */
export function addMoney(a: Money, b: Money): Money {
  if (a.currency !== b.currency) {
    throw new TypeError(`Cannot add ${a.currency} to ${b.currency}.`);
  }
  return { cents: a.cents + b.cents, currency: a.currency };
}

/**
 * Multiplies by a whole quantity. Quantities are counts of items, so a
 * fractional quantity means the caller has a bug.
 */
export function multiplyMoney(amount: Money, quantity: number): Money {
  if (!Number.isInteger(quantity) || quantity < 0) {
    throw new TypeError(`Quantity must be a non-negative integer, received ${quantity}.`);
  }
  return { cents: amount.cents * quantity, currency: amount.currency };
}

export function sumMoney(
  amounts: readonly Money[],
  currency: string = DEFAULT_CURRENCY,
): Money {
  return amounts.reduce<Money>(addMoney, money(0, currency));
}

/**
 * Applies a percentage discount and rounds half away from zero, the rule used
 * on receipts. `Math.round` rounds half *up*, which is asymmetric for negative
 * amounts (refunds), so it is not used here.
 */
export function percentOf(amount: Money, percent: number): Money {
  const exact = (amount.cents * percent) / 100;
  const rounded = Math.sign(exact) * Math.round(Math.abs(exact));
  return { cents: rounded, currency: amount.currency };
}

/**
 * Formats for display. Locale affects separators and symbol placement: EUR is
 * "€12.50" in English and "12,50 €" in Greek, and both must be correct.
 */
export function formatMoney(
  amount: Money,
  locale: string = "en",
  options: { hideDecimalsWhenWhole?: boolean } = {},
): string {
  const divisor = minorUnitsPerMajor(amount.currency);
  const value = amount.cents / divisor;
  const isWhole = amount.cents % divisor === 0;
  const fractionDigits =
    divisor === 1 || (options.hideDecimalsWhenWhole === true && isWhole) ? 0 : 2;

  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: amount.currency,
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value);
}

/** Discount percentage for a compare-at price, rounded down so it never oversells. */
export function discountPercent(price: Money, compareAt: Money): number | null {
  if (price.currency !== compareAt.currency) return null;
  if (compareAt.cents <= price.cents || compareAt.cents <= 0) return null;
  return Math.floor(((compareAt.cents - price.cents) / compareAt.cents) * 100);
}
