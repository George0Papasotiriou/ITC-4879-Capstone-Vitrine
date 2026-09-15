"use client";

/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Design specimen demo of the Concierge Spotlight with its action timeline and undo.
 */

import { AnimatePresence, motion } from "motion/react";
import { useCallback, useMemo, useState } from "react";

import { ActionTimeline, LumenPresence } from "@/components/concierge/action-timeline";
import {
  SpotlightProvider,
  useSpotlight,
  type Executors,
} from "@/components/concierge/spotlight";
import { ProductImage } from "@/components/commerce/product-image";
import { specimenImage } from "@/lib/specimen/images";
import { ProductTile } from "@/components/commerce/product-tile";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { EmptyState } from "@/components/ui/states";
import type { UiCommand } from "@/lib/ai/ui-commands";
import { money } from "@/lib/commerce/money";
import { SPECIMEN_CATALOG } from "@/lib/specimen/catalog";

/**
 * Spotlight prototype (docs/PLAN.md Phase 2, step 6)
 *
 * A real listing wired to the real command bus. The point is to prove the
 * interaction before any of it depends on a model: the same `UiCommand` objects
 * the Concierge will emit in Phase 6 are dispatched here by buttons, run through
 * the same validation, the same Spotlight and the same undo.
 *
 * The products are genuine catalogue photography from the ABO dataset, so the
 * plinth treatment, the grid rhythm and the FLIP reflow are being judged on the
 * kind of images the shop will actually carry.
 */

const CATEGORIES = [...new Set(SPECIMEN_CATALOG.map((p) => p.category))].sort();

const CATEGORY_LABELS = Object.fromEntries(
  SPECIMEN_CATALOG.map((p) => [p.category, p.categoryLabel]),
);

type Filters = { category: string[]; maxCents: number | null };

const NO_FILTERS: Filters = { category: [], maxCents: null };

export function SpotlightDemo() {
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);

  /**
   * How this page performs each command. The executor captures the state
   * *before* it changes and hands back a closure that restores it — that is the
   * whole undo mechanism, and it is why undo is reliable rather than a guess at
   * the inverse action.
   */
  const executors = useMemo<Executors>(
    () => ({
      set_filters: (command) => {
        if (command.type !== "set_filters") return;

        const previous = filters;
        const category = command.filters["category"] ?? previous.category;
        const priceBand = command.filters["price"]?.[0];
        const maxCents =
          priceBand === undefined
            ? previous.maxCents
            : priceBand === ""
              ? null
              : Number.parseInt(priceBand, 10) * 100;

        setFilters({ category, maxCents });

        return {
          label: command.caption,
          run: () => setFilters(previous),
        };
      },
    }),
    [filters],
  );

  const toggleCategory = useCallback((category: string) => {
    setFilters((current) => ({
      ...current,
      category: current.category.includes(category)
        ? current.category.filter((value) => value !== category)
        : [...current.category, category],
    }));
  }, []);

  return (
    <SpotlightProvider executors={executors}>
      <DemoSurface
        filters={filters}
        onToggleCategory={toggleCategory}
        onReset={() => setFilters(NO_FILTERS)}
      />
    </SpotlightProvider>
  );
}

