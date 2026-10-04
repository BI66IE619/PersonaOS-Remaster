import type { DataProvider, TodayView } from "../types";
import { MOCK_TZ, STEP_GOAL, generateHistory } from "../seed";
import { round } from "../utils";
import {
  buildSparks,
  buildVerdict,
  computeBaselines,
  computeReadiness,
  computeSignals,
  toDrivers,
  toStages,
} from "../scoring";

function asleepRatio(sleep: { deepMin: number; remMin: number; lightMin: number; totalMin: number }) {
  return (sleep.deepMin + sleep.remMin + sleep.lightMin) / sleep.totalMin;
}

/**
 * Phase 1 provider. Renders the frozen TodayView from 120 days of generated
 * history. No database, no network — so the design sprint can iterate freely
 * without touching data code.
 *
 * Still the fallback rather than deleted, because it is what the tab shows before
 * the phone has ever synced. Swapping it out entirely would leave Vitality blank
 * on a first run, and a blank readiness ring reads as a broken app rather than as
 * no data yet.
 */
export class MockProvider implements DataProvider {
  async getToday(): Promise<TodayView> {
    const now = new Date();
    const history = generateHistory(now);
    const today = history[history.length - 1];

    const baselines = computeBaselines(history);
    const signals = computeSignals(history, baselines);
    const readiness = computeReadiness(signals);

    // Vary the phrasing per calendar day so the verdict doesn't read as canned.
    const variant = Math.floor(now.getTime() / 86_400_000) % 3;

    return {
      date: today.date,
      readiness,
      verdict: buildVerdict({
        score: readiness.score,
        band: readiness.band,
        signals,
        sleep: today.sleep,
        today,
        variant,
      }),
      drivers: toDrivers(signals, 3),
      lastNight: {
        totalMin: today.sleep.totalMin,
        stages: toStages(today.sleep),
        efficiency: asleepRatio(today.sleep),
        bedtime: today.sleep.bedtimeUtc,
        wakeTime: today.sleep.wakeTimeUtc,
      },
      today: {
        workouts: today.workouts,
        steps: today.steps,
        stepGoal: STEP_GOAL,
        activeMin: today.activeMin,
        loadScore: today.loadScore,
        calories: today.calories,
      },
      body: (() => {
        const window30 = history.slice(-30);
        const mean =
          window30.reduce((sum, d) => sum + d.weightKg, 0) / window30.length;
        return {
          weightKg: today.weightKg,
          weightDeltaKg: round(today.weightKg - window30[0].weightKg, 1),
          bodyFatPct: today.bodyFatPct,
          points: window30.map((d) => ({ date: d.date, value: d.weightKg })),
          mean,
        };
      })(),
      sparks: buildSparks(history, baselines),
      sleepSeries: history.map((d) => ({ date: d.date, totalMin: d.sleep.totalMin })),
      freshness: {
        latestAt: today.sleep.wakeTimeUtc,
        isStale: now.getTime() - Date.parse(today.sleep.wakeTimeUtc) > 86_400_000,
      },
      timezone: MOCK_TZ,
    };
  }
}
