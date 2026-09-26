"use client";

/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Native sort-order select for product listings.
 */

import { useId } from "react";

import { useRouter } from "@/i18n/navigation";

/**
 * Sort order for a listing.
 *
 * A native `<select>`, not the design system's Radix Select. The listbox a
 * phone opens for a native select is the best sort picker a phone has, and the
 * Radix version added about 40 KB of JavaScript to every listing page, which
 * Lighthouse measured as blocking time on exactly the pages that have the most
 * to render. Styled with the same tokens as a field, so it looks the part.
 *
 * The server computes each option's URL, so the browser only navigates. Inside
 * a GET form with the current filters as hidden fields, it also works before
 * JavaScript loads: choose, then press the submit button that only then shows.
 */
export function ListingSort({
  label,
  submitLabel,
  value,
  options,
  action,
  hidden,
}: {
  label: string;
  submitLabel: string;
  value: string;
  options: readonly { value: string; label: string; href: string }[];
  /** The listing path, for the no-JavaScript form submission. */
  action: string;
  /** Current filters, carried through a no-JavaScript submission. */
  hidden: readonly [name: string, value: string][];
}) {
  const router = useRouter();
  const id = useId();

  return (
    <form action={action} method="get" className="flex w-full flex-col gap-2 sm:w-56">
      {hidden.map(([name, fieldValue]) => (
        <input key={`${name}=${fieldValue}`} type="hidden" name={name} value={fieldValue} />
      ))}
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <div className="relative">
        <select
          id={id}
          name="sort"
          defaultValue={value}
          onChange={(event) => {
            const option = options.find((candidate) => candidate.value === event.currentTarget.value);
            if (option !== undefined) router.push(option.href, { scroll: false, transitionTypes: ["listing"] });
          }}
          className="border-hairline text-dusk hover:border-dusk/35 rounded-plinth h-11 w-full cursor-pointer appearance-none border bg-white pr-9 pl-3 transition-colors"
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <svg
          viewBox="0 0 24 24"
          className="text-slate pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          aria-hidden="true"
        >
          <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      <noscript>
        <button type="submit" className="border-hairline rounded-plinth h-11 w-full border text-sm">
          {submitLabel}
        </button>
      </noscript>
    </form>
  );
}
