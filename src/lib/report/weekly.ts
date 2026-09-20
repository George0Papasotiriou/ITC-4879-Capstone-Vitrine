/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * The weekly report: the week's figures laid out on A4, and the summary stored beside the file.
 */

import type { DashboardOverview } from "@/lib/admin/dashboard-store";
import { A4, INK, PdfDocument } from "@/lib/report/pdf";

/**
 * The weekly report (docs/adr/020).
 *
 * Every figure comes from the same store the dashboards read, so the PDF and
 * the screen cannot disagree; nothing is recomputed here. The layout flows
 * down the page and starts a new one when it runs out of room, so a week with
 * many products does not fall off the bottom.
 *
 * It is written in English: the standard PDF fonts cannot show Greek without
 * an embedded font, and the report is an internal document. The email that
 * carries it is in the reader's language.
 */

export type AiSpendSummary = {
  byFeature: { feature: string; calls: number; costMicros: number; inputTokens: number; outputTokens: number; unpriced: number }[];
  totalMicros: number;
  calls: number;
  demoCalls: number;
  unpriced: number;
};

export type SupportSummary = {
  opened: number;
  answered: number;
  lateFirstReplies: number;
  medianFirstReplyMinutes: number | null;
  csat: { count: number; average: number | null };
  byTopic: { topic: string; count: number }[];
};

export type WeeklyReportInput = {
  /** The days the report covers, inclusive, as YYYY-MM-DD. */
  period: { start: string; end: string };
  generatedAt: Date;
  overview: DashboardOverview;
  ai: AiSpendSummary;
  /** The support desk, when there is one to report on. */
  support?: SupportSummary;
};

/** What is stored in the `reports` row and read back by the admin page and the email. */
export type WeeklyReportSummary = {
  salesCents: number;
  ticketsOpened: number;
  csatAverage: number | null;
  orders: number;
  refundsCents: number;
  returnsRequested: number;
  reviewsPublished: number;
  searches: number;
  zeroResultShare: number | null;
  aiMicros: number;
  aiCalls: number;
};

const MARGIN = 56;
const BOTTOM = A4.height - MARGIN;
const RIGHT = A4.width - MARGIN;

const euros = new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR" });
const plain = new Intl.NumberFormat("en-IE");

