"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import {
  completedDays,
  getServerSnapshot as strengthServer,
  getSnapshot as strengthSnapshot,
  sessionProgress,
  subscribe as strengthSub,
  type SessionProgress,
} from "@/lib/strength";
import { getServerSnapshot, getSnapshot, subscribe, toggleHabit } from "@/lib/habits";
import { EmptyState } from "@/components/empty-state";
import { currentStreak } from "@/lib/streaks";
import type { Habit } from "@/lib/types-habits";

/** The same dot the tickable rows use, so a finished workout reads as finished. */
function Dot({ done }: { done: boolean }) {
  return (
    <span
      className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border transition-colors"
      style={{
        borderColor: done ? "var(--color-accent)" : "var(--color-hairline-strong)",
        background: done ? "var(--color-accent)" : "transparent",
      }}
      aria-hidden
    >
      {done ? (
        <svg viewBox="0 0 12 12" className="h-2.5 w-2.5" aria-hidden>
          <path
            d="M2.5 6.4 4.8 8.7 9.5 3.6"
            fill="none"
            stroke="#07080a"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ) : null}
    </span>
  );
}

function Row({ habit, today }: { habit: Habit; today: string }) {
  const done = habit.days.includes(today);
  const streak = currentStreak(habit.days, today);

  return (
    <div className="flex items-center gap-3 py-1.5">
      <button
        type="button"
        role="checkbox"
        aria-checked={done}
        aria-label={`Mark ${habit.name} done for today`}
        onClick={() => toggleHabit(habit.id, today)}
        className="shrink-0"
      >
        <Dot done={done} />
      </button>

      <span
        className="min-w-0 flex-1 truncate text-sm"
        style={{
          color: done ? "var(--color-ink-2)" : "var(--color-ink)",
          textDecoration: done ? "line-through" : "none",
        }}
      >
        {habit.name}
      </span>

      {streak > 0 ? <span className="num shrink-0 text-[11px] text-ink-3">{streak}d</span> : null}
    </div>
  );
}

/**
 * Worked out from the sets actually logged, not stored as a habit. That is the
 * whole point: it cannot be ticked by hand, so it can never claim a workout you
 * did not do, and deleting a set un-ticks it on its own.
 *
 * Read-only, so it is a link to the log rather than a checkbox — a box you can
 * tap is a box that eventually gets tapped by accident.
 */
function WorkoutRow({ progress, streak }: { progress: SessionProgress; streak: number }) {
  const done = progress.complete;
  const detail = done
    ? `all ${progress.total} movements`
    : `${progress.done} of ${progress.total} movements`;

  return (
    <Link
      href="/body"
      className="flex items-center gap-3 rounded-md py-1.5 transition-colors hover:bg-white/[0.04]"
    >
      <Dot done={done} />
      <span
        className="min-w-0 flex-1 truncate text-sm"
        style={{
          color: done ? "var(--color-ink-2)" : "var(--color-ink)",
          textDecoration: done ? "line-through" : "none",
        }}
      >
        Workout
      </span>
      <span className="num shrink-0 text-[11px] text-ink-3">
        {streak > 0 ? `${streak}d` : detail}
      </span>
      <span className="num shrink-0 text-lg text-ink-3" aria-hidden>
        &rsaquo;
      </span>
    </Link>
  );
}

/**
 * Today only. Streaks are shown as a quiet fact beside the name rather than as a
 * badge, because a zero-streak badge on the same row as a tick box reads as a
 * telling-off when all it means is "not yet".
 */
export function HabitsTodayPanel({ today }: { today: string }) {
  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const strength = useSyncExternalStore(strengthSub, strengthSnapshot, strengthServer);

  const progress = sessionProgress(strength, today);
  const workoutStreak = currentStreak(completedDays(strength), today);
  /* Nothing tracked yet means there is no workout to keep, so the row stays out
     of the way until the programme is installed. */
  const showWorkout = progress.total > 0;

  /* Unfinished first. A ticked row stays listed, but leaving it where it was
     pushed the things still worth doing to the bottom of the list exactly as the
     day got done. Order within each group is creation order, so rows never
     reshuffle for no reason. */
  const open = state.habits.filter((h) => !h.days.includes(today));
  const done = state.habits.filter((h) => h.days.includes(today));
  const total = state.habits.length + (showWorkout ? 1 : 0);
  const left = open.length + (showWorkout && !progress.complete ? 1 : 0);

  return (
    <section className="panel flex flex-col p-5 lg:col-span-5">
      <div className="flex shrink-0 items-center justify-between gap-3">
        <span className="label-xs">Habits today</span>
        {total > 0 ? (
          <span className="num text-[10px] text-ink-3">
            {total - left}/{total}
          </span>
        ) : null}
      </div>

      {total === 0 ? (
        <EmptyState
          title="Nothing to keep track of yet."
          detail="Add a habit and it joins this list every day. Tap the circle to mark one done, and the streak builds itself from there."
          action={{ href: "/tasks", label: "Add a habit to Plan" }}
        />
      ) : (
        <div className="mt-2 flex flex-1 flex-col justify-center">
          {showWorkout ? <WorkoutRow progress={progress} streak={workoutStreak} /> : null}
          {open.map((h) => (
            <Row key={h.id} habit={h} today={today} />
          ))}
          {done.map((h) => (
            <Row key={h.id} habit={h} today={today} />
          ))}
        </div>
      )}
    </section>
  );
}
