"use client";

import { useSyncExternalStore } from "react";
import { EMPTY_STATE, getSnapshot, subscribe, getServerSnapshot } from "@/lib/strength";
import { EMPTY_LOGS, getSnapshot as getWeights, logsOf, subscribe as subWeights, getServerSnapshot as srvWeights } from "@/lib/weight-log";
import { plateaus, weightTrend } from "@/lib/insights";
import type { StrengthState } from "@/lib/types-strength";

const EMPTY_STRENGTH: StrengthState = { ...EMPTY_STATE, seeded: true };

/**
 * The two calls that need more than one session to make: which lifts have
 * stopped moving, and whether the weight trend has gone flat. Both are the
 * reason a log exists — everything else in Body is a record of what happened,
 * this is the part that tells you what to do about it.
 */
export function TrainingInsights({ date }: { date: string }) {
  const strength = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot) ?? EMPTY_STRENGTH;
  const logs = logsOf(useSyncExternalStore(subWeights, getWeights, srvWeights)) ?? EMPTY_LOGS;

  const stalls = plateaus(strength, date).filter((p) => p.sessionsSince > 0);
  const trend = weightTrend(logs, date);

  return (
    <section className="panel p-5 lg:col-span-12">
      <span className="label-xs">What the log is telling you</span>

      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="tile px-3.5 py-3">
          <span className="label-xs">Weight direction</span>
          <p className={`mt-1.5 text-xs leading-relaxed ${trend.enough ? "text-ink-2" : "text-ink-3"}`}>
            {trend.verdict}
          </p>
        </div>

        <div className="tile px-3.5 py-3">
          <span className="label-xs">Lifts that have stalled</span>
          {stalls.length === 0 ? (
            <p className="mt-1.5 text-xs leading-relaxed text-ink-3">
              {strength.exercises.length === 0
                ? "Nothing logged yet"
                : "Nothing has stalled yet. A movement needs four sessions before this can say anything."}
            </p>
          ) : (
            <ul className="mt-2 space-y-2">
              {stalls.map((p) => (
                <li key={p.exerciseId} className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 text-xs text-ink-2">
                    <span className="font-medium text-ink-1">{p.name}</span>
                    <span className="text-ink-3"> — {p.verdict}</span>
                  </span>
                  {p.bestLb !== null && (
                    <span className="num shrink-0 text-[11px] text-ink-3">
                      e1RM {p.bestLb}lb
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
