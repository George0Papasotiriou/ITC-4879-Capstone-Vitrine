/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Dashboard charts drawn on the server: a bar per day as SVG, and tables whose rows carry their own bar.
 */

import type { ReactNode } from "react";

import { barLayout, niceTicks } from "@/lib/admin/chart";
import { cn } from "@/lib/ui/cn";

/**
 * No chart library and no JavaScript in the browser (docs/adr/018): the SVG is
 * written here from the numbers, in the design tokens' colours, and every
 * chart has the same figures as a table for screen readers and for the report.
 */

/** The bars' own coordinate space; the SVG is stretched to its box, so only proportions matter. */
const WIDTH = 1000;
const HEIGHT = 100;

export function DayBars({
  data,
  label,
  formatValue,
  formatDay,
  tableCaption,
  columns,
}: {
  data: readonly { day: string; value: number }[];
  /** What the picture shows, for screen readers. */
  label: string;
  formatValue: (value: number) => string;
  formatDay: (day: string) => string;
  tableCaption: string;
  columns: [string, string];
}) {
  const max = Math.max(0, ...data.map((entry) => entry.value));
  const ticks = niceTicks(max);
  const top = ticks.at(-1)!;
  const bars = barLayout(
    data.map((entry) => entry.value),
    { width: WIDTH, height: HEIGHT, top },
  );
  // First, middle and last day under the axis: enough to read the dates without crowding.
  const middle = data[Math.floor((data.length - 1) / 2)];

  return (
    <figure className="flex flex-col gap-3">
      {/*
        Bars and grid lines are an SVG stretched to the box; the labels are
        HTML placed by percentage, so text stays at the page's size on any
        screen instead of scaling with the drawing.
      */}
      <div role="img" aria-label={label} className="pt-2">
        <div className="relative h-48 pl-16">
          {ticks.map((tick) => (
            <span
              key={tick}
              className="text-slate tabular absolute left-0 w-14 -translate-y-1/2 text-right text-xs"
              style={{ top: `${(1 - tick / top) * 100}%` }}
              aria-hidden="true"
            >
              {formatValue(tick)}
            </span>
          ))}
          <svg
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            preserveAspectRatio="none"
            className="h-full w-full overflow-visible"
            aria-hidden="true"
          >
            {ticks.map((tick) => {
              const y = HEIGHT - (tick / top) * HEIGHT;
              return (
                <line
                  key={tick}
                  x1={0}
                  x2={WIDTH}
                  y1={y}
                  y2={y}
                  className="stroke-hairline"
                  strokeWidth={1}
                  vectorEffect="non-scaling-stroke"
                />
              );
            })}
            {bars.map((bar, index) => (
              <rect
                key={data[index]!.day}
                x={bar.x}
                y={bar.y}
                width={bar.width}
                height={bar.height}
                className="fill-dusk"
              >
                <title>{`${formatDay(data[index]!.day)}: ${formatValue(data[index]!.value)}`}</title>
              </rect>
            ))}
          </svg>
        </div>
        <div
          className="text-slate mt-2 flex justify-between pl-16 text-xs"
          aria-hidden="true"
        >
          <span>{data[0] === undefined ? null : formatDay(data[0].day)}</span>
          <span>
            {middle === undefined || data.length < 3
              ? null
              : formatDay(middle.day)}
          </span>
          <span>
            {data.at(-1) === undefined ? null : formatDay(data.at(-1)!.day)}
          </span>
        </div>
      </div>
      <details className="text-sm">
        <summary className="text-slate cursor-pointer">{tableCaption}</summary>
        <div className="mt-2 max-h-72 overflow-y-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-slate text-left">
                <th scope="col" className="py-1 pr-4 font-medium">
                  {columns[0]}
                </th>
                <th scope="col" className="py-1 text-right font-medium">
                  {columns[1]}
                </th>
              </tr>
            </thead>
            <tbody>
              {data.map((entry) => (
                <tr key={entry.day} className="border-hairline border-t">
                  <td className="tabular py-1 pr-4">{formatDay(entry.day)}</td>
                  <td className="tabular py-1 text-right">
                    {formatValue(entry.value)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}

export type ShareRow = {
  key: string;
  label: ReactNode;
  value: number;
  cells: ReactNode[];
};

/**
 * A table whose first column carries a bar in proportion to `value`, so the
 * table is the chart: one reading for sighted and screen-reader users alike.
 */
export function ShareTable({
  caption,
  columns,
  rows,
  agentId,
}: {
  caption: string;
  columns: string[];
  rows: readonly ShareRow[];
  agentId?: string;
}) {
  const max = Math.max(1, ...rows.map((row) => row.value));
  return (
    // Its own scroll box: a wide table scrolls on a phone instead of widening the page.
    <div className="-mx-1 overflow-x-auto px-1">
      <table className="w-full text-sm" data-agent-id={agentId}>
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="text-slate text-left">
            {columns.map((column, index) => (
              <th
                key={column}
                scope="col"
                className={cn(
                  "py-2 font-medium",
                  index === 0 ? "pr-4" : "pl-4 text-right",
                )}
              >
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className="border-hairline border-t">
              <th scope="row" className="py-2 pr-4 text-left font-normal">
                <span className="block">{row.label}</span>
                <span
                  className="bg-plinth mt-1.5 block h-1.5 w-full overflow-hidden rounded-full"
                  aria-hidden="true"
                >
                  <span
                    className="bg-dusk block h-full rounded-full"
                    style={{
                      width: `${(Math.max(0, row.value) / max) * 100}%`,
                    }}
                  />
                </span>
              </th>
              {row.cells.map((cell, index) => (
                <td
                  key={index}
                  className="tabular py-2 pl-4 text-right align-top whitespace-nowrap"
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Stat({
  label,
  value,
  note,
  agentId,
}: {
  label: string;
  value: string;
  note?: string;
  agentId?: string;
}) {
  return (
    <div className="flex flex-col gap-1 p-5" data-agent-id={agentId}>
      <dt className="text-slate text-sm">{label}</dt>
      <dd className="font-display tabular text-2xl">{value}</dd>
      {note === undefined ? null : (
        <dd className="text-slate text-xs">{note}</dd>
      )}
    </div>
  );
}

/** `id` names the heading; titles are translated, so they cannot make ids. */
export function Panel({
  id,
  title,
  children,
  className,
  lede,
}: {
  id: string;
  title: string;
  children: ReactNode;
  className?: string;
  lede?: string;
}) {
  return (
    <section
      aria-labelledby={id}
      className={cn("flex min-w-0 flex-col gap-4", className)}
      data-agent-id={`dashboard:${id}`}
    >
      <div>
        <h2 id={id} className="font-display text-xl">
          {title}
        </h2>
        {lede === undefined ? null : (
          <p className="text-slate mt-1 text-sm">{lede}</p>
        )}
      </div>
      {children}
    </section>
  );
}
