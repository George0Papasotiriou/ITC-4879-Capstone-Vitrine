"use client";

/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * "Will it get in?": the way into the shopper's home, step by step, and whether a piece's box gets through each.
 */

import { useTranslations } from "next-intl";
import { useId, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { useHydrated } from "@/components/ui/use-hydrated";
import { pushedIntoCorner, stepSchema, wayIn, MAX_STEPS, type Box, type Step, type StepResult } from "@/lib/fit/path";
import { cn } from "@/lib/ui/cn";

/**
 * docs/adr/055. The shopper measures their way in once — the front door, the
 * hall's corner, the stairs, the room's door — and every piece then answers
 * whether its box gets through, worked out on the page itself
 * (src/lib/fit/path.ts) from the catalogue's measurements. Where it does not,
 * the step that stops it is named with the centimetres it misses by, and a
 * corner is drawn from above at its tightest moment, so the shopper can see
 * why, and what to measure again. The way in is kept with their preferences
 * (a guest's in their browser), and can be deleted from "What we know about you".
 */

const DEFAULTS: Record<Step["kind"], Step> = {
  door: { kind: "door", width: 80, height: 200 },
  turn: { kind: "turn", from: 100, to: 100, ceiling: 250 },
  stairs: { kind: "stairs", width: 90, headroom: 200 },
};

const FIELDS: { [K in Step["kind"]]: (keyof Extract<Step, { kind: K }> & string)[] } = {
  door: ["width", "height"],
  turn: ["from", "to", "ceiling"],
  stairs: ["width", "headroom"],
};

export function WayIn({ box, saved, agentScope = "fit" }: { box: Box | null; saved: Step[]; agentScope?: string }) {
  const t = useTranslations("fit");
  const id = useId();
  // Inert until the page wakes up: a step added before then would be lost.
  const hydrated = useHydrated();
  const [steps, setSteps] = useState<Step[]>(saved);
  const [kept, setKept] = useState<Step[]>(saved);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "failed">("idle");

  const valid = steps.map((step) => stepSchema.safeParse(step).success);
  const allValid = valid.every(Boolean);
  const result = useMemo(() => (box === null || steps.length === 0 || !allValid ? null : wayIn(box, steps)), [box, steps, allValid]);
  const dirty = JSON.stringify(steps) !== JSON.stringify(kept);

  const update = (index: number, field: string, value: number) => {
    setStatus("idle");
    setSteps((current) => current.map((step, position) => (position === index ? ({ ...step, [field]: value } as Step) : step)));
  };
  const add = (kind: Step["kind"]) => {
    setStatus("idle");
    setSteps((current) => (current.length >= MAX_STEPS ? current : [...current, DEFAULTS[kind]]));
  };
  const remove = (index: number) => {
    setStatus("idle");
    setSteps((current) => current.filter((_, position) => position !== index));
  };
  const save = async () => {
    if (!allValid) return;
    setStatus("saving");
    const response = await fetch("/api/preferences", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ wayIn: steps }) }).catch(() => null);
    if (response?.ok === true) {
      setKept(steps);
      setStatus("saved");
    } else setStatus("failed");
  };

  return (
    <div className="flex flex-col gap-5" data-agent-id={`${agentScope}:way-in`}>
      {result === null ? null : (
        <p
          role="status"
          className={cn("font-display text-2xl leading-tight", result.fits ? "text-success" : "text-danger")}
          data-agent-id={`${agentScope}:verdict`}
          data-fits={result.fits}
        >
          {result.fits ? t("verdict.fits") : t("verdict.fails", { number: (result.firstFailure ?? 0) + 1 })}
        </p>
      )}

      {steps.length === 0 ? <p className="text-slate text-sm">{t("empty")}</p> : null}

      <ol className="flex flex-col gap-3">
        {steps.map((step, index) => {
          const outcome = result?.steps[index] ?? null;
          return (
            <li key={index} className={cn("border-hairline grid gap-3 rounded-[10px] border p-3 sm:grid-cols-[minmax(0,1fr)_auto]", !valid[index] && "border-danger")} data-agent-id={`${agentScope}:step:${index + 1}`}>
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <span aria-hidden="true" className="bg-dusk text-glass grid size-6 place-items-center rounded-full text-xs tabular-nums">
                    {index + 1}
                  </span>
                  <span className="font-medium">{t(`kind.${step.kind}`)}</span>
                  <span className="flex-1" />
                  <button type="button" onClick={() => remove(index)} className="text-slate hover:text-dusk min-h-6 text-sm underline-offset-4 hover:underline" data-agent-id={`${agentScope}:remove:${index + 1}`}>
                    {t("remove")}
                    <span className="sr-only"> {t("stepLabel", { number: index + 1 })}</span>
                  </button>
                </div>
                <div className="flex flex-wrap gap-3">
                  {(FIELDS[step.kind] as string[]).map((field) => (
                    <label key={field} htmlFor={`${id}-${index}-${field}`} className="flex flex-col gap-1 text-xs">
                      <span className="text-slate">{t(`field.${step.kind}.${field}`)}</span>
                      <span className="border-hairline focus-within:ring-dusk flex items-center rounded-md border bg-white focus-within:ring-2">
                        <input
                          id={`${id}-${index}-${field}`}
                          type="number"
                          inputMode="numeric"
                          min={40}
                          max={600}
                          value={(step as Record<string, number | string>)[field] as number}
                          onChange={(event) => update(index, field, Math.round(Number(event.currentTarget.value)))}
                          className="w-20 bg-transparent px-2 py-1.5 text-sm tabular-nums outline-none"
                          data-agent-id={`${agentScope}:field:${index + 1}:${field}`}
                        />
                        <span className="text-slate pr-2 text-xs">cm</span>
                      </span>
                    </label>
                  ))}
                </div>
                {valid[index] ? null : <p className="text-danger text-xs">{t("check")}</p>}
                {outcome === null ? null : <Outcome outcome={outcome} agentId={`${agentScope}:outcome:${index + 1}`} />}
              </div>
              {outcome?.plan === undefined || step.kind !== "turn" ? null : <TurnPlan step={step} outcome={outcome} label={t("planLabel", { number: index + 1 })} />}
            </li>
          );
        })}
      </ol>

      <div className="flex flex-wrap gap-2" role="group" aria-label={t("addLabel")}>
        {(["door", "turn", "stairs"] as const).map((kind) => (
          <Button key={kind} size="sm" variant="secondary" onClick={() => add(kind)} disabled={!hydrated || steps.length >= MAX_STEPS} data-agent-id={`${agentScope}:add:${kind}`}>
            {t(`add.${kind}`)}
          </Button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => void save()} disabled={!dirty || !allValid || status === "saving"} data-agent-id={`${agentScope}:save`}>
          {t("save")}
        </Button>
        <p className="text-slate text-sm" aria-live="polite">
          {status === "saved" ? t("saved") : status === "failed" ? t("failed") : dirty ? t("unsaved") : null}
        </p>
      </div>
    </div>
  );
}

/** How a step went: whether it fits, by how much, and how the piece is carried. */
function Outcome({ outcome, agentId }: { outcome: StepResult; agentId: string }) {
  const t = useTranslations("fit");
  const carry = outcome.carry;
  const how =
    carry === null
      ? null
      : [t(`up.${carry.up}`), carry.tiltDegrees > 0 ? t("tilted", { degrees: carry.tiltDegrees }) : null, carry.diagonal ? t("diagonal") : null].filter(Boolean).join(", ");
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm" data-agent-id={agentId} data-fits={outcome.fits}>
      <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", outcome.fits ? "bg-success/12 text-success" : "bg-danger/10 text-danger")}>
        {outcome.fits ? t("fits", { margin: Math.max(0, outcome.marginCm) }) : t("tight", { margin: -outcome.marginCm })}
      </span>
      {how === null || how === "" ? null : <span className="text-slate">{how}</span>}
    </p>
  );
}

