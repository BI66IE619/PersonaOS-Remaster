"use client";

import { useSyncExternalStore } from "react";
import { getServerSnapshot, getSnapshot, subscribe } from "@/lib/strength";
import { liftProgress, type LiftProgress } from "@/lib/insights";
import { relativeDayLabel } from "@/lib/dates";

/**
 * Personal bests, and what they beat.
 *
 * The existing "Lifts that have stalled" panel only speaks up when something has
 * gone quiet, so a person lifting more every week gets told nothing at all. This
 * is the other half of the same read: the case where the log has good news.
 *
 * Every number is shown as the set that produced it, because an estimated
 * one-rep max on its own is a claim with nothing behind it. "180lb x 3" can be
 * checked against the log; "180lb estimated" cannot.
 */
export function StrengthProgress({ date }: { date: string }) {
  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const lifts = liftProgress(state, date);

  return (
    <div className="panel p-5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="label-xs">Personal bests</span>
        {lifts.length > 0 ? (
          <span className="num text-[10px] text-ink-3">
            {lifts.length} {lifts.length === 1 ? "movement" : "movements"}
          </span>
        ) : null}
      </div>

      {lifts.length === 0 ? (
        <p className="mt-3 text-xs leading-relaxed text-ink-3">
          Log a weighted set and your best lifts show up here. A movement with no
          weight on it is left out, because reps alone do not make a record.
        </p>
      ) : (
        <ul className="mt-3 space-y-2.5">
          {lifts.map((l) => (
            <Lift key={l.exerciseId} lift={l} date={date} />
          ))}
        </ul>
      )}
    </div>
  );
}

function Lift({ lift, date }: { lift: LiftProgress; date: string }) {
  const gained = (lift.gainLb ?? 0) > 0;
  return (
    <li className="tile px-3 py-2.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 truncate text-sm font-medium">{lift.name}</span>
        <span className="num shrink-0 text-sm font-medium">{lift.bestLb}lb</span>
      </div>

      <div className="num mt-0.5 text-[11px] text-ink-3">
        {lift.bestWeightLb}lb x {lift.bestReps} · {relativeDayLabel(lift.bestDate, date)}
        {lift.sessions > 1 ? ` · ${lift.sessions} sessions` : ""}
      </div>

      <div className="mt-1 text-[11px] text-ink-3">
        {lift.priorLb === null ? (
          "First month on record. A change shows up once there is a month behind it."
        ) : lift.gainLb === 0 ? (
          `Still at ${lift.priorLb}lb over the last month.`
        ) : gained ? (
          `+${lift.gainLb}lb on a month ago's ${lift.priorLb}lb.`
        ) : (
          `${lift.gainLb}lb on a month ago's ${lift.priorLb}lb.`
        )}
      </div>
    </li>
  );
}