function DemoSurface({
  filters,
  onToggleCategory,
  onReset,
}: {
  filters: Filters;
  onToggleCategory: (category: string) => void;
  onReset: () => void;
}) {
  const { run, stop, isBusy } = useSpotlight();

  const visible = SPECIMEN_CATALOG.filter((product) => {
    if (filters.category.length > 0 && !filters.category.includes(product.category)) {
      return false;
    }
    if (filters.maxCents !== null && product.priceCents > filters.maxCents) return false;
    return true;
  });

  const dispatch = useCallback(
    (commands: UiCommand[]) => {
      void run(commands);
    },
    [run],
  );

  // Two products the scripted sequences point at, chosen from the live data so
  // the demo cannot drift out of sync with the catalogue.
  const lamp = SPECIMEN_CATALOG.find((p) => p.category === "lighting");
  const seat = SPECIMEN_CATALOG.find((p) => p.category === "seating");

  return (
    <div className="flex flex-col gap-8 lg:flex-row lg:items-start">
      {/* ---- The listing the Concierge operates ---- */}
      <div className="min-w-0 flex-1">
        <div
          data-agent-id="filter:category"
          className="border-hairline flex flex-wrap items-center gap-2 border-b pb-4"
        >
          <span className="text-slate mr-1 text-sm">Category</span>
          {CATEGORIES.map((category) => (
            <Chip
              key={category}
              selected={filters.category.includes(category)}
              onToggle={() => onToggleCategory(category)}
              count={SPECIMEN_CATALOG.filter((p) => p.category === category).length}
            >
              {CATEGORY_LABELS[category]}
            </Chip>
          ))}
          {filters.maxCents !== null ? (
            <Chip selected>under €{filters.maxCents / 100}</Chip>
          ) : null}
        </div>

        <div className="mt-6 grid grid-cols-2 gap-x-4 gap-y-8 md:grid-cols-3">
          <AnimatePresence mode="popLayout">
            {visible.map((product, index) => (
              // `layout` gives the FLIP reflow the design asks for when filters
              // change: tiles slide to their new positions instead of the grid
              // snapping.
              <motion.div
                key={product.id}
                layout
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.96 }}
                transition={{ duration: 0.28, ease: [0.2, 0, 0, 1] }}
              >
                <ProductTile
                  href="#specimen"
                  agentId={`product:${product.id}`}
                  title={product.title}
                  brand={product.brand}
                  price={money(product.priceCents)}
                  media={<ProductImage image={specimenImage(product)!} loading={index < 3 ? "fold" : "lazy"} />}
                  mediaHover={
                    product.hoverImage === null ? undefined : (
                      <ProductImage image={specimenImage(product, "hover")!} decorative />
                    )
                  }
                />
              </motion.div>
            ))}
          </AnimatePresence>
        </div>

        {visible.length === 0 ? (
          <EmptyState
            title="Nothing matches those filters"
            description="Try a wider price range, or clear the category filter to see the whole collection."
            action={
              <Button variant="secondary" onClick={onReset}>
                Clear filters
              </Button>
            }
          />
        ) : null}
      </div>

      {/* ---- A stand-in for the Concierge dock ---- */}
      <aside
        data-spotlight-source
        className="border-hairline bg-glass w-full shrink-0 rounded-sheet border p-5 lg:sticky lg:top-6 lg:w-[360px]"
      >
        <div className="border-hairline flex items-center justify-between border-b pb-3">
          <LumenPresence state={isBusy ? "acting" : "idle"} />
          {isBusy ? (
            <button
              type="button"
              onClick={stop}
              className="text-dusk cursor-pointer text-sm underline underline-offset-4"
            >
              Stop
            </button>
          ) : null}
        </div>

        <p className="text-slate mt-4 text-sm">
          These buttons send the same typed commands the Concierge will send in
          Phase 6. Watch the light, then undo what it did.
        </p>

        <div className="mt-4 flex flex-col gap-2">
          <Button
            size="sm"
            variant="secondary"
            aria-disabled={isBusy}
            onClick={() =>
              dispatch([
                {
                  type: "set_filters",
                  agentId: "filter:category",
                  filters: { category: ["lighting"] },
                  caption: "Filtering to lighting",
                },
              ])
            }
          >
            Show me lighting
          </Button>

          <Button
            size="sm"
            variant="secondary"
            aria-disabled={isBusy}
            onClick={() =>
              dispatch([
                {
                  type: "set_filters",
                  agentId: "filter:category",
                  filters: { category: [], price: ["200"] },
                  caption: "Showing everything under €200",
                },
              ])
            }
          >
            Everything under €200
          </Button>

          <Button
            size="sm"
            variant="secondary"
            aria-disabled={isBusy}
            onClick={() =>
              seat === undefined
                ? undefined
                : dispatch([
                    {
                      type: "highlight",
                      agentId: `product:${seat.id}`,
                      caption: `This is the ${seat.title.toLowerCase()}`,
                    },
                  ])
            }
          >
            Point at one product
          </Button>

          <Button
            size="sm"
            aria-disabled={isBusy}
            onClick={() =>
              lamp === undefined || seat === undefined
                ? undefined
                : dispatch([
                    {
                      type: "set_filters",
                      agentId: "filter:category",
                      filters: { category: ["lighting", "seating"], price: ["600"] },
                      caption: "Narrowing to seating and lighting under €600",
                    },
                    {
                      type: "highlight",
                      agentId: `product:${lamp.id}`,
                      caption: `The ${lamp.title.toLowerCase()} fits your budget`,
                    },
                    {
                      type: "highlight",
                      agentId: `product:${seat.id}`,
                      caption: "This chair pairs with it",
                    },
                  ])
            }
          >
            Run a three-step sequence
          </Button>
        </div>

        <p className="text-slate mt-3 text-xs">
          Press Esc to skip the animation. Clicking anywhere stops the Concierge.
        </p>

        <div className="border-hairline mt-5 border-t pt-4">
          <ActionTimeline />
        </div>
      </aside>
    </div>
  );
}
