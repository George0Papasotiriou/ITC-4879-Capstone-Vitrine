/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Evaluation E6, the user study: scoring the SUS questionnaire, and intervals for small samples.
 */

import { seededRandom } from "@/lib/reco/simulate";

/**
 * docs/adr/037. With 8 to 12 participants, a single average hides how little
 * it can be trusted, so every figure the study reports carries an interval:
 *
 *   Completion rate  Wilson score interval (95%). Unlike the textbook
 *                    p ± 1.96·√(p(1−p)/n), it stays inside [0, 1] and is not
 *                    zero-width when everyone (or no one) succeeds — both
 *                    likely with ten people.
 *   Time on task,    percentile bootstrap (95%): resample the participants
 *   SUS              with replacement 10,000 times, take the statistic each
 *                    time, and read the 2.5th and 97.5th percentiles. It
 *                    assumes nothing about the shape of the distribution;
 *                    the resampling is seeded, so a rerun gives the same
 *                    interval.
 */

/**
 * The System Usability Scale (Brooke, 1996): ten statements answered 1–5.
 * Odd items are worded positively (score − 1), even items negatively
 * (5 − score); the sum times 2.5 gives 0–100. About 68 is average across
 * published studies.
 */
export function susScore(answers: readonly number[]): number {
  if (answers.length !== 10 || answers.some((answer) => !Number.isInteger(answer) || answer < 1 || answer > 5)) {
    throw new Error("SUS needs ten answers, each 1 to 5.");
  }
  const sum = answers.reduce((total, answer, index) => total + (index % 2 === 0 ? answer - 1 : 5 - answer), 0);
  return sum * 2.5;
}

export type Interval = { estimate: number; low: number; high: number };

/** Wilson score interval for a proportion. */
export function wilsonInterval(successes: number, n: number, z = 1.96): Interval | null {
  if (n === 0) return null;
  const p = successes / n;
  const z2 = z * z;
  const centre = (p + z2 / (2 * n)) / (1 + z2 / n);
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / (1 + z2 / n);
  return { estimate: p, low: Math.max(0, centre - half), high: Math.min(1, centre + half) };
}

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

export const mean = (values: readonly number[]) => (values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length);

/** Percentile bootstrap interval of `statistic` over `values`. */
export function bootstrapInterval(values: readonly number[], statistic: (sample: readonly number[]) => number | null, { iterations = 10_000, seed = 20260926, level = 0.95 } = {}): Interval | null {
  const estimate = statistic(values);
  if (estimate === null || values.length === 0) return null;
  const random = seededRandom(seed);
  const draws: number[] = [];
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const sample = Array.from({ length: values.length }, () => values[Math.floor(random() * values.length)]!);
    const value = statistic(sample);
    if (value !== null) draws.push(value);
  }
  draws.sort((a, b) => a - b);
  const at = (quantile: number) => draws[Math.min(draws.length - 1, Math.max(0, Math.floor(quantile * draws.length)))]!;
  return { estimate, low: at((1 - level) / 2), high: at(1 - (1 - level) / 2) };
}

export type TaskOutcome = "success" | "partial" | "fail";

/** One participant's attempt at one task, as the study mode records it. */
export type Attempt = { participant: string; task: string; outcome: TaskOutcome; seconds: number };

export type TaskSummary = { task: string; attempts: number; completion: Interval | null; medianSeconds: Interval | null };

/** Completion counts a success as 1 and a partial success as neither (reported apart); time is for successes only. */
export function summariseTasks(attempts: readonly Attempt[], tasks: readonly string[]): TaskSummary[] {
  return tasks.map((task) => {
    const mine = attempts.filter((attempt) => attempt.task === task);
    const successes = mine.filter((attempt) => attempt.outcome === "success");
    return {
      task,
      attempts: mine.length,
      completion: wilsonInterval(successes.length, mine.length),
      medianSeconds: bootstrapInterval(successes.map((attempt) => attempt.seconds), median),
    };
  });
}
