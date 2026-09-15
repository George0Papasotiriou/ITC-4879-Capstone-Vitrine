/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Design system specimen page showing tokens, typography and every UI component.
 */

import type { Metadata } from "next";
import type { ReactNode } from "react";

import { OverlaysDemo } from "@/app/[locale]/design/overlays-demo";
import { SpotlightDemo } from "@/app/[locale]/design/spotlight-demo";
import { WindowLight } from "@/app/[locale]/design/window-light";
import { ProductImage } from "@/components/commerce/product-image";
import { specimenImage } from "@/lib/specimen/images";
import { ProductTile } from "@/components/commerce/product-tile";
import { Button, ButtonLink, IconButton } from "@/components/ui/button";
import { CapabilityMark } from "@/components/ui/capability-mark";
import { Chip } from "@/components/ui/chip";
import { Field } from "@/components/ui/field";
import { Price } from "@/components/ui/price";
import { Rating } from "@/components/ui/rating";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/states";
import { money } from "@/lib/commerce/money";
import { ATTRIBUTION, SPECIMEN_CATALOG } from "@/lib/specimen/catalog";

/** Two products for the tile section: one seat, one light. */
const SHOWCASE = [
  SPECIMEN_CATALOG.find((p) => p.category === "seating"),
  SPECIMEN_CATALOG.find((p) => p.category === "lighting"),
].filter((product) => product !== undefined);

/**
 * The design specimen (docs/PLAN.md Phase 2, step 1).
 *
 * Built before any real page, so the identity can be judged as a system rather
 * than argued about one screen at a time. George approves the direction here;
 * ADR-005 records what was approved.
 *
 * Not linked from navigation, and excluded from search engines.
 */
export const metadata: Metadata = {
  title: "Design specimen",
  robots: { index: false, follow: false },
};