export const money = (cents: number) => euros.format(cents / 100);
const micros = (value: number) => (value === 0 ? euros.format(0) : euros.format(Math.round(value / 100) / 10_000));
const percent = (value: number | null) => (value === null ? "-" : `${(value * 100).toFixed(1)}%`);
const day = (value: string) => new Date(`${value}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

/** Words a reader knows, for the feature names recorded with each AI call. */
const FEATURE_LABELS: Record<string, string> = {
  concierge: "Concierge",
  support_chat: "Support chat",
  support_draft: "Support drafts",
  voice: "Voice",
  embedding: "Embeddings",
  snap: "Search by photo",
  try_on: "Try-on",
  animate: "Animate me",
  capsule_image: "Capsule photography",
  translation: "Greek copy",
};

/** A cursor down the page that starts a new one before anything falls off it. */
class Flow {
  y = MARGIN + 40;

  constructor(private readonly pdf: PdfDocument) {}

  /** Makes sure `height` points are left, and returns the top of that space. */
  room(height: number): number {
    if (this.y + height > BOTTOM) {
      this.pdf.addPage();
      this.y = MARGIN + 20;
    }
    const top = this.y;
    this.y += height;
    return top;
  }

  heading(title: string): void {
    const top = this.room(30);
    this.pdf.text(title, MARGIN, top + 12, { font: "sansBold", size: 13 });
    this.pdf.line(MARGIN, top + 20, RIGHT, top + 20);
  }

  /** A label and its figure, the figure right-aligned so a column of them lines up. */
  row(label: string, value: string, { note = null }: { note?: string | null } = {}): void {
    const top = this.room(18);
    this.pdf.text(label, MARGIN, top + 12, { size: 10 });
    this.pdf.textRight(value, RIGHT, top + 12, { size: 10 });
    if (note !== null) {
      const noteTop = this.room(12);
      this.pdf.text(note, MARGIN, noteTop + 8, { size: 8, color: INK.slate });
    }
  }

  /** A table row: one label and up to three figures in fixed columns. */
  cells(label: string, values: readonly string[], { bold = false }: { bold?: boolean } = {}): void {
    const top = this.room(16);
    const font = bold ? "sansBold" : "sans";
    const width = 78;
    const labelWidth = RIGHT - MARGIN - width * values.length - 8;
    this.pdf.text(clip(label, labelWidth, 10), MARGIN, top + 11, { size: 10, font });
    values.forEach((value, index) => {
      this.pdf.textRight(value, RIGHT - width * (values.length - 1 - index), top + 11, { size: 9.5, font: bold ? "sansBold" : "mono" });
    });
  }

  gap(height = 14): void {
    this.room(height);
  }
}

/** A title cut to the room it has, with a full stop's worth of warning that it was cut. */
function clip(value: string, width: number, size: number): string {
  const max = Math.max(4, Math.floor(width / (size * 0.52)));
  return value.length <= max ? value : `${value.slice(0, max - 1).trimEnd()}...`;
}

/** The bars for the week's sales, drawn as rectangles with the days under them. */
function salesChart(pdf: PdfDocument, flow: Flow, data: readonly { day: string; value: number }[]): void {
  if (data.length === 0) return;
  const height = 110;
  const top = flow.room(height + 8);
  const max = Math.max(1, ...data.map((entry) => entry.value));
  const plotHeight = height - 28;
  const step = (RIGHT - MARGIN) / data.length;
  const barWidth = Math.max(4, Math.min(28, step - 8));

  pdf.line(MARGIN, top + plotHeight, RIGHT, top + plotHeight, { color: INK.hairline });
  data.forEach((entry, index) => {
    const barHeight = (entry.value / max) * (plotHeight - 14);
    const x = MARGIN + step * index + (step - barWidth) / 2;
    if (barHeight > 0) pdf.rect(x, top + plotHeight - barHeight, barWidth, barHeight, INK.dusk);
    // Only a few labels, so they never collide: the first, the middle and the last.
    if (index === 0 || index === data.length - 1 || index === Math.floor((data.length - 1) / 2)) {
      pdf.text(day(entry.day), x - 8, top + plotHeight + 12, { size: 8, color: INK.slate });
    }
  });
  pdf.text(`Highest day ${money(max)}`, MARGIN, top + plotHeight + 24, { size: 8, color: INK.slate });
}

/** The figures stored with the file, so the admin page lists a report without opening it. */
export function summarize({ overview, ai, support }: Pick<WeeklyReportInput, "overview" | "ai" | "support">): WeeklyReportSummary {
  return {
    salesCents: overview.sales.grossCents,
    ticketsOpened: support?.opened ?? 0,
    csatAverage: support?.csat.average ?? null,
    orders: overview.sales.orders,
    refundsCents: overview.sales.refundsCents,
    returnsRequested: overview.returns.requested,
    reviewsPublished: overview.reviews.published,
    searches: overview.searches.total,
    zeroResultShare: overview.searches.zeroShare,
    aiMicros: ai.totalMicros,
    aiCalls: ai.calls,
  };
}

/** The report itself. */
export function weeklyReportPdf({ period, generatedAt, overview, ai, support }: WeeklyReportInput): Uint8Array {
  const pdf = new PdfDocument();
  const flow = new Flow(pdf);

  pdf.text("Vitrine", MARGIN, MARGIN + 6, { font: "sansBold", size: 18 });
  pdf.text(`Weekly report, ${day(period.start)} to ${day(period.end)}`, MARGIN, MARGIN + 24, { size: 11, color: INK.slate });
  pdf.textRight(generatedAt.toISOString().slice(0, 16).replace("T", " ") + " UTC", RIGHT, MARGIN + 24, { size: 8, color: INK.slate });

  flow.heading("Sales");
  flow.row("Gross sales, paid orders", money(overview.sales.grossCents));
  flow.row("Refunded", `${money(overview.sales.refundsCents)} (${plain.format(overview.sales.refunds)})`);
  flow.row("Net", money(overview.sales.netCents));
  flow.row("Orders paid", plain.format(overview.sales.orders));
  flow.row("Average order", overview.sales.orders === 0 ? "-" : money(overview.sales.averageCents));
  flow.row("VAT charged", money(overview.sales.vatCents));
  flow.gap(6);
  salesChart(pdf, flow, overview.salesByDay);

  flow.heading("From cart to delivery");
  for (const step of overview.funnel) {
    flow.row(FUNNEL_LABELS[step.key] ?? step.key, `${plain.format(step.count)}   ${percent(step.fromPrevious)}`);
  }

  if (overview.topProducts.length > 0) {
    flow.heading("Best sellers");
    flow.cells("Piece", ["Units", "Sales"], { bold: true });
    for (const product of overview.topProducts.slice(0, 8)) {
      flow.cells(product.title, [plain.format(product.units), money(product.revenueCents)]);
    }
  }

  flow.heading("Returns and reviews");
  flow.row("Returns requested", plain.format(overview.returns.requested), { note: `Deliveries in the period: ${plain.format(overview.returns.deliveries)}` });
  flow.row("Return rate", percent(overview.returns.rate));
  flow.row("Reviews published", plain.format(overview.reviews.published));
  flow.row("Average rating", overview.reviews.average === null ? "-" : overview.reviews.average.toFixed(1));
  flow.row("Reviews hidden", plain.format(overview.reviews.hidden));

  flow.heading("Search");
  flow.row("Searches", plain.format(overview.searches.total));
  flow.row("Found nothing", `${plain.format(overview.searches.zeroResults)}   ${percent(overview.searches.zeroShare)}`);
  if (overview.searches.zero.length > 0) {
    flow.gap(4);
    flow.cells("Searches that found nothing", ["Times"], { bold: true });
    for (const search of overview.searches.zero.slice(0, 6)) flow.cells(search.query, [plain.format(search.count)]);
  }

  flow.heading("AI");
  flow.row("Spent on AI", micros(ai.totalMicros), { note: ai.unpriced === 0 ? null : `${plain.format(ai.unpriced)} calls used a model whose price is not confirmed.` });
  flow.row("Calls", plain.format(ai.calls));
  flow.row("Demo answers (free)", plain.format(ai.demoCalls));
  if (ai.byFeature.length > 0) {
    flow.gap(4);
    flow.cells("Feature", ["Calls", "Cost"], { bold: true });
    for (const feature of ai.byFeature) {
      flow.cells(FEATURE_LABELS[feature.feature] ?? feature.feature, [plain.format(feature.calls), micros(feature.costMicros)]);
    }
  }

  if (support !== undefined && support.opened > 0) {
    flow.heading("Support");
    flow.row("Questions asked", plain.format(support.opened));
    flow.row("Answered", `${plain.format(support.answered)}   ${support.lateFirstReplies === 0 ? "all within a day" : `${plain.format(support.lateFirstReplies)} late`}`);
    flow.row("Median first reply", support.medianFirstReplyMinutes === null ? "-" : `${plain.format(support.medianFirstReplyMinutes)} min`);
    flow.row("Satisfaction", support.csat.average === null ? "-" : `${support.csat.average.toFixed(1)} of 5 (${plain.format(support.csat.count)})`);
    if (support.byTopic.length > 0) {
      flow.gap(4);
      flow.cells("Topic", ["Questions"], { bold: true });
      for (const topic of support.byTopic) flow.cells(TOPIC_LABELS[topic.topic] ?? topic.topic, [plain.format(topic.count)]);
    }
  }

  if (overview.lowStock.items.length > 0) {
    flow.heading("Running low");
    flow.cells("Piece", ["SKU", "Left"], { bold: true });
    for (const item of overview.lowStock.items.slice(0, 8)) flow.cells(item.title, [item.sku, plain.format(item.stock)]);
  }

  flow.gap(20);
  const footer = flow.room(14);
  pdf.text("Vitrine is a student project (ITC 4949, American College of Greece). Figures are read from the shop's database.", MARGIN, footer + 9, {
    size: 8,
    color: INK.slate,
  });

  return pdf.save();
}

const TOPIC_LABELS: Record<string, string> = {
  delivery: "Delivery",
  returns: "Returns",
  product: "A piece",
  account: "Account",
  payment: "Payment",
  other: "Something else",
};

const FUNNEL_LABELS: Record<string, string> = {
  carts: "Carts started",
  placed: "Orders placed",
  paid: "Orders paid",
  delivered: "Orders delivered",
};
