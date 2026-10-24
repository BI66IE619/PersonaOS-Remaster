"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  addHabit,
  moveHabit,
  removeHabit,
  renameHabit,
  setHabitSchedule,
  toggleHabit,
} from "@/lib/habits";
import { bestStreak, currentStreak } from "@/lib/streaks";
import { addDays } from "@/lib/dates";
import { EVERY_DAY, WEEKDAYS, isScheduled, scheduleLabel } from "@/lib/habit-schedule";
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

function Pencil() {
  return (
    <svg viewBox="0 0 12 12" aria-hidden className="h-3 w-3">
      <path
        d="M2.6 9.4l.3-1.4 5-5 1.1 1.1-5 5-1.4.3z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinejoin="round"
      />
      <path d="M7.4 3.5l1.1 1.1" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
    </svg>
  );
}

function Caret({ up }: { up: boolean }) {
  return (
    <svg viewBox="0 0 12 12" aria-hidden className="h-2.5 w-2.5">
      <path
        d={up ? "M3 7.5 6 4.5l3 3" : "M3 4.5 6 7.5l3-3"}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Seven toggles, Monday first. Shared by the add form and the inline editor so
 *  the two cannot disagree about what a selected day looks like. */
function DayPicker({
  value,
  onChange,
  small = false,
}: {
  value: readonly number[];
  onChange: (next: number[]) => void;
  small?: boolean;
}) {
  const toggle = (day: number) => {
    const next = value.includes(day)
      ? value.filter((d) => d !== day)
      : [...value, day].sort((a, b) => a - b);
    /* Zero selected days would mean a habit that is never due. Treat that as
       "every day" rather than storing something nobody can satisfy. */
    onChange(next.length ? next : EVERY_DAY);
  };
  return (
    <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Days of the week">
      {WEEKDAYS.map((d) => {
        const on = value.includes(d.value);
        return (
          <button
            key={d.value}
            type="button"
            aria-pressed={on}
            aria-label={d.label}
            title={d.label}
            onClick={() => toggle(d.value)}
            className={[
              "num grid place-items-center rounded-full border transition-colors",
              small ? "h-5 w-5 text-[9px]" : "h-6 w-6 text-[10px]",
              on
                ? "border-[var(--color-accent-dim)] bg-white/[0.10] text-ink"
                : "border-hairline text-ink-3 hover:text-ink-2",
            ].join(" ")}
          >
            {d.short}
          </button>
        );
      })}
    </div>
  );
}

function HabitRow({
  habit,
  today,
  onAskDelete,
  canUp,
  canDown,
  onMoveUp,
  onMoveDown,
}: {
  habit: Habit;
  today: string;
  onAskDelete: (habit: Habit) => void;
  canUp: boolean;
  canDown: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  const done = new Set(habit.days);
  const scheduledToday = isScheduled(today, habit.schedule);
  const streak = currentStreak(habit.days, today, habit.schedule);
  const best = bestStreak(habit.days, habit.schedule);
  const doneToday = done.has(today);
  const everyDay = habit.schedule.length === 0 || habit.schedule.length === 7;

  /* Name and schedule are edited together, because those are the two things a
     habit is. It stays in place rather than routing through the delete dialog: the
     point of both edits is that the history does not move. Save and Escape are
     explicit so a day toggle, which takes focus, cannot be mistaken for leaving
     the field and commit the half-finished edit. */
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(habit.name);
  const [draftDays, setDraftDays] = useState<number[]>(
    habit.schedule.length ? habit.schedule : EVERY_DAY,
  );
  const field = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editing) return;
    const el = field.current;
    el?.focus();
    el?.select();
  }, [editing]);

  const startEdit = () => {
    setDraft(habit.name);
    setDraftDays(habit.schedule.length ? habit.schedule : EVERY_DAY);
    setEditing(true);
  };

  const commit = () => {
    const value = draft.trim();
    if (value && value !== habit.name) renameHabit(habit.id, value);

    const nextDays = draftDays.length ? draftDays : EVERY_DAY;
    const before = [...(habit.schedule.length ? habit.schedule : EVERY_DAY)]
      .sort((a, b) => a - b)
      .join(",");
    const after = [...nextDays].sort((a, b) => a - b).join(",");
    if (after !== before) setHabitSchedule(habit.id, nextDays);

    setEditing(false);
  };

  const cancel = () => {
    setDraft(habit.name);
    setDraftDays(habit.schedule.length ? habit.schedule : EVERY_DAY);
    setEditing(false);
  };

  return (
    <li className="flex items-center gap-4 py-3.5 first:pt-1">
      <button
        type="button"
        role="checkbox"
        aria-checked={doneToday}
        aria-label={
          scheduledToday
            ? `${doneToday ? "Undo" : "Complete"} "${habit.name}" for today`
            : `${habit.name} is not scheduled today`
        }
        onClick={() => toggleHabit(habit.id, today)}
        disabled={!scheduledToday}
        title={scheduledToday ? undefined : "Rest day"}
        className={[
          "grid h-7 w-7 shrink-0 place-items-center rounded-full border transition-colors",
          !scheduledToday
            ? "cursor-default border-hairline opacity-40"
            : doneToday
              ? "border-transparent bg-ink"
              : "border-hairline-strong hover:border-[var(--color-accent-dim)] hover:bg-white/[0.07]",
        ].join(" ")}
      >
        {doneToday ? <Tick /> : null}
      </button>

      <div className="min-w-0 flex-1">
        {editing ? (
          <div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                commit();
              }}
            >
              <input
                ref={field}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    e.preventDefault();
                    cancel();
                  }
                }}
                aria-label="Habit name"
                maxLength={60}
                className="w-full border-b border-hairline-strong bg-transparent pb-0.5 text-[13px] text-ink outline-none focus:border-[var(--color-accent)]"
              />
            </form>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <DayPicker value={draftDays} onChange={setDraftDays} small />
              <button
                type="button"
                onClick={commit}
                className="rounded border border-hairline px-1.5 py-0.5 text-[10px] text-ink-2 transition-colors hover:border-[var(--color-accent)]"
              >
                Save
              </button>
              <button
                type="button"
                onClick={cancel}
                className="text-[10px] text-ink-3 transition-colors hover:text-ink-2"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <p className="truncate text-[13px] text-ink-2">{habit.name}</p>
        )}
        <p className="num mt-0.5 text-[10px] text-ink-3">
          {scheduledToday ? streakLabel(streak) : "rest day"}
          {everyDay ? "" : ` · ${scheduleLabel(habit.schedule)}`}
        </p>
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
        <div className="flex items-center gap-1">
          <div className="flex flex-col">
            <button
              type="button"
              aria-label={`Move "${habit.name}" up`}
              onClick={onMoveUp}
              disabled={!canUp}
              className="grid h-3.5 w-5 place-items-center rounded text-ink-3 transition-colors hover:bg-white/[0.07] hover:text-ink-2 disabled:opacity-20"
            >
              <Caret up />
            </button>
            <button
              type="button"
              aria-label={`Move "${habit.name}" down`}
              onClick={onMoveDown}
              disabled={!canDown}
              className="grid h-3.5 w-5 place-items-center rounded text-ink-3 transition-colors hover:bg-white/[0.07] hover:text-ink-2 disabled:opacity-20"
            >
              <Caret up={false} />
            </button>
          </div>
          <button
            type="button"
            aria-label={`Rename habit "${habit.name}"`}
            onClick={startEdit}
            className="grid h-6 w-6 place-items-center rounded-full text-ink-3 transition-colors hover:bg-white/[0.07] hover:text-ink-2"
          >
            <Pencil />
          </button>
          <button
            type="button"
            aria-label={`Delete habit "${habit.name}"`}
            onClick={() => onAskDelete(habit)}
            className="grid h-6 w-6 place-items-center rounded-full text-ink-3 transition-colors hover:bg-white/[0.07] hover:text-ink-2"
          >
            <Cross />
          </button>
        </div>
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
  const streak = currentStreak(habit.days, today, habit.schedule);
  const best = bestStreak(habit.days, habit.schedule);

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
  const [days, setDays] = useState<number[]>(EVERY_DAY);
  const [asking, setAsking] = useState<Habit | null>(null);
  const [showNotDue, setShowNotDue] = useState(true);
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
    addHabit(value, days);
    setName("");
  };

  /* Split at the schedule boundary, in stored order within each group. The two
     read as separate lists rather than one list with a few faded rows, and the
     move buttons' neighbours are the ones in the same group — moving a habit past
     a day it is not due on would be meaningless. */
  const due = habits.filter((h) => isScheduled(today, h.schedule));
  const notDue = habits.filter((h) => !isScheduled(today, h.schedule));

  return (
    <div className="panel flex flex-col p-5">
      <div className="flex items-center justify-between gap-3">
        <span className="label-xs">Habits</span>
        <span className="num text-[10px] text-ink-3">
          {habits.length ? `${habits.length} tracked` : ""}
        </span>
      </div>

      {habits.length ? (
        <>
          <ul className="divide-y divide-hairline">
            {due.map((h, i) => (
              <HabitRow
                key={h.id}
                habit={h}
                today={today}
                onAskDelete={setAsking}
                canUp={i > 0}
                canDown={i < due.length - 1}
                onMoveUp={() => moveHabit(h.id, due[i - 1].id)}
                onMoveDown={() => moveHabit(h.id, due[i + 1].id)}
              />
            ))}
          </ul>

          {notDue.length ? (
            <div className="mt-3 border-t border-hairline pt-2">
              <div className="flex items-center justify-between gap-3">
                <span className="text-[10px] uppercase tracking-wider text-ink-3">
                  Not due today
                </span>
                <button
                  type="button"
                  onClick={() => setShowNotDue((v) => !v)}
                  aria-expanded={showNotDue}
                  className="text-[10px] text-ink-3 transition-colors hover:text-ink-2"
                >
                  {showNotDue ? "Hide" : "Show"}
                </button>
              </div>
              {showNotDue ? (
                <ul className="mt-1 divide-y divide-hairline opacity-60">
                  {notDue.map((h, i) => (
                    <HabitRow
                      key={h.id}
                      habit={h}
                      today={today}
                      onAskDelete={setAsking}
                      canUp={i > 0}
                      canDown={i < notDue.length - 1}
                      onMoveUp={() => moveHabit(h.id, notDue[i - 1].id)}
                      onMoveDown={() => moveHabit(h.id, notDue[i + 1].id)}
                    />
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </>
      ) : (
        /* The way out is the field directly below, so the action points at it
           rather than at a link to this same screen. */
        <EmptyState
          title="Nothing tracked."
          detail="Add a habit and it counts from today. Tap its circle to mark a day done, and the streak and the fourteen dots build themselves from there."
          action={{ label: "Name the first one", onClick: () => field.current?.focus() }}
        />
      )}

      <form onSubmit={submit} className="mt-4 space-y-2 border-t border-hairline pt-4">
        <div className="flex items-center gap-2">
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
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-[10px] text-ink-3">Days it happens</span>
          <DayPicker value={days} onChange={setDays} />
        </div>
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