/**
 * The corner from above at its tightest moment: the two corridors, and the
 * piece's plan pushed into the outer corner at the angle where the corner is
 * tightest. Where it does not fit, it visibly crosses the inner wall.
 */
function TurnPlan({ step, outcome, label }: { step: Extract<Step, { kind: "turn" }>; outcome: StepResult; label: string }) {
  const plan = outcome.plan!;
  const a = step.from;
  const b = step.to;
  const extent = Math.max(plan.length, a, b) * 1.12;
  const piece = pushedIntoCorner(plan.theta, b, plan.length, plan.width);
  // World: y up; SVG: y down. The view shows x from b − extent to b, and y from 0 to extent.
  const view = `${b - extent - 4} ${-extent - 4} ${extent + 8} ${extent + 8}`;
  const point = ([x, y]: [number, number]) => `${x.toFixed(1)},${(-y).toFixed(1)}`;
  const corridor: [number, number][] = [
    [b - extent, 0],
    [b, 0],
    [b, extent],
    [0, extent],
    [0, a],
    [b - extent, a],
  ];
  return (
    <svg viewBox={view} role="img" aria-label={label} className="text-dusk size-28 shrink-0 self-center sm:size-32" data-agent-id="fit:plan">
      {/* The wall inside the corner, as solid mass: what the piece must not cross. */}
      <rect x={b - extent - 4} y={-extent - 4} width={extent - b + 4} height={extent - a + 4} className="fill-dusk/25" />
      <polygon points={corridor.map(point).join(" ")} className="fill-plinth" stroke="currentColor" strokeWidth={extent / 90} />
      <polygon
        points={piece.map(point).join(" ")}
        className={outcome.fits ? "fill-gilt/70 stroke-gilt-deep" : "fill-danger/25 stroke-danger"}
        strokeWidth={extent / 110}
      />
      <circle cx={0} cy={-a} r={extent / 60} className="fill-dusk" />
    </svg>
  );
}
