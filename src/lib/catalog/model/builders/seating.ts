/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Seating: accent chairs, wingbacks, barrel chairs, recliners, sofas, sectionals, dining and office chairs, stools, benches, ottomans.
 */

import { block, clamp, frameOf, legStyleOf, looksLikeWood, metalFrame, upholsteryOf, type Context } from "@/lib/catalog/model/context";
import { arcPath, bend, cushion, cylinder, extrude, lathe, roundedBox, roundedPolyline, superellipsePath, tube, type Tufting } from "@/lib/catalog/model/geometry";
import { metal, rubber, upholstery, type MaterialSpec } from "@/lib/catalog/model/materials";
import { compose, Mesh, rotationX, rotationZ, translation, type Mat4, type Vec2, type Vec3 } from "@/lib/catalog/model/mesh";
import { Build, buttons, castor, leg, nailheads, placeLeg, type LegStyle } from "@/lib/catalog/model/parts";

/**
 * docs/adr/058. Upholstered seating is built the way an upholsterer builds it:
 * a base frame on legs (or a skirt to the floor), a back at the rear, arms at
 * the sides, then the cushions — seat cushions between the arms, back
 * cushions leaning on the back — each a crowned cushion with rounded seams.
 * The listing's words choose the arm (track, rolled, pillow-topped, none), the
 * back (loose cushions, tight, button-tufted, channelled, a wrap-round barrel)
 * and the legs. Everything is placed from the piece's real width, depth and
 * height, and the final size is checked against the listing (index.ts).
 *
 * The front of every piece faces +z; x runs across its width.
 */

export function buildSeating(c: Context): Build {
  const { words } = c;
  const kind = c.facts.kind;
  if (kind === "BEAN_BAG_CHAIR" || words.has("bean bag", "beanbag")) return beanBag(c);
  if (words.has("adirondack")) return adirondack(c);
  if (words.has("chaise lounge", "chaise lounger", "sun lounger", "lounger") && (words.has("outdoor", "patio", "hardwood", "teak", "textilene", "pool") || words.material("wood"))) return outdoorChaise(c);
  if (kind === "OTTOMAN" || (words.has("ottoman", "pouf", "pouffe", "footstool", "foot stool", "hassock") && !words.has("sofa", "chair", "set"))) return ottoman(c);
  if (words.has("chaise", "daybed", "fainting couch") && kind !== "SOFA" && !words.has("sofa", "sectional")) return chaise(c);
  // Stacking, school and folding chairs are small hard chairs on four legs, however the listing files them.
  if (words.has("dining chair", "dining chairs", "side chair", "kitchen chair", "kitchen chairs", "stacking", "stackable chair", "classroom", "school chair", "folding chair")) return diningChair(c);
  if (kind === "STOOL_SEATING" || words.has("bar stool", "barstool", "barstools", "counter stool", "stool")) return stool(c);
  if ((kind === "BENCH" || words.has("bench")) && !words.has("bench seat", "sofa", "loveseat")) return bench(c);
  if (words.has("office", "desk chair", "task chair", "gaming", "executive", "computer chair", "on wheels", "with wheels", "ergonomic", "conference")) return officeChair(c);
  if (words.has("rocking", "rocker", "glider") && !words.has("recliner")) return rocker(c);
  if (kind === "SOFA" || words.has("sofa", "couch", "loveseat", "love seat", "settee", "sectional")) return sofa(c);
  if (words.has("dining", "kitchen", "bistro", "parsons", "windsor", "cafe", "farmhouse chair", "ladder back", "cross back")) return diningChair(c);
  return armchair(c);
}

// ─── Upholstered body ───────────────────────────────────────────────────────

type ArmStyle = "track" | "roll" | "pillow" | "slope" | "none";
type BackStyle = "cushions" | "tight" | "pillows";

type Body = {
  arms: ArmStyle;
  back: BackStyle;
  tufting: Tufting;
  seats: number;
  wings: boolean;
  skirt: boolean;
  rolledTop: boolean;
  nails: boolean;
  legStyle: LegStyle;
  /** Arm height as a share of the way from the seat to the top; 1 for a Chesterfield. */
  armRise: number;
  pillows: number;
  /** Which side a sectional's chaise is on (+1 right as you face it, −1 left), or none. */
  chaise: 1 | -1 | 0;
  /** Splay of tapered legs, radians. */
  splay: number;
  /** A tight seat: one firm upholstered block, no loose cushion (a slipper chair, a dining-height accent chair). */
  tightSeat: boolean;
  /** How much wider the back is at the top than at the seat, as a share: a scroll back flares. */
  flare: number;
};

function bodyFor(c: Context, defaults: Partial<Body> = {}): Body {
  const { words } = c;
  const chesterfield = words.has("chesterfield");
  const recliner = words.has("recliner", "reclining", "power lift", "lift chair", "rocker recliner");
  const armless = words.has("armless", "slipper", "no arms", "without arms");
  const rolled = chesterfield || words.has("roll arm", "rolled arm", "rolled arms", "english roll", "scroll arm", "charles of london", "lawson", "bridgewater");
  const tufted = chesterfield || words.has("tufted", "button tufted", "diamond tufted", "biscuit");
  const channel = words.has("channel", "channeled", "channelled", "channel tufted", "vertical channel", "pleated");
  const tightBack = tufted || channel || words.has("tight back", "low back", "bench seat") || defaults.back === "tight";
  const style = legStyleOf(c, recliner ? "block" : chesterfield ? "bun" : "tapered");
  const arms: ArmStyle = armless ? "none" : recliner ? "pillow" : rolled ? "roll" : words.has("slope arm", "sloped arm", "mid century", "midcentury") && !words.has("track arm") ? "slope" : "track";
  const spacing = clamp(c.size.w / 6, 0.1, 0.15);
  return {
    arms,
    back: recliner ? "pillows" : tightBack ? "tight" : "cushions",
    tufting: tufted ? { kind: "buttons", spacing, depth: 0.032 } : channel ? { kind: "channels", count: Math.max(3, Math.round(c.size.w / 0.12)), depth: 0.024 } : { kind: "none" },
    seats: 1,
    wings: words.has("wingback", "wing back", "wing chair", "wingchair"),
    skirt: words.has("skirt", "skirted", "slipcover", "slipcovered") || recliner,
    rolledTop: words.has("roll back", "rolled back", "camelback", "camel back") || (rolled && armless),
    nails: words.has("nailhead", "nail head", "nailheads", "studded", "nail trim"),
    legStyle: style,
    armRise: chesterfield ? 1 : recliner ? 0.48 : rolled ? 0.42 : 0.5,
    pillows: words.has("pillow", "pillows", "toss", "throw pillow") ? 2 : 0,
    chaise: 0,
    splay: style === "tapered" ? 0.1 : 0,
    tightSeat: armless && !words.has("cushion", "loose cushion"),
    flare: armless && (rolled || tufted) ? 0.1 : 0,
    ...defaults,
  };
}

/** Leg thickness by style, metres. */
const legThickness = (style: LegStyle) =>
  ({ tapered: 0.045, turned: 0.06, square: 0.05, block: 0.055, bun: 0.085, hairpin: 0.06, "metal-round": 0.028, "metal-square": 0.03, cabriole: 0.05 })[style];

/**
 * The upholstered body shared by armchairs, sofas and sectionals. The
 * footprint is the whole piece; returns nothing, adds its parts to `b`.
 */
