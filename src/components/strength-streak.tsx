"use client";

import { useSyncExternalStore } from "react";
import {
  getSnapshot,
  getServerSnapshot,
  liftingStreak,
  sessionProgress,
  subscribe,
} from "@/lib/strength";
import { addDays } from "@/lib/dates";

/** A fortnight, which is long enough to show a rhythm and short enough to read. */
const WINDOW = 14;

/**
 * Lifting streak: consecutive days the workout was actually finished.
 *
 * A day counts only when every movement with a target was worked to it, which is
 * the same rule the Workout habit on Home uses. One is derived from the other
 * rather than counted separately, so the streak and the habit can never disagree
 * about whether a session happened.
 *
 * The panel is a flex column because it is given `flex-1` by Body, where it is
 * the last panel in the right-hand stack. That column is usually shorter than
 * the one beside it, and the fortnight strip is what takes up the difference —
 * the strip is the visual centre of the box, so letting it grow reads as a
 * deliberate chart rather than as a pool of blank at the bottom. `justify-center`
 * keeps it centred in the slack instead of pinned under the header.
 */
export function StrengthStreak({
  date,
  className = "",
}: {
  date: string;
  className?: string;
}) {
  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const streak = liftingStreak(state, date);
  const { done, total } = sessionProgress(state, date);

  /* Oldest first, so the row reads left to right the way time passes. */
  const days = Array.from({ length: WINDOW }, (_, i) => addDays(date, i - (WINDOW - 1)));
  const filled = days.filter((d) => sessionProgress(state, d).complete).length;
  const todayDone = done === total && total > 0;

  return (
    <div className={`panel p-5 flex flex-col ${className}`}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="label-xs">Lifting streak</span>
        <span className="num text-[10px] text-ink-3">
          {filled} of last {WINDOW}
        </span>
      </div>

      <p className="mt-3">
        <span className="text-xs text-ink-3">Current run: </span>
        <span className="num text-ink">Day {streak}</span>
      </p>

      <div className="mt-3 flex flex-1 flex-col justify-center">
        <span className="block text-[10px] text-ink-3">Last {WINDOW} Days</span>
        <div
          className="mt-1.5 flex gap-1.5"
          role="img"
          aria-label={`${filled} of the last ${WINDOW} days finished. Current run: day ${streak}.`}
        >
          {days.map((d, i) => {
            const done_ = sessionProgress(state, d).complete;
            const isToday = d === date;
            return (
              <span
                key={d}
                title={`${d}${done_ ? " — finished" : ""}`}
                className="dot-in h-5 flex-1 rounded-[3px]"
                /* Left to right, 14ms apart, so the fortnight reads as a wipe
                   rather than fourteen separate events. */
                style={{
                  animationDelay: `${i * 14}ms`,
                  background: done_ ? "var(--color-accent)" : "var(--color-inset)",
                  border: isToday ? "1px solid var(--color-hairline-strong)" : "1px solid transparent",
                }}
              />
            );
          })}
        </div>
      </div>

      <p className="mt-2.5 text-[11px] text-ink-3">
        {total === 0
          ? "Give a movement a set target and finished days start counting."
          : todayDone
            ? "Today is done."
            : `${done} of ${total} movements finished today.`}
      </p>
    </div>
  );
}
