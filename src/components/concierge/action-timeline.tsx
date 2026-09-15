"use client";

/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Concierge action timeline listing every action with its own undo.
 */

import { AnimatePresence, motion } from "motion/react";
import { useTranslations } from "next-intl";

import { useSpotlight } from "@/components/concierge/spotlight";
import { cn } from "@/lib/ui/cn";

/**
 * Action timeline (docs/PLAN.md 4.3, 2.5)
 *
 * The written record of everything the Concierge did, newest last, each with
 * its own Undo. The Spotlight shows an action happening; this shows what has
 * happened — which is what you need when the light has already moved on.
 *
 * Undo is per entry rather than a single stack pop, because the Concierge often
 * does several things in one turn and a person usually wants to take back one
 * of them, not all of them.
 */
export function ActionTimeline({ className }: { className?: string }) {
  const { timeline, undo } = useSpotlight();
  const t = useTranslations("concierge");

  if (timeline.length === 0) {
    return (
      <p className={cn("text-slate text-sm", className)}>
        {t("emptyTimeline")}
      </p>
    );
  }

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <h3 className="text-slate mb-1 text-sm">{t("actions")}</h3>
      <ul aria-label={t("actionsListLabel")} className="flex flex-col">
        <AnimatePresence initial={false}>
          {timeline.map((entry) => (
            <motion.li
              key={entry.id}
              layout
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.16 }}
              className="border-hairline flex items-center gap-3 border-b py-2 last:border-b-0"
            >
              {/* Lumen marks the Concierge's own actions. It is the only place
                  the colour appears outside the Spotlight itself (4.2). */}
              <span
                className={cn(
                  "size-1.5 shrink-0 rounded-full",
                  entry.undone ? "bg-hairline" : "bg-lumen",
                )}
                aria-hidden="true"
              />

              <span
                className={cn(
                  "min-w-0 flex-1 text-sm",
                  entry.undone && "text-slate line-through",
                )}
              >
                {entry.caption}
              </span>

              {entry.undo === undefined ? null : entry.undone ? (
                <span className="text-slate shrink-0 text-sm">{t("undone")}</span>
              ) : (
                <button
                  type="button"
                  onClick={() => void undo(entry.id)}
                  className="text-dusk shrink-0 cursor-pointer px-1 text-sm underline underline-offset-4"
                >
                  {t("undo")}
                </button>
              )}
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
    </div>
  );
}

/**
 * The Concierge's presence, shown as light rather than a face, a robot or a
 * sparkle icon (4.4). It breathes only while listening; nothing else in the
 * interface loops (4.5).
 */
export function LumenPresence({
  state,
  className,
}: {
  state: "idle" | "listening" | "thinking" | "speaking" | "acting";
  className?: string;
}) {
  const t = useTranslations("concierge");
  const label = t(state);

  return (
    <span className={cn("inline-flex items-center gap-2 text-sm", className)}>
      <motion.span
        className="bg-lumen block size-2 rounded-full"
        animate={
          state === "listening"
            ? { opacity: [0.45, 1, 0.45], scale: [1, 1.25, 1] }
            : { opacity: state === "idle" ? 0.45 : 1, scale: 1 }
        }
        transition={
          state === "listening"
            ? { duration: 2.4, repeat: Infinity, ease: "easeInOut" }
            : { duration: 0.16 }
        }
      />
      <span className="text-slate">{label}</span>
    </span>
  );
}