function upholsteredBody(c: Context, b: Build, body: Body): void {
  const { w, d, h } = c.size;
  const skin = upholsteryOf(c);
  const frame = frameOf(c);
  const low = h < 0.62;
  const legH = body.skirt
    ? 0.018
    : body.legStyle === "bun"
      ? clamp(h * 0.09, 0.05, 0.08)
      : body.tightSeat
        ? clamp(h * 0.3, 0.14, 0.3)
        : clamp(h * 0.15, 0.08, body.legStyle === "tapered" ? 0.2 : 0.16);
  const seatTop = low ? h * 0.72 : clamp(h * 0.5, 0.38, 0.48);
  const seatT = body.tightSeat ? seatTop - legH : clamp(seatTop * 0.3, 0.08, 0.15);
  const deck = body.tightSeat ? legH : Math.max(legH + 0.06, seatTop - seatT);
  const backT = clamp(d * 0.2, 0.12, body.back === "pillows" ? 0.26 : 0.22);
  const armW = body.arms === "none" ? 0 : clamp(w * (body.arms === "pillow" ? 0.16 : 0.12), 0.08, body.arms === "pillow" ? 0.25 : 0.2);
  const armTop = body.armRise >= 1 ? h : clamp(seatTop + (h - seatTop) * body.armRise, seatTop + 0.1, h - 0.04);
  const rake = clamp((h - deck) * 0.08, 0.02, 0.06);
  const backZ = -d / 2;

  // The sectional's chaise: the main body is shallower, and one end runs forward to the full depth.
  const mainD = body.chaise !== 0 && d >= 1.25 ? clamp(d * 0.55, 0.85, 1.0) : d;
  const chaiseW = body.chaise !== 0 && mainD < d ? clamp(w * 0.32, 0.7, 0.95) : 0;
  const front = backZ + mainD;

  // Base frame, from the legs to the deck (a tight seat is its own base).
  const baseRadius = clamp((deck - legH) * 0.3, 0.012, 0.04);
  if (deck - legH > 0.01) block(b, skin, [0, (legH + deck) / 2, backZ + mainD / 2], [w, deck - legH, mainD], baseRadius);
  if (chaiseW > 0) {
    const cx = body.chaise * (w / 2 - chaiseW / 2);
    block(b, skin, [cx, (legH + deck) / 2, (front + d / 2) / 2 - 0.02], [chaiseW, deck - legH, d / 2 - front + 0.04], baseRadius);
  }

  // The back: a cushion facing forward, raked a little, its top rolled where the words say.
  const rollR = body.rolledTop ? backT * 0.55 : 0;
  const backH = h - deck - rollR;
  const back = cushion({ size: [w, backH, backT], radius: clamp(backT * 0.35, 0.02, 0.06), crown: body.back === "tight" ? 0.018 : 0.006, face: "front", tufting: body.back === "tight" ? body.tufting : { kind: "none" } });
  const rakeShear = (mesh: Mesh, bottom: number, height: number) => {
    for (let v = 0; v < mesh.vertexCount; v += 1) {
      const [x, y, z] = mesh.position(v);
      mesh.setPosition(v, [x, y, z - ((y - bottom) / height) * rake]);
    }
  };
  const backAt: Vec3 = [0, deck + backH / 2, backZ + backT / 2 + rake];
  // A scroll back flares wider towards the top; the listed width is the widest point, so the seat end is narrower.
  const flare = (mesh: Mesh) => {
    if (body.flare <= 0) return;
    for (let v = 0; v < mesh.vertexCount; v += 1) {
      const [x, y, z] = mesh.position(v);
      const t = Math.max(0, Math.min(1, (y - deck) / backH));
      mesh.setPosition(v, [x * (1 - body.flare + body.flare * t), y, z]);
    }
  };
  back.mesh.translate(backAt);
  rakeShear(back.mesh, deck, backH);
  flare(back.mesh);
  if (body.flare > 0) back.mesh.recomputeNormals();
  b.add(back.mesh, skin);
  if (back.buttons.length > 0) {
    const studs = buttons(back.buttons.map(({ position, normal }) => ({ position: [position[0] + backAt[0], position[1] + backAt[1], position[2] + backAt[2] - ((position[1] + backH / 2) / backH) * rake], normal })));
    flare(studs);
    b.add(studs, skin);
  }
  if (rollR > 0) {
    // The scroll: a roll along the top of the back, set back so it curls over the rear.
    const roll = cylinder(rollR, w - 0.01, { bevel: rollR * 0.5, segments: 28 });
    b.add(roll, skin, compose(translation([-(w - 0.01) / 2, h - rollR, backZ + backT / 2 - rake * 0.4]), rotationZ(-Math.PI / 2)));
  }

  // Wings: a curved panel each side, rising from the arm to near the top and reaching forward.
  if (body.wings && armW > 0) {
    const reach = clamp(mainD * 0.42, 0.25, 0.42);
    const outline: Vec2[] = [];
    // (z from the back, y from the deck) round the wing's side profile.
    const bottom = armTop - deck - 0.02;
    const top = h - deck - 0.02;
    const points: Vec2[] = [
      [0, bottom],
      [0, top],
      [reach * 0.55, top - 0.02],
      [reach, top - 0.12],
      [reach * 0.95, bottom + 0.06],
      [reach * 0.75, bottom],
    ];
    const smooth = roundedPolyline(points.map(([z, y]) => [z, y, 0] as Vec3).concat([[0, bottom, 0]]), 0.06, 6);
    for (const [z, y] of smooth.slice(0, -1)) outline.push([z, y]);
    const thickness = clamp(armW * 0.55, 0.05, 0.09);
    for (const side of [-1, 1] as const) {
      const wing = extrude(outline, { height: thickness, bevel: thickness * 0.45, bevelSegments: 4 });
      // Outline (X = z, Z = y), extruded along Y = x.
      const toPlace: Mat4 = [0, 0, 1, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1];
      b.add(wing, skin, compose(translation([side > 0 ? w / 2 - thickness : -w / 2, deck, backZ + backT * 0.4]), toPlace));
    }
  }

  // Arms.
  const armBack = backZ + backT * 0.5;
  const armFront = (side: -1 | 1) => (body.chaise === side && chaiseW > 0 ? d / 2 : front);
  if (armW > 0) {
    for (const side of [-1, 1] as const) {
      const length = armFront(side) - armBack;
      const zc = armBack + length / 2;
      if (body.arms === "roll") {
        const r = clamp(armW * 0.6, 0.05, 0.095);
        const bodyTop = armTop - r * 1.1;
        block(b, skin, [side * (w / 2 - armW / 2 - 0.004), (legH + bodyTop) / 2, zc], [armW - 0.008, bodyTop - legH, length], clamp(armW * 0.3, 0.015, 0.04));
        const roll = cylinder(r, length + 0.012, { bevel: r * 0.35, segments: 28 });
        b.add(roll, skin, compose(translation([side * (w / 2 - r), armTop - r, armBack - 0.004]), rotationX(Math.PI / 2)));
        // The scroll's face at the front: a slightly proud disc, as the panel on a rolled arm.
        b.add(cylinder(r * 0.82, 0.012, { bevel: 0.004, segments: 28 }), skin, compose(translation([side * (w / 2 - r), armTop - r, armFront(side) + 0.004]), rotationX(Math.PI / 2)));
        if (body.nails) {
          const path = arcPath([side * (w / 2 - r), armTop - r, armFront(side) + 0.012], r * 0.92, -Math.PI / 2, Math.PI * 1.5, "xy", 40);
          b.add(nailheads(path, [0, 0, 1], 0.024), metal({ r: 176, g: 140, b: 82 }, "polished"));
        }
      } else {
        const pillow = body.arms === "pillow";
        const arm = cushion({ size: [armW, armTop - legH, length], radius: pillow ? clamp(armW * 0.42, 0.05, 0.1) : clamp(armW * 0.28, 0.02, 0.045), crown: pillow ? 0.025 : 0.008, face: "top" });
        if (body.arms === "slope") {
          // Mid-century: the arm falls a little towards the front.
          for (let v = 0; v < arm.mesh.vertexCount; v += 1) {
            const [x, y, z] = arm.mesh.position(v);
            const t = (z + length / 2) / length;
            const top = y > 0 ? 1 : 0;
            arm.mesh.setPosition(v, [x, y - top * t * 0.05, z]);
          }
          arm.mesh.recomputeNormals();
        }
        b.add(arm.mesh.translate([side * (w / 2 - armW / 2), (legH + armTop) / 2, zc]), skin);
        if (body.nails) {
          const zf = armFront(side) + 0.003;
          const x0 = side * (w / 2 - armW + 0.02);
          const x1 = side * (w / 2 - 0.02);
          b.add(nailheads([[x0, legH + 0.03, zf], [x0, armTop - 0.03, zf], [x1, armTop - 0.03, zf], [x1, legH + 0.03, zf]], [0, 0, 1], 0.024), metal({ r: 176, g: 140, b: 82 }, "polished"));
        }
      }
    }
  }
  if (body.nails) {
    b.add(nailheads([[-w / 2 + armW + 0.01, legH + 0.03, front + 0.003], [w / 2 - armW - 0.01, legH + 0.03, front + 0.003]], [0, 0, 1], 0.024), metal({ r: 176, g: 140, b: 82 }, "polished"));
  }

  // Back cushions (loose), or a stack of pillows on a recliner.
  const innerLeft = -w / 2 + armW + 0.004;
  const innerRight = w / 2 - armW - 0.004;
  const innerW = innerRight - innerLeft;
  let seatBackZ = backZ + backT + rake * 0.6;
  if (body.back === "cushions") {
    const bt = clamp(mainD * 0.17, 0.11, 0.2);
    const count = Math.max(1, body.seats);
    const each = (innerW - 0.006 * (count - 1)) / count;
    const height = clamp(h - seatTop - 0.02, 0.2, 0.6);
    for (let i = 0; i < count; i += 1) {
      const pad = cushion({ size: [each, height, bt], radius: clamp(bt * 0.4, 0.03, 0.07), crown: 0.03, face: "front" });
      const lean = compose(translation([innerLeft + each / 2 + i * (each + 0.006), seatTop + height / 2 - 0.01, seatBackZ + bt / 2]), rotationX(-0.12));
      b.add(pad.mesh, skin, lean);
    }
    seatBackZ += bt * 0.85;
  } else if (body.back === "pillows") {
    const bt = clamp(mainD * 0.2, 0.14, 0.24);
    const height = h - seatTop - 0.03;
    const rows = 3;
    for (let row = 0; row < rows; row += 1) {
      const pad = cushion({ size: [innerW, height / rows + 0.02, bt], radius: clamp(bt * 0.45, 0.04, 0.09), crown: 0.03, face: "front" });
      b.add(pad.mesh, skin, compose(translation([0, seatTop + (height * (row + 0.5)) / rows, seatBackZ + bt / 2 - row * 0.012]), rotationX(-0.1)));
    }
    seatBackZ += bt * 0.9;
  }

  // Seat cushions between the arms (and one long one on a chaise).
  const seats = Math.max(1, body.seats);
  // A tight seat is upholstered firm over a frame: straighter sides, a gentle crown.
  const seatRadius = body.tightSeat ? 0.028 : clamp(seatT * 0.4, 0.025, 0.06);
  const seatCrown = body.tightSeat ? 0.012 : body.back === "tight" && body.tufting.kind !== "none" ? 0.01 : 0.016;
  if (chaiseW > 0) {
    const mainLeft = body.chaise > 0 ? innerLeft : -w / 2 + chaiseW + 0.004;
    const mainRight = body.chaise > 0 ? w / 2 - chaiseW - 0.004 : innerRight;
    const n = Math.max(1, seats - 1);
    const each = (mainRight - mainLeft - 0.006 * (n - 1)) / n;
    for (let i = 0; i < n; i += 1) {
      const seat = cushion({ size: [each, seatT, front - seatBackZ + 0.015], radius: seatRadius, crown: seatCrown, face: "top" });
      b.add(seat.mesh.translate([mainLeft + each / 2 + i * (each + 0.006), deck + seatT / 2, (seatBackZ + front + 0.015) / 2]), skin);
    }
    const cl = body.chaise > 0 ? w / 2 - chaiseW + 0.004 : innerLeft;
    const cr = body.chaise > 0 ? innerRight : -w / 2 + chaiseW - 0.004;
    const long = cushion({ size: [cr - cl, seatT, d / 2 - seatBackZ + 0.01], radius: seatRadius, crown: seatCrown, face: "top" });
    b.add(long.mesh.translate([(cl + cr) / 2, deck + seatT / 2, (seatBackZ + d / 2 + 0.01) / 2]), skin);
  } else {
    const each = (innerW - 0.006 * (seats - 1)) / seats;
    for (let i = 0; i < seats; i += 1) {
      const seat = cushion({ size: [each, seatT, front - seatBackZ + 0.015], radius: seatRadius, crown: seatCrown, face: "top" });
      b.add(seat.mesh.translate([innerLeft + each / 2 + i * (each + 0.006), deck + seatT / 2, (seatBackZ + front + 0.015) / 2]), skin);
    }
  }

  // Throw pillows, where the listing includes them: square, plump, leaning into the corners.
  for (let i = 0; i < body.pillows && armW > 0; i += 1) {
    const side = i === 0 ? -1 : 1;
    const size = clamp(Math.min(innerW / 3.2, 0.48), 0.32, 0.48);
    const pillow = cushion({ size: [size, size, 0.12], radius: 0.05, crown: 0.045, face: "front" });
    const accent = upholstery(c.palette.second ?? shadeFor(c), "velvet");
    b.add(pillow.mesh, accent, compose(translation([side * (innerW / 2 - size / 2 - 0.03), seatTop + size / 2 - 0.02, seatBackZ + 0.08]), rotationX(-0.25), rotationZ(side * 0.08)));
  }

  // Legs at the corners (and in the middle of a long sofa), or small glides under a skirt.
  const thickness = legThickness(body.legStyle);
  const inset = clamp(thickness * 0.9, 0.035, 0.07);
  const xs = [-w / 2 + inset, w / 2 - inset];
  if (w > 1.7 && !body.skirt) xs.push(0);
  const zs = [backZ + inset, front - inset];
  const feet: { x: number; z: number }[] = [];
  for (const x of xs) for (const z of zs) feet.push({ x, z });
  if (chaiseW > 0) feet.push({ x: body.chaise * (w / 2 - inset), z: d / 2 - inset }, { x: body.chaise * (w / 2 - chaiseW + inset), z: d / 2 - inset });
  for (const at of feet) {
    if (body.skirt) {
      b.add(roundedBox({ size: [0.04, 0.018, 0.04], radius: 0.004 }).translate([at.x, 0.009, at.z]), rubber());
      continue;
    }
    const splay = body.splay;
    const legMesh = leg(body.legStyle, (legH + 0.01) / Math.cos(splay), thickness);
    b.add(placeLeg(legMesh, { x: at.x, z: at.z, top: legH + 0.01 }, splay), frame);
  }
  if (body.skirt) {
    // The skirt: a panel all round, from just above the floor to the deck, with the slight flare of fabric.
    block(b, skin, [0, (0.02 + legH + 0.12) / 2, backZ + mainD / 2], [w + 0.006, legH + 0.12 - 0.02, mainD + 0.006], 0.006);
  }
}

