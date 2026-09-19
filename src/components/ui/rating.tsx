/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Star rating display with an accessible text label.
 */

import { useTranslations } from "next-intl";

import { cn } from "@/lib/ui/cn";

/**
 * Rating (docs/PLAN.md 4.4, 2.6)
 *
 * Displays an average and the number of verified reviews behind it. Product
 * pages give it the plain mean, which is what shoppers expect to see; ranking
 * in search uses the Bayesian average instead (src/lib/search/rerank.ts), so a
 * single five-star review cannot outrank a well-reviewed product
 * (docs/adr/017).
 *
 * The stars are decorative; the accessible name carries the number, because a
 * screen reader should hear "4.6 out of 5, 38 reviews", not "star star star".
 */
export function Rating({
  value,
  count,
  locale = "en",
  className,
}: {
  /** Average from 0 to 5. */
  value: number;
  /** Number of verified reviews behind the average. */
  count: number;
  locale?: string;
  className?: string;
}) {
  // Works in both Server and Client Components: next-intl supports the hook in
  // any component that is not `async`.
  const t = useTranslations("rating");

  const clamped = Math.min(5, Math.max(0, value));
  const rounded = Math.round(clamped * 10) / 10;
  const filledWidth = `${(clamped / 5) * 100}%`;

  if (count === 0) {
    return <span className={cn("text-slate text-sm", className)}>{t("none")}</span>;
  }

  // The number is formatted before it reaches the message, so a Greek reader
  // hears "4,6 στα 5" with a decimal comma rather than "4.6".
  const label = t("label", { rating: rounded.toLocaleString(locale), count });

  return (
    <span className={cn("inline-flex items-center gap-2 text-sm", className)}>
      <span
        role="img"
        aria-label={label}
        className="relative inline-block leading-none"
        style={{ width: "5.25rem", height: "1rem" }}
      >
        <Stars className="text-hairline" />
        {/* The filled layer is clipped to the score, so a 4.6 shows six tenths
            of the fifth star rather than snapping to a whole one. */}
        <span
          className="absolute inset-0 overflow-hidden"
          style={{ width: filledWidth }}
          aria-hidden="true"
        >
          <Stars className="text-dusk" />
        </span>
      </span>
      <span className="tabular text-slate" aria-hidden="true">
        {rounded.toLocaleString(locale)}
      </span>
      <span className="text-slate" aria-hidden="true">
        ({count.toLocaleString(locale)})
      </span>
    </span>
  );
}

/**
 * One review's stars, whole numbers only. Decorative again: the accessible
 * name says the number of stars.
 */
export function ReviewStars({ rating, label, className }: { rating: number; label: string; className?: string }) {
  return (
    <span role="img" aria-label={label} className={cn("relative inline-block leading-none", className)} style={{ width: "5.25rem", height: "1rem" }}>
      <Stars className="text-hairline" />
      <span className="absolute inset-0 overflow-hidden" style={{ width: `${(Math.min(5, Math.max(0, rating)) / 5) * 100}%` }} aria-hidden="true">
        <Stars className="text-dusk" />
      </span>
    </span>
  );
}

function Stars({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 84 16"
      className={cn("block h-4 w-21", className)}
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      {[0, 1, 2, 3, 4].map((index) => (
        <path
          key={index}
          transform={`translate(${index * 17}, 0)`}
          d="M8 1.2l2.06 4.28 4.69.63-3.42 3.3.84 4.67L8 11.86l-4.17 2.22.84-4.67L1.25 6.1l4.69-.63z"
        />
      ))}
    </svg>
  );
}
