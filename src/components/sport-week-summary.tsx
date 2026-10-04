"use client";

import { useSyncExternalStore } from "react";
import { getServerSnapshot, getSnapshot, sportWeek, subscribe } from "@/lib/sports";
import { formatDuration } from "@/lib/format";

/**
 * How the week is going, sitting under today's sessions.
 *
 * Counts sport only, and that is the whole point of it. The watch's strength
 * sessions belong to the lifting log, where sets and reps live, and folding them
 * in here would mean the same workout counted in two places. Walking and the
 * elliptical are in neither, so the number is what was actually practised or
 * played rather than everything that moved.
 */
export function SportWeekSummary({ today }: { today: string }) {
  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const { current, deltaMinutes, firstWeek } = sportWeek(state.sessions, today);

  /* Words rather than a signed number: "+40m" is a smaller thing to read at a
     glance than a sentence that says the same thing. */
  const compare = firstWeek
    ? "Your first week on record"
    : deltaMinutes === 0
      ? "Same as the same days last week"
      : `${formatDuration(Math.abs(deltaMinutes))} ${deltaMinutes > 0 ? "more" : "less"} than the same days last week`;

  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

  return (
    <div className="tile px-3 py-3">
      <div className="flex items-baseline justify-between gap-3">
        <span className="label-xs">This week</span>
        <span className="num text-[10px] text-ink-3">{plural(current.days, "day")} in</span>
      </div>

      <div className="num mt-1.5 text-lg font-medium">{formatDuration(current.minutes)}</div>

      <div className="mt-1 text-[11px] text-ink-3">
        {current.sessions === 0
          ? "Nothing logged this week yet"
          : `${plural(current.sessions, "session")} on ${plural(current.trainedDays, "day")}${
              current.restDays > 0 ? ` · ${plural(current.restDays, "rest day")}` : ""
            }`}
      </div>

      {/* Withheld on a first week: there is no last week to be less than, and a
          delta against an empty one would read as a collapse. */}
      {!firstWeek ? <div className="mt-1 text-[11px] text-ink-3">{compare}</div> : null}
    </div>
  );
}
