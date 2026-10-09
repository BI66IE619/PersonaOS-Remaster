import type { TodayView } from "../types";
import { dayKeyInTz } from "../dates";

/**
 * The honest empty view: what the app shows when there is no real data yet.
 *
 * This replaces the generated mock that used to stand in. The mock was written for
 * a design sprint with no data layer, and it kept being shown long after there was
 * a real one — so the app displayed invented sleep and steps beside real numbers,
 * with nothing to say which was which. Nothing is invented here: every figure is
 * zero and the verdict says why, so an empty screen reads as "not connected yet"
 * rather than as a bad night.
 */
const STEP_GOAL = 9000;

export function emptyTodayView(now: Date = new Date(), timezone = "UTC"): TodayView {
  const date = dayKeyInTz(now, timezone);
  const iso = now.toISOString();
  return {
    date,
    readiness: { score: 0, band: "low" },
    verdict: "No data yet. Open the app on your phone and sync Health Connect.",
    drivers: [],
    lastNight: { totalMin: 0, stages: [], efficiency: 0, bedtime: iso, wakeTime: iso },
    today: {
      workouts: [],
      steps: 0,
      stepGoal: STEP_GOAL,
      activeMin: 0,
      loadScore: 0,
      calories: { total: 0, active: 0 },
    },
    body: { weightKg: 0, weightDeltaKg: 0, bodyFatPct: 0, points: [], mean: 0 },
    sparks: [],
    sleepSeries: [],
    freshness: { latestAt: iso, isStale: true },
    timezone,
  };
}
