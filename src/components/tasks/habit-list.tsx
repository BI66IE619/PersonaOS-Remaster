"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { addHabit, removeHabit, toggleHabit } from "@/lib/habits";
import { bestStreak, currentStreak } from "@/lib/streaks";
import { addDays } from "@/lib/dates";
import { EmptyState } from "@/components/empty-state";
import type { Habit } from "@/lib/types-habits";
import { solid } from "@/lib/theme";

/* Fourteen days reads as "recent rhythm" without becoming a wall of dots. */
const TRACKED = 14;

function streakLabel(n: number) {
  if (n === 0) return "no streak yet";
  return `${n} day${n === 1 ? "" : "s"}`;
}

function Tick() {
  return (
    <svg viewBox="0 0 12 12" aria-hidden className="h-3 w-3">
      <path
        d="M2.5 6.4 4.8 8.7 9.5 3.9"
        fill="none"
        stroke="var(--color-base)"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Cross() {
  return (
    <svg viewBox="0 0 12 12" aria-hidden className="h-2.5 w-2.5">
      <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function HabitRow({
  habit,
  today,
  onAskDelete,
}: {
  habit: Habit;
  today: string;
  onAskDelete: (habit: Habit) => void;
}) {
  const done = new Set(habit.days);
  const streak = currentStreak(habit.days, today);
  const best = bestStreak(habit.days);
  const doneToday = done.has(today);

  return (
    <li className="flex items-center gap-4 py-3.5 first:pt-1">
      <button
        type="button"
        role="checkbox"
        aria-checked={doneToday}
        aria-label={`${doneToday ? "Undo" : "Complete"} "${habit.name}" for today`}
        onClick={() => toggleHabit(habit.id, today)}
        className={[
          "grid h-7 w-7 shrink-0 place-items-center rounded-full border transition-colors",
          doneToday
            ? "border-transparent bg-ink"
            : "border-hairline-strong hover:border-[var(--color-accent-dim)] hover:bg-white/[0.07]",
        ].join(" ")}
      >
        {doneToday ? <Tick /> : null}
      </button>

      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] text-ink-2">{habit.name}</p>
        <p className="num mt-0.5 text-[10px] text-ink-3">{streakLabel(streak)}</p>
      </div>

      <div className="hidden items-center gap-1 sm:flex" aria-hidden>
        {Array.from({ length: TRACKED }, (_, i) => addDays(today, i - (TRACKED - 1))).map((d) => (
          <span
            key={d}
            className={[
              "h-1.5 w-1.5 rounded-full",
              done.has(d) ? "bg-[var(--color-accent-dim)]" : "bg-white/[0.12]",
            ].join(" ")}
          />
        ))}
      </div>

      <div className="flex shrink-0 items-center gap-4">
        <div className="text-right">
          <p className="num text-[15px] leading-none text-ink-2">{streak}</p>
          <p className="mt-1 text-[9px] uppercase tracking-wider text-ink-3">streak</p>
        </div>
        <div className="hidden text-right sm:block">
          <p className="num text-[15px] leading-none text-ink-3">{best}</p>
          <p className="mt-1 text-[9px] uppercase tracking-wider text-ink-3">best</p>
        </div>
        <button
          type="button"
          aria-label={`Delete habit "${habit.name}"`}
          onClick={() => onAskDelete(habit)}
          className="grid h-6 w-6 place-items-center rounded-full text-ink-3 transition-colors hover:bg-white/[0.07] hover:text-ink-2"
        >
          <Cross />
        </button>
      </div>
    </li>
  );
}

/* The panel and tile styles are translucent glass, which only works on top of the
   dark page. A modal has nothing solid behind it, so it carries its own surfaces
   instead of those utilities — `solid`, now shared with SportForm's and the
   mentor's, since three dialogs is past the point of retyping the token. */

/**
 * The confirmation in front of deleting a habit.
 *
 * A habit carries its own record: `days` is the only place the streak and the
 * best are kept, and both are derived from it rather than stored separately. So
 * deleting the habit deletes the streak with it, and there is nothing left to
 * rebuild from. This panel used to also offer a "Clear habits" button that wiped
 * every habit and every streak at once, with no confirmation anywhere — one
 * stray press and a month of work was gone in a heartbeat. Deleting one habit at
 * a time, behind this, is what replaced it.
 *
 * The dialog states the actual cost in numbers rather than a vague warning,
 * because the number is the thing that makes someone read it. Focus starts on
 * Keep it, so the safe choice is the one a stray Enter press takes.
 */
function ConfirmDeleteHabit({
  habit,
  today,
  onCancel,
  onConfirm,
}: {
  habit: Habit;
  today: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const keep = useRef<HTMLButtonElement>(null);
  const done = habit.days.length;
  const streak = currentStreak(habit.days, today);
  const best = bestStreak(habit.days);

  /* Built as a list and joined, so no combination of streak and best can repeat
     or drop a part of the sentence. */
  const losses = [
    streak > 0 ? `a ${streak}-day streak` : null,
    best > 0 ? `a best of ${best}` : null,
    `${done} tracked ${done === 1 ? "day" : "days"}`,
  ].filter(Boolean);

  useEffect(() => {
    keep.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center p-4"
      style={solid.overlay}
      role="dialog"
      aria-modal="true"
      aria-label={`Delete habit ${habit.name}`}
    >
      <div className="w-full max-w-sm p-5" style={solid.card}>
        <span className="label-xs">Are you sure?</span>

        <p className="mt-3 text-sm text-ink">
          Delete <span className="font-medium">{habit.name}</span>?
        </p>

        <p className="mt-2 text-[11px] leading-relaxed text-ink-3">
          {done > 0 ? (
            <>That takes {losses.join(", ")} with it. There is no undo.</>
          ) : (
            <>It has no days tracked yet, so there is nothing to lose. There is no undo.</>
          )}
        </p>

        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            ref={keep}
            type="button"
            onClick={onCancel}
            className="rounded-md border border-hairline px-3 py-1.5 text-[11px] text-ink-3 transition-colors hover:border-[var(--color-accent)]"
          >
            Keep it
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-md border px-3 py-1.5 text-[11px] font-medium text-ink transition-colors"
            style={{ borderColor: "var(--color-low)" }}
          >
            Delete habit
          </button>
        </div>
      </div>
    </div>
  );
}

export function HabitList({ habits, today }: { habits: Habit[]; today: string }) {
  const [name, setName] = useState("");
  const [asking, setAsking] = useState<Habit | null>(null);
  const field = useRef<HTMLInputElement>(null);

  /* Stable, so the dialog's focus and Escape listener are not torn down and set
     up again on every keystroke anywhere above it. */
  const cancelDelete = useCallback(() => setAsking(null), []);
  const confirmDelete = useCallback(() => {
    if (asking) removeHabit(asking.id);
    setAsking(null);
  }, [asking]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const value = name.trim();
    if (!value) return;
    addHabit(value);
    setName("");
  };

  return (
    <div className="panel flex flex-col p-5">
      <div className="flex items-center justify-between gap-3">
        <span className="label-xs">Habits</span>
        <span className="num text-[10px] text-ink-3">
          {habits.length ? `${habits.length} tracked` : ""}
        </span>
      </div>

      {habits.length ? (
        <ul className="divide-y divide-hairline">
          {habits.map((h) => (
            <HabitRow key={h.id} habit={h} today={today} onAskDelete={setAsking} />
          ))}
        </ul>
      ) : (
        /* The way out is the field directly below, so the action points at it
           rather than at a link to this same screen. */
        <EmptyState
          title="Nothing tracked."
          detail="Add a habit and it counts from today. Tap its circle to mark a day done, and the streak and the fourteen dots build themselves from there."
          action={{ label: "Name the first one", onClick: () => field.current?.focus() }}
        />
      )}

      <form onSubmit={submit} className="mt-4 flex items-center gap-2 border-t border-hairline pt-4">
        <input
          ref={field}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Add a habit"
          aria-label="New habit name"
          className="min-w-0 flex-1 bg-transparent text-[13px] text-ink-2 outline-none placeholder:text-ink-3"
        />
        <button
          type="submit"
          disabled={!name.trim()}
          className="rounded-lg border border-hairline px-3 py-1.5 text-[11px] text-ink-2 transition-colors enabled:hover:bg-white/[0.07] enabled:hover:text-ink disabled:opacity-30"
        >
          Add
        </button>
      </form>

      {asking ? (
        <ConfirmDeleteHabit
          habit={asking}
          today={today}
          onCancel={cancelDelete}
          onConfirm={confirmDelete}
        />
      ) : null}
    </div>
  );
}