export default function DesignPage() {
  return (
    // The specimen is an internal design document written in English. Marking
    // it `lang="en"` means a screen reader on the Greek storefront pronounces
    // it as English rather than reading English words with Greek phonetics.
    <main lang="en" className="mx-auto w-full max-w-[1440px] px-6 py-16 md:px-10">
      <header className="max-w-[62ch]">
        <p className="text-slate text-sm">Vitrine design system</p>
        <h1 className="font-display mt-3 text-4xl leading-[1.05]">
          A shop window at dusk
        </h1>
        <p className="mt-6 text-lg text-slate">
          The street is darkening, the objects behind the glass are lit, and the
          light itself draws your eye. The interface is quiet glass, products
          stand on plinths, and the Concierge is the light. All the boldness is
          spent there; everything else stays disciplined.
        </p>
      </header>

      <Section
        title="Colour"
        note="Five core values and three supporting ones. Tailwind's default palette is removed from the build, so nothing outside this list can reach a component."
      >
        <div className="grid grid-cols-2 gap-px md:grid-cols-4 lg:grid-cols-5">
          {/* Glass is the page background, so its swatch needs a hairline to
              exist at all — a good reminder that it is a ground, not a fill. */}
          <Swatch
            name="Glass"
            hex="#F2F3F1"
            className="bg-glass border-hairline border"
            role="Page background"
          />
          <Swatch name="Plinth" hex="#E4E6E2" className="bg-plinth" role="Display surface" />
          <Swatch name="Slate" hex="#5B6270" className="bg-slate" dark role="Secondary text · 5.5:1" />
          <Swatch name="Dusk" hex="#1D2330" className="bg-dusk" dark role="Text, buttons, stage · 14:1" />
          <Swatch name="Lumen" hex="#F5B544" className="bg-lumen" role="The Concierge only" />
          {/* Mist is designed to sit on Dusk; slate on mist would be under 3:1,
              so its own caption uses Dusk. */}
          <Swatch name="Mist" hex="#A7AEBB" className="bg-mist" onMist role="Secondary on Dusk · 7:1" />
          <Swatch name="Danger" hex="#B3261E" className="bg-danger" dark role="5.9:1 on Glass" />
          <Swatch name="Success" hex="#1E7B4F" className="bg-success" dark role="4.7:1 on Glass" />
        </div>

        <p className="text-slate mt-6 max-w-[70ch] text-sm">
          Lumen is semantic, not decorative. It marks the Concierge&rsquo;s
          presence and its actions, and appears nowhere else — which is what
          makes it readable as &ldquo;the AI is doing something&rdquo; rather
          than as a brand colour.
        </p>
      </Section>

      <Section
        title="Type"
        note="Commissioner, a variable humanist sans with full Greek support by Kostas Bartsokas. One family, two roles: the flare axis separates display from text."
      >
        <div className="flex flex-col gap-8">
          <div className="border-hairline border-b pb-8">
            <p className="text-slate mb-4 text-sm">Display · FLAR 100 · weight 560 · tracking −1%</p>
            <p className="font-display text-5xl leading-[1.02]">Evening light</p>
            <p className="font-display mt-4 text-3xl leading-[1.1]">A reading corner for long evenings</p>
            <p className="font-display mt-4 text-2xl">Μια γωνιά για ανάγνωση</p>
          </div>

          <div>
            <p className="text-slate mb-4 text-sm">Text and UI · FLAR 0 · weights 400 and 500 · line height 1.55</p>
            <p className="max-w-[68ch] text-lg">
              Lines stay under seventy characters, because a line you have to
              hunt back to the start of is a line you read twice.
            </p>
            <p className="mt-4 max-w-[68ch]" lang="el">
              Τα ελληνικά δεν γράφονται ποτέ με κεφαλαία: τα κεφαλαία χάνουν τους
              τόνους και το κείμενο γίνεται δυσανάγνωστο.
            </p>
            <p className="text-slate mt-4 text-sm">
              Prices use tabular numerals so a column of them aligns:{" "}
              <span className="tabular text-dusk">€640.00 · €149.00 · €42.00</span>
            </p>
          </div>
        </div>
      </Section>

      <Section
        title="Buttons"
        note="Dusk fill for primary, a hairline outline for secondary, text only for tertiary. Labels are verbs in sentence case. Nothing lifts on hover."
      >
        <div className="flex flex-wrap items-center gap-3">
          <Button>Add to cart</Button>
          <Button variant="secondary">See it in your room</Button>
          <Button variant="tertiary">Compare</Button>
          <Button variant="danger">Cancel order</Button>
          <Button disabled>Out of stock</Button>
          <ButtonLink href="#specimen" variant="secondary">
            Browse the collection
          </ButtonLink>
          <IconButton label="Open cart">
            <CartGlyph />
          </IconButton>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button size="sm">Small</Button>
          <Button size="md">Medium, 44px</Button>
          <Button size="lg">Large</Button>
        </div>
      </Section>

      <Section
        title="Controls"
        note="Filter chips are one of only two fully round shapes in the system. Fields carry a real label, never a placeholder standing in for one."
      >
        <div className="flex flex-wrap gap-2">
          <Chip selected>oak</Chip>
          <Chip count={24}>walnut</Chip>
          <Chip count={11}>linen</Chip>
          <Chip disabled>marble</Chip>
          <CapabilityMark>3D</CapabilityMark>
          <CapabilityMark>Try on</CapabilityMark>
        </div>

        <div className="mt-8 grid max-w-3xl gap-6 md:grid-cols-2">
          <Field label="Email" type="email" placeholder="you@example.com" hint="We only use this for order updates." />
          <Field label="Postcode" defaultValue="12ab" error="That postcode has too few digits. Greek postcodes have five." />
        </div>
      </Section>

      <Section
        title="Overlays, choices and views"
        note="Dialog, sheet, select, checkbox, radio group, tabs, tooltip and toast. Each is an accessible primitive restyled to the tokens: focus is trapped and returned, Esc closes, arrow keys move within a group, and state is carried by a mark as well as by colour."
      >
        <OverlaysDemo />
      </Section>

      <Section
        title="Product tiles"
        note="A plinth, not a card: no border, no shadow, nothing lifts. The photograph blends into the surface with multiply, so a white studio background dissolves instead of forming a box. Hover a tile to see the second angle."
      >
        <div className="grid max-w-4xl grid-cols-2 gap-x-4 gap-y-8 md:grid-cols-3">
          {SHOWCASE.map((product, index) => (
            <ProductTile
              key={product.id}
              href="#specimen"
              title={product.title}
              brand={product.brand}
              price={money(product.priceCents)}
              // One capability mark per tile at most (4.4); these are the
              // Phase 9 and 10 features, shown here as the label they will use.
              capability={index === 0 ? "3D" : index === 1 ? "In your room" : undefined}
              media={<ProductImage image={specimenImage(product)!} loading={index === 0 ? "fold" : "lazy"} />}
              mediaHover={
                product.hoverImage === null ? undefined : (
                  <ProductImage image={specimenImage(product, "hover")!} decorative />
                )
              }
            />
          ))}
          <div className="flex flex-col gap-3">
            <Skeleton className="aspect-[4/5] w-full" />
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-4 w-4/5" />
            <Skeleton className="h-4 w-1/4" />
          </div>
        </div>

        <div className="mt-8 flex flex-wrap items-center gap-8">
          <Price amount={money(64000)} compareAt={money(79000)} size="lg" />
          <Price amount={money(14900)} size="lg" />
          <Rating value={4.6} count={38} />
          <Rating value={0} count={0} />
        </div>

        <p className="text-slate mt-8 max-w-[70ch] text-sm">
          {ATTRIBUTION} Prices are synthetic: the dataset carries none, so each
          is derived from the item id within a documented per-category band.
        </p>
      </Section>

      <Section
        title="Empty and error states"
        note="Both say what to do next. Errors say what happened and how to fix it, without apologising and without an exclamation mark."
      >
        <div className="grid max-w-5xl gap-8 md:grid-cols-2">
          <div className="border-hairline rounded-sheet border">
            <EmptyState
              title="No lamps under €20"
              description="The lowest-priced lamp in the collection is €42."
              action={<Button variant="secondary" size="sm">Show lamps under €50</Button>}
            />
          </div>
          <div className="border-hairline rounded-sheet border p-6">
            <ErrorState
              title="That card was declined"
              description="Your bank turned down the payment. Try a different card, or check with your bank and try again."
              action={<Button size="sm">Try another card</Button>}
            />
          </div>
        </div>
      </Section>

      <Section
        title="Motion, moment one: the window light"
        note="The only motion nobody triggers. It runs once on first load and settles within 1.2 seconds."
      >
        <WindowLight />
      </Section>

      <Section
        id="specimen"
        title="Motion, moment two: the Spotlight"
        note="The signature interaction. The light travels from the dock to whatever the Concierge is about to touch, names the action in plain words, performs it, and leaves an entry you can undo. These buttons emit the same typed commands the Concierge will send in Phase 6 — through the same validation and the same command bus."
      >
        <SpotlightDemo />
      </Section>

      <Section
        title="What this system avoids"
        note="Part 4.8, as a checklist. Each of these was a real temptation."
      >
        <ul className="text-slate grid max-w-4xl gap-2 md:grid-cols-2">
          {[
            "Cream backgrounds with serif display and terracotta accents",
            "Identical rounded cards with the same grey shadow",
            "Gradient washes and blurred glass panels as decoration",
            "ALL-CAPS eyebrow labels above every block",
            "Middle-dot meta strings: “Oak · 120 cm · In stock”",
            "Arrows and emoji inside button labels",
            "Fade-and-slide entrances on every section",
            "Countdown timers, fake scarcity, confetti, pre-ticked extras",
          ].map((item) => (
            <li key={item} className="flex gap-3">
              <span aria-hidden="true" className="text-hairline">—</span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </Section>
    </main>
  );
}

/* -------------------------------------------------------------------------- */

function Section({
  title,
  note,
  children,
  id,
}: {
  title: string;
  note?: string;
  children: ReactNode;
  id?: string;
}) {
  return (
    <section id={id} className="border-hairline mt-20 border-t pt-10 first:border-t-0">
      <h2 className="font-display text-2xl">{title}</h2>
      {note !== undefined ? (
        <p className="text-slate mt-3 max-w-[78ch]">{note}</p>
      ) : null}
      <div className="mt-8">{children}</div>
    </section>
  );
}

function Swatch({
  name,
  hex,
  role,
  className,
  dark = false,
  onMist = false,
}: {
  name: string;
  hex: string;
  role: string;
  className: string;
  /** The swatch is dark enough to need light text. */
  dark?: boolean;
  /** Mid-tone swatch: Dusk for both label and caption. */
  onMist?: boolean;
}) {
  /**
   * Captions use full-strength Glass or Dusk rather than Mist, Slate or an
   * opacity. Those secondary tones are specified against Glass and Dusk
   * (docs/PLAN.md 4.2) and drop below 4.5:1 when placed on Slate, Lumen,
   * Danger or Success — axe caught exactly that. Hierarchy here comes from
   * size, which costs no contrast.
   */
  const label = dark ? "text-glass" : "text-dusk";
  const caption = dark ? "text-glass" : onMist ? "text-dusk" : "text-dusk";

  return (
    <div className={`${className} flex min-h-36 flex-col justify-between p-4`}>
      <span className={`${label} font-medium`}>{name}</span>
      <span className={`${caption} text-xs`}>
        <span className="tabular block">{hex}</span>
        <span className="mt-1 block">{role}</span>
      </span>
    </div>
  );
}

function CartGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <path d="M3 4h2l2.4 11.2a1 1 0 0 0 1 .8h8.2a1 1 0 0 0 1-.8L19 7H6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="9.5" cy="19.5" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="16.5" cy="19.5" r="1.2" fill="currentColor" stroke="none" />
    </svg>
  );
}