/** A deeper shade of the main colour, for accents when the piece names none. */
function shadeFor(c: Context) {
  const { r, g, b } = c.palette.main;
  return { r: Math.round(r * 0.7), g: Math.round(g * 0.7), b: Math.round(b * 0.7) };
}

// ─── Armchairs and sofas ────────────────────────────────────────────────────

function armchair(c: Context): Build {
  const b = new Build();
  const { words } = c;
  if (words.has("barrel", "tub chair", "round back", "swivel barrel", "curved back", "bucket")) return barrel(c, b);
  upholsteredBody(c, b, bodyFor(c));
  return b;
}

function sofa(c: Context): Build {
  const b = new Build();
  const { words } = c;
  const body = bodyFor(c);
  const armSpace = body.arms === "none" ? 0 : 2 * clamp(c.size.w * 0.12, 0.08, 0.2);
  const benchSeat = words.has("bench seat", "bench cushion", "single cushion");
  body.seats = benchSeat ? 1 : clamp(Math.round((c.size.w - armSpace) / 0.62), 1, 4);
  if (words.has("sectional", "l shaped", "l shape", "l sectional", "chaise sofa", "sofa chaise", "with chaise", "u sectional", "u shaped")) {
    body.chaise = words.has("left", "left facing", "laf") ? -1 : 1;
  }
  upholsteredBody(c, b, body);
  return b;
}

/**
 * A barrel chair: the back and arms are one padded wall bent round the seat.
 * Built as a straight cushion, lowered towards both ends to arm height, then
 * wrapped round a vertical axis (geometry.bend).
 */
