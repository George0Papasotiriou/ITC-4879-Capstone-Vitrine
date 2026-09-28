/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * The user study's tasks, participant codes, and turning recorded events into timed attempts.
 */

import type { Attempt, TaskOutcome } from "@/lib/study/analysis";

/**
 * docs/adr/037, docs/report/user-study/protocol.md. Six tasks, one per thing
 * the shop claims to do differently. Their wording lives in the messages
 * (study.tasks.<id>) so a participant reads them in their own language.
 */
export const STUDY_TASKS = ["find", "size", "room", "concierge", "comfort", "data"] as const;
export type StudyTask = (typeof STUDY_TASKS)[number];

/** A participant is a code the moderator gives out, P01 to P99: nothing that says who they are. */
export const PARTICIPANT_CODE = /^P\d{2}$/;
export const STUDY_COOKIE = "vt_study";

export const STUDY_EVENTS = ["start", "success", "partial", "fail"] as const;
export type StudyEvent = (typeof STUDY_EVENTS)[number];

/**
 * Pairs each start with the next outcome for the same participant and task;
 * the time between them is the time on task. A start with no outcome (the
 * session ended, the page was closed) is left out rather than guessed; a
 * second start before an outcome restarts the clock.
 */
export function attemptsFromEvents(events: readonly { participant: string; task: string; event: string; at: Date }[]): Attempt[] {
  const attempts: Attempt[] = [];
  const open = new Map<string, Date>();
  for (const entry of [...events].sort((a, b) => a.at.getTime() - b.at.getTime())) {
    const key = `${entry.participant}|${entry.task}`;
    if (entry.event === "start") {
      open.set(key, entry.at);
      continue;
    }
    const started = open.get(key);
    if (started === undefined || !["success", "partial", "fail"].includes(entry.event)) continue;
    open.delete(key);
    attempts.push({ participant: entry.participant, task: entry.task, outcome: entry.event as TaskOutcome, seconds: Math.round((entry.at.getTime() - started.getTime()) / 1000) });
  }
  return attempts;
}