function barrel(c: Context, b: Build): Build {
  const { w, d, h } = c.size;
  const skin = upholsteryOf(c);
  const body = bodyFor(c);
  const swivel = c.words.has("swivel");
  const legH = swivel ? 0.06 : clamp(h * 0.14, 0.06, 0.18);
  const seatTop = clamp(h * 0.52, 0.38, 0.48);
  const seatT = clamp(seatTop * 0.28, 0.08, 0.14);
  const deck = seatTop - seatT;
  const wallT = clamp(Math.min(w, d) * 0.16, 0.1, 0.18);
  const radius = Math.min(w, d) / 2 - wallT / 2;
  const span = Math.PI * radius * 1.2;
  const wallH = h - deck;
  const armTop = clamp(seatTop + 0.2, seatTop + 0.12, h - 0.05);
  const wall = cushion({ size: [span, wallH, wallT], radius: clamp(wallT * 0.4, 0.03, 0.07), crown: 0.012, face: "front", tufting: body.tufting });
  // Lower the wall towards its two ends, to arm height.
  const armShare = (armTop - deck) / wallH;
  for (let v = 0; v < wall.mesh.vertexCount; v += 1) {
    const [x, y, z] = wall.mesh.position(v);
    const t = Math.abs(x) / (span / 2);
    const k = 1 - (1 - armShare) * smooth(0.45, 0.95, t);
    wall.mesh.setPosition(v, [x, (y + wallH / 2) * k, z + wallT / 2]);
  }
  bend(wall.mesh, radius + wallT / 2);
  b.add(wall.mesh.translate([0, deck, -(radius + wallT / 2)]), skin);

  const seat = extrude(superellipsePath(radius * 2 - 0.02, radius * 2 - 0.02, 2.4), { height: seatT, bevel: seatT * 0.45, bevelSegments: 4 });
  b.add(seat.translate([0, deck, 0.02]), skin);
  const base = extrude(superellipsePath(Math.min(w, d) * 0.96, Math.min(w, d) * 0.96, 2.4), { height: deck - legH, bevel: 0.02 });
  b.add(base.translate([0, legH, 0]), skin);
  if (swivel) {
    b.add(cylinder(Math.min(w, d) * 0.3, legH, { bevel: 0.01 }), metal({ r: 40, g: 40, b: 42 }, "powder"));
  } else {
    const style = legStyleOf(c, "tapered");
    const t = legThickness(style);
    for (let k = 0; k < 4; k += 1) {
      const a = Math.PI / 4 + (k * Math.PI) / 2;
      const r = Math.min(w, d) * 0.36;
      b.add(placeLeg(leg(style, (legH + 0.01) / Math.cos(0.1), t), { x: Math.cos(a) * r, z: Math.sin(a) * r, top: legH + 0.01 }, style === "tapered" ? 0.1 : 0), frameOf(c));
    }
  }
  return b;
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// ─── Chaise and daybed ──────────────────────────────────────────────────────

/** An upholstered chaise: a long seat with a raised, sloping back at one end and an arm along part of one side. */
function chaise(c: Context): Build {
  const b = new Build();
  // The long side runs along x; a listing that gives the length as its height is read the other way round.
  const { w, d, h } = c.size;
  const skin = upholsteryOf(c);
  const style = legStyleOf(c, "tapered");
  const legH = clamp(h * 0.18, 0.08, 0.16);
  const seatTop = Math.min(h * 0.55, 0.44);
  const seatT = 0.1;
  const deck = seatTop - seatT;
  block(b, skin, [0, (legH + deck) / 2, 0], [w, deck - legH, d], 0.02);
  const seat = cushion({ size: [w * 0.8, seatT, d - 0.02], radius: 0.04, crown: 0.012, face: "top", tufting: bodyFor(c).tufting });
  b.add(seat.mesh.translate([w * 0.1, deck + seatT / 2, 0]), skin);
  if (seat.buttons.length > 0) b.add(buttons(seat.buttons).translate([w * 0.1, deck + seatT / 2, 0]), skin);
  // The raised end: a cushion tilted back like a reclined backrest.
  const restL = clamp(w * 0.3, 0.4, 0.7);
  const rest = cushion({ size: [restL, 0.16, d - 0.02], radius: 0.06, crown: 0.02, face: "top" });
  b.add(rest.mesh, skin, compose(translation([-w / 2 + restL * 0.45, seatTop + (h - seatTop) * 0.5, 0]), rotationZ(-Math.atan2(h - seatTop, restL))));
  const t = legThickness(style);
  for (const x of [-w / 2 + 0.05, w / 2 - 0.05]) for (const z of [-d / 2 + 0.05, d / 2 - 0.05]) b.add(placeLeg(leg(style, legH + 0.01, t), { x, z, top: legH + 0.01 }, style === "tapered" ? 0.08 : 0), frameOf(c));
  return b;
}

/** A garden lounger: a slatted bed on a frame, its back raised at the head, wheels at the head end. */
function outdoorChaise(c: Context): Build {
  const b = new Build();
  const { w, d, h } = c.size;
  const length = Math.max(w, d);
  const width = Math.min(w, d);
  const timber = frameOf(c, { preferMetal: false });
  const bedY = clamp(h * 0.32, 0.22, 0.34);
  const rail = 0.04;
  // Built along x; turned at the end if the listing's long side is its depth.
  for (const side of [-1, 1]) block(b, timber, [0, bedY - 0.05, side * (width / 2 - rail / 2)], [length, 0.08, rail], 0.006, 0);
  const slats = Math.round((length * 0.62) / 0.07);
  for (let i = 0; i < slats; i += 1) block(b, timber, [length / 2 - 0.05 - i * 0.07, bedY, 0], [0.055, 0.02, width - 0.02], 0.004, 2);
  const backL = length * 0.36;
  const tilt = Math.atan2(Math.max(0.1, h - bedY - 0.05), backL);
  const backSlats = Math.round(backL / 0.07);
  for (let i = 0; i < backSlats; i += 1) {
    const s = 0.05 + i * 0.07;
    const x = -length / 2 + backL - s * Math.cos(tilt);
    const y = bedY + s * Math.sin(tilt);
    b.add(roundedBox({ size: [0.055, 0.02, width - 0.04], radius: 0.004, grain: 2 }), timber, compose(translation([x, y, 0]), rotationZ(-tilt)));
  }
  for (const x of [length / 2 - 0.08, -length / 2 + 0.25]) for (const side of [-1, 1]) block(b, timber, [x, (bedY - 0.08) / 2, side * (width / 2 - 0.03)], [0.05, bedY - 0.08, 0.05], 0.005, 1);
  if (c.words.has("wheels", "wheel")) {
    for (const side of [-1, 1]) {
      const wheel = cylinder(0.08, 0.03, { bevel: 0.008 });
      b.add(wheel, rubber(), compose(translation([-length / 2 + 0.1, 0.08, side * (width / 2 + 0.03)]), rotationX(Math.PI / 2)));
    }
  }
  if (d > w) for (const part of b.parts) part.mesh.transform(compose([0, 0, 1, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 0, 1]));
  return b;
}

// ─── Dining chairs ──────────────────────────────────────────────────────────

function diningChair(c: Context): Build {
  const b = new Build();
  const { w, d, h } = c.size;
  const { words } = c;
  const frame = frameOf(c);
  const isMetal = metalFrame(c);
  // Upholstered when the words say so — or when the piece's colour is not a wood's and nothing says wood or metal.
  const upholstered =
    words.has("upholstered", "tufted", "velvet", "leather", "faux leather", "fabric", "linen", "parsons", "boucle", "cushioned", "padded") ||
    words.material("fabric", "velvet", "leather", "linen") ||
    (!looksLikeWood(c.palette.main) && !words.has("wood", "wooden", "solid wood", "metal", "acrylic", "plastic") && !words.material("wood", "metal"));
  const skin = upholsteryOf(c);
  const seatTop = clamp(h * 0.5, 0.42, 0.49);
  const seatT = upholstered ? 0.07 : 0.03;
  const seatW = w * 0.94;
  const seatD = d * 0.9;
  const legStyle = isMetal ? "metal-round" : legStyleOf(c, words.has("farmhouse", "rustic") ? "square" : "tapered");
  const t = isMetal ? 0.024 : legStyle === "turned" ? 0.05 : 0.038;
  const inset = t * 0.7 + 0.01;
  const splay = legStyle === "tapered" ? 0.06 : 0;
  const legTop = seatTop - seatT;

  // Seat.
  if (upholstered) {
    const pad = cushion({ size: [seatW, seatT, seatD], radius: 0.025, crown: 0.012, face: "top" });
    b.add(pad.mesh.translate([0, seatTop - seatT / 2, 0.01]), skin);
    block(b, frame, [0, legTop - 0.035, 0.01], [seatW - 0.03, 0.05, seatD - 0.03], 0.004, 0);
  } else {
    // A carved seat: a slab, slightly dished.
    const slab = roundedBox({ size: [seatW, seatT, seatD], radius: 0.01, segments: 3, step: 0.04, grain: 2 });
    for (let v = 0; v < slab.vertexCount; v += 1) {
      const [x, y, z] = slab.position(v);
      if (y > 0) slab.setPosition(v, [x, y - 0.012 * (1 - (2 * x / seatW) ** 2) * (1 - (2 * z / seatD) ** 2), z]);
    }
    b.add(slab.recomputeNormals().translate([0, seatTop - seatT / 2, 0.01]), isMetal ? frameOf(c, { preferMetal: false }) : frame);
  }

  // Legs.
  const corners = [
    { x: -seatW / 2 + inset, z: seatD / 2 - inset + 0.01 },
    { x: seatW / 2 - inset, z: seatD / 2 - inset + 0.01 },
    { x: -seatW / 2 + inset, z: -seatD / 2 + inset + 0.01 },
    { x: seatW / 2 - inset, z: -seatD / 2 + inset + 0.01 },
  ];
  for (const at of corners.slice(0, 2)) b.add(placeLeg(leg(legStyle, legTop / Math.cos(splay), t), { ...at, top: legTop }, splay), frame);
  const parsons = upholstered && words.has("parsons", "high back", "tufted", "upholstered") && !words.has("open back", "curved back", "wingback");
  const backTop = h;
  if (parsons) {
    // The back legs stop under the seat; the upholstered back sits on the seat's rear.
    for (const at of corners.slice(2)) b.add(placeLeg(leg(legStyle, legTop / Math.cos(splay), t), { ...at, top: legTop }, splay), frame);
    const backT = 0.07;
    const tufting: Tufting = words.has("tufted", "button") ? { kind: "buttons", spacing: 0.11, depth: 0.018 } : words.has("channel") ? { kind: "channels", count: 4, depth: 0.016 } : { kind: "none" };
    const back = cushion({ size: [seatW * 0.96, backTop - seatTop + seatT, backT], radius: 0.025, crown: 0.012, face: "front", tufting });
    const at: Vec3 = [0, (backTop + seatTop - seatT) / 2, -seatD / 2 + backT / 2 + 0.01];
    b.add(back.mesh, skin, compose(translation(at), rotationX(-0.1)));
    if (back.buttons.length > 0) b.add(buttons(back.buttons), skin, compose(translation(at), rotationX(-0.1)));
  } else {
    // The back posts continue up from the back legs, leaning back, joined by rails and slats.
    const lean = 0.12;
    const postH = backTop;
    for (const at of corners.slice(2)) {
      const post = isMetal ? cylinder(t / 2, postH / Math.cos(lean), { bevel: 0.004, segments: 14 }) : roundedBox({ size: [t, postH / Math.cos(lean), t * 0.9], radius: t * 0.15, segments: 2, grain: 1 }).translate([0, postH / Math.cos(lean) / 2, 0]);
      b.add(post, frame, compose(translation([at.x, 0, at.z + 0.03]), rotationX(-lean * 0.35)));
    }
    const span = seatW - 2 * inset;
    const backZ = -seatD / 2 + inset - 0.04;
    const railY = backTop - 0.06;
    const curved = words.has("curved back", "curved", "open back", "round back");
    if (upholstered && curved) {
      // A padded, curved backrest between the posts.
      const rest = cushion({ size: [span + 0.04, 0.2, 0.05], radius: 0.02, crown: 0.01, face: "front" });
      bend(rest.mesh.translate([0, 0, 0.025]), span);
      b.add(rest.mesh.translate([0, backTop - 0.11, backZ - span * 0.04]), skin);
    } else if (words.has("cross back", "x back", "crossback")) {
      block(b, frame, [0, railY, backZ], [span, 0.06, 0.025], 0.004, 0);
      const len = Math.hypot(span, railY - seatTop - 0.05);
      const angle = Math.atan2(railY - seatTop - 0.05, span);
      for (const s of [-1, 1]) b.add(roundedBox({ size: [len, 0.03, 0.02], radius: 0.004, grain: 0 }), frame, compose(translation([0, (railY + seatTop + 0.05) / 2, backZ]), rotationZ(s * angle)));
    } else if (words.has("windsor", "spindle")) {
      const top = tube(arcPath([0, railY, backZ + span * 0.6], span * 0.75, -Math.PI * 0.82, -Math.PI * 0.18, "xz", 20), 0.016);
      b.add(top, frame);
      for (let i = 0; i < 7; i += 1) {
        const x = -span * 0.4 + (span * 0.8 * i) / 6;
        b.add(cylinder(0.008, railY - seatTop, { bevel: 0.002, segments: 10 }).translate([x, seatTop, backZ + 0.02]), frame);
      }
    } else if (words.has("ladder back", "ladderback")) {
      for (let i = 0; i < 4; i += 1) block(b, frame, [0, seatTop + 0.12 + ((railY - seatTop - 0.12) * i) / 3, backZ], [span, 0.05, 0.02], 0.004, 0);
    } else if (upholstered) {
      const pad = cushion({ size: [span + 0.02, (backTop - seatTop) * 0.55, 0.055], radius: 0.02, crown: 0.012, face: "front" });
      b.add(pad.mesh.translate([0, backTop - (backTop - seatTop) * 0.3, backZ + 0.01]), skin);
    } else {
      // Slats under a top rail.
      block(b, frame, [0, railY, backZ], [span, 0.08, 0.025], 0.005, 0);
      const slats = clamp(Math.round(span / 0.08), 3, 5);
      for (let i = 0; i < slats; i += 1) {
        const x = -span / 2 + (span * (i + 0.5)) / slats;
        block(b, frame, [x, (seatTop + 0.04 + railY) / 2, backZ], [0.03, railY - seatTop - 0.04, 0.016], 0.003, 1);
      }
    }
  }
  if (words.has("farmhouse", "rustic", "turned", "stretcher") && !isMetal) {
    // Stretchers between the legs.
    for (const z of [corners[0]!.z, corners[2]!.z]) block(b, frame, [0, 0.16, z], [seatW - 2 * inset, 0.022, 0.022], 0.005, 0);
    for (const x of [corners[0]!.x, corners[1]!.x]) block(b, frame, [x, 0.12, 0.01], [0.022, 0.022, seatD - 2 * inset], 0.005, 2);
  }
  if (words.has("with arms", "arm chair", "armchair", "arms") && !words.has("armless")) {
    for (const side of [-1, 1]) {
      block(b, frame, [side * (seatW / 2 - inset), seatTop + 0.1, 0], [0.04, 0.03, seatD * 0.8], 0.008, 2);
      block(b, frame, [side * (seatW / 2 - inset), seatTop + 0.05, seatD / 2 - inset - 0.02], [0.03, 0.1, 0.03], 0.006, 1);
    }
  }
  return b;
}

// ─── Office chairs ──────────────────────────────────────────────────────────

function officeChair(c: Context): Build {
  const b = new Build();
  const { w, d, h } = c.size;
  const { words } = c;
  const skin = upholsteryOf(c);
  const black = metal({ r: 34, g: 34, b: 36 }, "powder");
  const chrome = words.has("chrome", "silver") ? metal({ r: 228, g: 230, b: 232 }, "polished") : black;
  const radius = Math.min(w, d) / 2 - 0.035;
  const hubY = 0.085;
  // The five-star base: arms from a hub to a castor each.
  for (let k = 0; k < 5; k += 1) {
    const a = (k * Math.PI * 2) / 5 + Math.PI / 2;
    const end: Vec3 = [Math.cos(a) * radius, 0.065, Math.sin(a) * radius];
    b.add(tube([[0, hubY, 0], [end[0] * 0.5, 0.078, end[2] * 0.5], end], (t) => 0.018 - 0.008 * t, { segments: 12 }), chrome);
    const wheel = castor(0.05);
    b.add(wheel.wheel.translate([end[0], 0, end[2]]), rubber());
    b.add(wheel.fork.translate([end[0], 0, end[2]]), rubber());
  }
  b.add(cylinder(0.04, 0.05, { bevel: 0.01 }).translate([0, hubY - 0.025, 0]), chrome);
  const seatTop = clamp(h * 0.45, 0.44, 0.52);
  const seatT = 0.09;
  b.add(cylinder(0.026, seatTop - seatT - hubY, { bevel: 0.004, segments: 18 }).translate([0, hubY, 0]), chrome);
  b.add(cylinder(0.034, 0.14, { bevel: 0.006, segments: 18 }).translate([0, hubY + 0.01, 0]), rubber());
  block(b, black, [0, seatTop - seatT - 0.03, 0], [0.24, 0.05, 0.26], 0.01);
  const seatW = clamp(w * 0.78, 0.44, 0.56);
  const seatD = clamp(d * 0.78, 0.42, 0.52);
  const seat = cushion({ size: [seatW, seatT, seatD], radius: 0.035, crown: 0.014, face: "top" });
  b.add(seat.mesh.translate([0, seatTop - seatT / 2, 0.02]), skin);
  // The back, on a spine from under the seat; channelled on an executive chair, mesh on a task chair.
  const mesh = words.has("mesh");
  const backBottom = seatTop + 0.06;
  const backH = h - backBottom;
  const backW = seatW * 0.95;
  const tufting: Tufting = words.has("executive", "leather", "tufted", "nailhead") ? { kind: "channels", count: 4, depth: 0.016 } : { kind: "none" };
  const back = cushion({ size: [backW, backH, mesh ? 0.03 : 0.08], radius: mesh ? 0.012 : 0.035, crown: 0.012, face: "front", tufting });
  const lean = rotationX(-0.12);
  b.add(back.mesh, mesh ? upholstery({ r: 40, g: 40, b: 44 }, "weave") : skin, compose(translation([0, backBottom + backH / 2, -seatD / 2 + 0.02]), lean));
  if (mesh) {
    b.add(tube(roundedRectangleLoop(backW, backH), 0.012, { closed: true, segments: 10 }), black, compose(translation([0, backBottom + backH / 2, -seatD / 2 + 0.02]), lean));
  }
  block(b, black, [0, seatTop - 0.01, -seatD / 2 - 0.015], [0.06, 0.12, 0.03], 0.008);
  // Arm rests.
  if (!words.has("armless", "no arms") && w > 0.52) {
    for (const side of [-1, 1]) {
      const x = side * (w / 2 - 0.035);
      block(b, black, [x, seatTop + 0.05, -0.02], [0.03, 0.24, 0.05], 0.008, 1);
      block(b, black, [(x + side * -0.1) / 1, seatTop - 0.06, -0.02], [Math.abs(x) * 0.4, 0.025, 0.04], 0.006, 0);
      const pad = cushion({ size: [0.075, 0.03, 0.26], radius: 0.012, crown: 0.004, face: "top" });
      b.add(pad.mesh.translate([x, seatTop + 0.18, 0.0]), skin);
    }
  }
  return b;
}

function roundedRectangleLoop(width: number, height: number): Vec3[] {
  const r = Math.min(width, height) * 0.12;
  const out: Vec3[] = [];
  const corners: [number, number, number][] = [
    [width / 2 - r, height / 2 - r, 0],
    [-width / 2 + r, height / 2 - r, Math.PI / 2],
    [-width / 2 + r, -height / 2 + r, Math.PI],
    [width / 2 - r, -height / 2 + r, Math.PI * 1.5],
  ];
  for (const [cx, cy, start] of corners) for (let k = 0; k < 6; k += 1) {
    const a = start + (Math.PI / 2) * (k / 6);
    out.push([cx + r * Math.cos(a), cy + r * Math.sin(a), 0.016]);
  }
  return out;
}

// ─── Stools ─────────────────────────────────────────────────────────────────

function stool(c: Context): Build {
  const b = new Build();
  const { w, d, h } = c.size;
  const { words } = c;
  const isMetal = metalFrame(c) || words.has("metal", "industrial", "stackable");
  const frame = frameOf(c, { preferMetal: isMetal });
  const upholstered = words.has("upholstered", "velvet", "leather", "faux leather", "fabric", "cushion", "padded", "boucle") || words.material("fabric", "velvet", "leather");
  const skin = upholsteryOf(c);
  const hasBack = !words.has("backless") && (words.has("back", "open back", "low back", "high back", "with back") || h > 0.86);
  const seatTop = hasBack ? clamp(h * 0.66, 0.45, 0.8) : h;
  // A low ceramic garden stool: a turned drum.
  if (words.has("garden stool", "ceramic") && h < 0.6) {
    const body = lathe(drumProfile(Math.min(w, d) / 2, h), { segments: 40 });
    b.add(body, { ...upholsteryOf(c), ...ceramicLike(c) });
    return b;
  }
  const seatR = Math.min(w, d) / 2 * (hasBack ? 0.82 : 0.92);
  const seatT = upholstered ? 0.08 : 0.035;
  const square = words.has("square") && !words.has("round");
  if (upholstered) {
    if (square) {
      const pad = cushion({ size: [seatR * 2, seatT, seatR * 2], radius: 0.025, crown: 0.012, face: "top" });
      b.add(pad.mesh.translate([0, seatTop - seatT / 2, 0]), skin);
    } else {
      b.add(extrude(superellipsePath(seatR * 2, seatR * 2, 2), { height: seatT, bevel: seatT * 0.45, bevelSegments: 4 }).translate([0, seatTop - seatT, 0]), skin);
    }
  } else if (words.has("saddle")) {
    // A saddle seat: dished in the middle, its front edge rounded down.
    const slab = roundedBox({ size: [seatR * 2, seatT, seatR * 1.9], radius: 0.012, segments: 3, step: 0.03, grain: 0 });
    for (let v = 0; v < slab.vertexCount; v += 1) {
      const [x, y, z] = slab.position(v);
      if (y > 0) slab.setPosition(v, [x, y - 0.018 * Math.cos((Math.PI * x) / (seatR * 2)) * (1 - (z / seatR) ** 2), z]);
    }
    b.add(slab.recomputeNormals().translate([0, seatTop - seatT / 2, 0]), frameOf(c, { preferMetal: false }));
  } else {
    b.add(cylinder(seatR, seatT, { bevel: seatT * 0.35, segments: 40 }).translate([0, seatTop - seatT, 0]), isMetal ? frame : frameOf(c, { preferMetal: false }));
  }
  const legTop = seatTop - seatT;
  if (words.has("swivel", "pedestal", "adjustable", "gas lift", "hydraulic")) {
    const chrome = metal({ r: 228, g: 230, b: 232 }, "polished");
    b.add(cylinder(Math.min(w, d) * 0.38, 0.02, { bevel: 0.006 }), chrome);
    b.add(cylinder(0.028, legTop - 0.02, { bevel: 0.004, segments: 18 }).translate([0, 0.02, 0]), chrome);
    b.add(tube(arcPath([0, legTop * 0.45, 0], Math.min(w, d) * 0.3, 0, Math.PI * 2, "xz", 40), 0.009, { closed: true, segments: 10 }), chrome);
    for (let k = 0; k < 3; k += 1) {
      const a = (k * Math.PI * 2) / 3;
      b.add(tube([[0, legTop * 0.45, 0], [Math.cos(a) * Math.min(w, d) * 0.3, legTop * 0.45, Math.sin(a) * Math.min(w, d) * 0.3]], 0.006, { segments: 8 }), chrome);
    }
  } else {
    const splay = 0.09;
    const r = seatR * 0.78;
    const t = isMetal ? 0.022 : 0.036;
    const feet: Vec3[] = [];
    for (let k = 0; k < 4; k += 1) {
      const a = Math.PI / 4 + (k * Math.PI) / 2;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const legMesh = isMetal ? cylinder(t / 2, legTop / Math.cos(splay), { bevel: 0.003, segments: 14 }) : leg(legStyleOf(c, "tapered"), legTop / Math.cos(splay), t);
      b.add(placeLeg(legMesh, { x, z, top: legTop }, splay), frame);
      const foot = legTop * Math.tan(splay) * 0.7;
      feet.push([x + Math.sign(x) * foot * Math.SQRT1_2, 0, z + Math.sign(z) * foot * Math.SQRT1_2]);
    }
    // A footrest: a ring on a metal stool, rails between the legs on a wooden one.
    const restY = clamp(legTop * 0.4, 0.2, 0.32);
    const spread = (r + (legTop - restY) * Math.tan(splay) * 0.75) * 1.0;
    if (isMetal) {
      b.add(tube(arcPath([0, restY, 0], spread, 0, Math.PI * 2, "xz", 48), 0.009, { closed: true, segments: 10 }), frame);
    } else {
      const side = spread * Math.SQRT2;
      for (let k = 0; k < 4; k += 1) {
        const a = (k * Math.PI) / 2;
        b.add(roundedBox({ size: [side, 0.022, 0.022], radius: 0.005, grain: 0 }), frame, compose(translation([Math.cos(a) * spread * Math.SQRT1_2, restY, Math.sin(a) * spread * Math.SQRT1_2]), rotationYAxis(a + Math.PI / 2)));
      }
    }
  }
  if (hasBack) {
    const backH = h - seatTop;
    if (upholstered) {
      const back = cushion({ size: [seatR * 1.7, backH * 0.75, 0.05], radius: 0.02, crown: 0.01, face: "front", tufting: words.has("tufted") ? { kind: "buttons", spacing: 0.1, depth: 0.014 } : words.has("channel") ? { kind: "channels", count: 4, depth: 0.014 } : { kind: "none" } });
      bend(back.mesh.translate([0, 0, 0.025]), seatR * 1.4);
      b.add(back.mesh.translate([0, seatTop + backH * 0.58, -seatR * 0.85]), skin);
    } else {
      b.add(tube(arcPath([0, h - 0.03, 0], seatR * 0.9, Math.PI * 1.15, Math.PI * 1.85, "xz", 20), 0.02), frame);
    }
    for (const side of [-1, 1]) b.add(cylinder(0.011, backH, { bevel: 0.003, segments: 12 }).translate([side * seatR * 0.55, seatTop - 0.01, -seatR * 0.8]), frame);
  }
  return b;
}

function rotationYAxis(angle: number): Mat4 {
  const ca = Math.cos(angle);
  const sa = Math.sin(angle);
  return [ca, 0, -sa, 0, 0, 1, 0, 0, sa, 0, ca, 0, 0, 0, 0, 1];
}

/** A barrel-shaped drum, as a garden stool or a pouf: swelling in the middle. */
function drumProfile(radius: number, height: number) {
  const points = [{ r: 0, y: 0 }];
  for (let k = 0; k <= 16; k += 1) {
    const t = k / 16;
    points.push({ r: radius * (0.82 + 0.18 * Math.sin(Math.PI * t)), y: height * t });
  }
  points.push({ r: 0, y: height });
  return points;
}

function ceramicLike(c: Context): Partial<MaterialSpec> {
  return { key: `ceramic:${c.palette.main.r},${c.palette.main.g},${c.palette.main.b}`, texture: "ceramic", roughness: 1, clearcoat: { factor: 0.6, roughness: 0.1 }, sheen: undefined };
}

// ─── Benches and ottomans ───────────────────────────────────────────────────

function bench(c: Context): Build {
  const b = new Build();
  const { w, d, h } = c.size;
  const { words } = c;
  const upholstered = words.has("upholstered", "tufted", "velvet", "leather", "fabric", "linen", "cushion", "padded", "boucle", "faux leather") || words.material("fabric", "velvet", "leather");
  const frame = frameOf(c);
  const skin = upholsteryOf(c);
  const storage = words.has("storage", "shoe", "cubby", "basket");
  const seatT = upholstered ? clamp(h * 0.2, 0.06, 0.12) : 0.04;
  const seatTop = words.has("back") ? clamp(h * 0.5, 0.42, 0.48) : h;
  if (storage) {
    const bodyH = seatTop - seatT - 0.06;
    block(b, frame, [0, 0.06 + bodyH, 0], [w, 0.025, d], 0.004, 0);
    block(b, frame, [0, 0.06 + 0.0125, 0], [w, 0.025, d], 0.004, 0);
    for (const side of [-1, 1]) block(b, frame, [side * (w / 2 - 0.0125), 0.03 + bodyH / 2 + 0.015, 0], [0.025, bodyH + 0.06, d], 0.004, 1);
    block(b, frame, [0, 0.06 + bodyH / 2, -d / 2 + 0.006], [w - 0.05, bodyH, 0.012], 0.002, 0);
    const middle = 0.06 + bodyH / 2;
    block(b, frame, [0, middle, 0], [w - 0.05, 0.02, d - 0.02], 0.003, 0);
  } else {
    const legH = seatTop - seatT;
    const style = legStyleOf(c, upholstered ? "tapered" : "block");
    const t = legThickness(style);
    if (!upholstered && words.has("trestle", "farmhouse", "rustic")) {
      for (const side of [-1, 1]) block(b, frame, [side * (w / 2 - 0.08), legH / 2, 0], [0.05, legH, d * 0.85], 0.006, 1);
      block(b, frame, [0, legH * 0.3, 0], [w - 0.2, 0.05, 0.04], 0.006, 0);
    } else {
      for (const x of [-w / 2 + 0.05, w / 2 - 0.05]) for (const z of [-d / 2 + 0.05, d / 2 - 0.05]) b.add(placeLeg(leg(style, (legH + 0.01) / Math.cos(style === "tapered" ? 0.08 : 0), t), { x, z, top: legH + 0.01 }, style === "tapered" ? 0.08 : 0), frame);
    }
  }
  if (upholstered) {
    const body = bodyFor(c);
    const pad = cushion({ size: [w, seatT, d], radius: clamp(seatT * 0.4, 0.02, 0.045), crown: 0.012, face: "top", tufting: body.tufting });
    b.add(pad.mesh.translate([0, seatTop - seatT / 2, 0]), skin);
    if (pad.buttons.length > 0) b.add(buttons(pad.buttons).translate([0, seatTop - seatT / 2, 0]), skin);
    if (body.nails) b.add(nailheads([[-w / 2 + 0.01, seatTop - seatT + 0.015, d / 2 + 0.003], [w / 2 - 0.01, seatTop - seatT + 0.015, d / 2 + 0.003]], [0, 0, 1]), metal({ r: 176, g: 140, b: 82 }, "polished"));
  } else {
    block(b, frame, [0, seatTop - seatT / 2, 0], [w, seatT, d], 0.008, 0, 0.1);
  }
  if (words.has("back") && h > seatTop + 0.15) {
    const span = w - 0.1;
    for (const side of [-1, 1]) block(b, frame, [side * (w / 2 - 0.04), (seatTop + h) / 2, -d / 2 + 0.03], [0.04, h - seatTop, 0.04], 0.006, 1);
    for (let i = 0; i < 3; i += 1) block(b, frame, [0, seatTop + 0.1 + ((h - seatTop - 0.14) * i) / 2, -d / 2 + 0.03], [span, 0.06, 0.02], 0.005, 0);
  }
  return b;
}

function ottoman(c: Context): Build {
  const b = new Build();
  const { w, d, h } = c.size;
  const { words } = c;
  const skin = upholsteryOf(c);
  const round = words.has("round", "pouf", "pouffe", "drum", "cylinder", "circular") || (words.has("ottoman") && Math.abs(w - d) < 0.03 && words.has("round"));
  const knit = words.has("knit", "knitted", "chunky", "braided", "woven");
  if (round) {
    const r = Math.min(w, d) / 2;
    // A pouf's top and bottom edges are fully round.
    const soft = [{ r: 0, y: 0 }];
    for (let k = 0; k <= 24; k += 1) {
      const a = (Math.PI * k) / 24;
      const bulge = Math.sin(a);
      soft.push({ r: r * (0.86 + 0.14 * bulge), y: (h / 2) * (1 - Math.cos(a)) });
    }
    soft.push({ r: 0, y: h });
    const body = lathe(soft, { segments: 48 });
    const material: MaterialSpec = knit ? { ...upholstery(c.palette.main, "weave"), key: `knit:${c.palette.main.r},${c.palette.main.g},${c.palette.main.b}`, texture: "jute" } : skin;
    b.add(body, material);
    if (words.has("tufted")) {
      const studs: { position: Vec3; normal: Vec3 }[] = [{ position: [0, h, 0], normal: [0, 1, 0] }];
      for (let k = 0; k < 6; k += 1) {
        const a = (k * Math.PI * 2) / 6;
        studs.push({ position: [Math.cos(a) * r * 0.5, h - 0.006, Math.sin(a) * r * 0.5], normal: [0, 1, 0] });
      }
      b.add(buttons(studs), skin);
    }
    return b;
  }
  const storage = words.has("storage", "lift top", "lid");
  const legsShow = !storage && (words.has("legs", "tapered", "wood legs", "wooden legs", "mid century", "cocktail") || h > 0.38);
  const style = legStyleOf(c, "tapered");
  const legH = legsShow ? clamp(h * 0.22, 0.06, 0.12) : 0.012;
  const body = bodyFor(c);
  const top = cushion({ size: [w, h - legH, d], radius: clamp((h - legH) * 0.25, 0.02, 0.06), crown: 0.014, face: "top", tufting: body.tufting });
  b.add(top.mesh.translate([0, (h + legH) / 2, 0]), skin);
  if (top.buttons.length > 0) b.add(buttons(top.buttons).translate([0, (h + legH) / 2, 0]), skin);
  if (storage) {
    // The lid's seam, a little below the top.
    block(b, upholstery({ r: Math.round(c.palette.main.r * 0.55), g: Math.round(c.palette.main.g * 0.55), b: Math.round(c.palette.main.b * 0.55) }, "weave"), [0, h - (h - legH) * 0.28, 0], [w + 0.002, 0.006, d + 0.002], 0.002);
  }
  if (body.nails) b.add(nailheads([[-w / 2 + 0.015, legH + 0.03, d / 2 + 0.003], [w / 2 - 0.015, legH + 0.03, d / 2 + 0.003]], [0, 0, 1]), metal({ r: 176, g: 140, b: 82 }, "polished"));
  if (legsShow) {
    const t = legThickness(style);
    for (const x of [-w / 2 + 0.05, w / 2 - 0.05]) for (const z of [-d / 2 + 0.05, d / 2 - 0.05]) b.add(placeLeg(leg(style, legH + 0.01, t), { x, z, top: legH + 0.01 }, style === "tapered" ? 0.06 : 0), frameOf(c));
  }
  return b;
}

function beanBag(c: Context): Build {
  const b = new Build();
  const { w, d, h } = c.size;
  const r = Math.min(w, d) / 2;
  const profile = [{ r: 0, y: 0 }];
  for (let k = 0; k <= 24; k += 1) {
    const a = (Math.PI * k) / 24;
    // Wide and heavy at the bottom, slumping towards the top.
    profile.push({ r: r * (0.75 * Math.sin(a) + 0.25 * Math.sin(a) ** 0.3) * (1 - 0.12 * (k / 24)), y: (h / 2) * (1 - Math.cos(a)) });
  }
  profile.push({ r: 0, y: h });
  const bag = lathe(profile, { segments: 48 });
  // The seat's dip, where someone sat.
  for (let v = 0; v < bag.vertexCount; v += 1) {
    const [x, y, z] = bag.position(v);
    const dip = 0.12 * h * Math.exp(-((x * x + (z - r * 0.15) ** 2) / (2 * (r * 0.45) ** 2))) * Math.max(0, (y - h * 0.5) / (h * 0.5));
    bag.setPosition(v, [x, y - dip, z]);
  }
  b.add(bag.recomputeNormals(), upholsteryOf(c));
  return b;
}

function rocker(c: Context): Build {
  const b = new Build();
  const { w, d, h } = c.size;
  const frame = frameOf(c, { preferMetal: false });
  const upholstered = c.words.has("upholstered", "glider", "fabric", "cushion", "padded", "velvet", "leather");
  if (upholstered) {
    // An upholstered rocker or glider: an armchair on a pair of runners.
    const inner = new Build();
    const shorter: Context = { ...c, size: { w, d, h: h - 0.06 } };
    upholsteredBody(shorter, inner, { ...bodyFor(shorter), skirt: false, legStyle: "block", splay: 0 });
    for (const part of inner.parts) b.add(part.mesh.translate([0, 0.06, 0]), part.material);
  } else {
    const seatTop = clamp(h * 0.45, 0.4, 0.46);
    block(b, frame, [0, seatTop, 0.02], [w * 0.8, 0.035, d * 0.6], 0.008, 0);
    for (const x of [-w * 0.36, w * 0.36]) {
      block(b, frame, [x, (0.06 + h) / 2, -d * 0.28], [0.04, h - 0.06, 0.04], 0.006, 1);
      block(b, frame, [x, (0.06 + seatTop) / 2, d * 0.25], [0.04, seatTop - 0.06, 0.04], 0.006, 1);
      block(b, frame, [x, seatTop + 0.22, 0], [0.05, 0.03, d * 0.62], 0.008, 2);
    }
    for (let i = 0; i < 5; i += 1) block(b, frame, [-w * 0.3 + (w * 0.6 * i) / 4, (seatTop + h) / 2, -d * 0.28], [0.025, h - seatTop - 0.06, 0.015], 0.003, 1);
    block(b, frame, [0, h - 0.05, -d * 0.28], [w * 0.76, 0.08, 0.03], 0.006, 0);
  }
  // The runners: arcs on the floor along each side.
  for (const x of [-w * 0.36, w * 0.36]) {
    const runner = tube(arcPath([x, 1.6, 0], 1.6, -Math.PI / 2 - Math.asin(d * 0.48 / 1.6), -Math.PI / 2 + Math.asin(d * 0.48 / 1.6), "zy", 24), 0.018, { segments: 10 });
    b.add(runner.translate([0, 0.018, 0]), frame);
  }
  return b;
}

function adirondack(c: Context): Build {
  const b = new Build();
  const { w, d, h } = c.size;
  const timber = frameOf(c, { preferMetal: false });
  const seatFront = 0.38;
  const seatBack = 0.28;
  // Seat slats falling towards the back.
  for (let i = 0; i < 6; i += 1) {
    const z = d / 2 - 0.08 - i * 0.075;
    const y = seatFront - ((d / 2 - 0.08 - z) / (d * 0.5)) * (seatFront - seatBack);
    block(b, timber, [0, y, z], [w * 0.62, 0.02, 0.065], 0.004, 0);
  }
  // The fan back: slats leaning back, the middle ones tallest.
  const slats = 6;
  for (let i = 0; i < slats; i += 1) {
    const x = -w * 0.26 + (w * 0.52 * i) / (slats - 1);
    const height = h - 0.32 - 0.12 * Math.abs(i - (slats - 1) / 2) / ((slats - 1) / 2);
    b.add(roundedBox({ size: [0.07, height, 0.02], radius: 0.006, grain: 1 }), timber, compose(translation([x * (1 + 0.1), 0.3 + height / 2 * Math.cos(0.4), -d / 2 + 0.12 - (height / 2) * Math.sin(0.4)]), rotationX(-0.4), rotationZ(-x * 0.25)));
  }
  // Wide flat arms on front posts, and the legs.
  for (const side of [-1, 1]) {
    block(b, timber, [side * (w / 2 - 0.07), 0.58, 0.02], [0.14, 0.022, d * 0.72], 0.006, 2);
    block(b, timber, [side * (w * 0.31), 0.29, d / 2 - 0.1], [0.04, 0.58, 0.07], 0.005, 1);
    b.add(roundedBox({ size: [0.04, 0.09, d * 0.92], radius: 0.006, grain: 2 }), timber, compose(translation([side * w * 0.33, 0.2, 0]), rotationX(0.33)));
  }
  return b;
}
