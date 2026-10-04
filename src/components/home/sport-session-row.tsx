"use client";

import { useEffect, useState } from "react";
import { useSyncExternalStore } from "react";
import {
  dismissFor,
  getServerSnapshot,
  getSnapshot,
  onDate,
  subscribe,
  syncDeviceWorkouts,
} from "@/lib/sports";
import {
  getServerSnapshot as tasksServer,
  getSnapshot as tasksSnapshot,
  subscribe as tasksSub,
} from "@/lib/tasks";
import { timeLabel } from "@/lib/dates";
import { SportForm } from "@/components/sport-form";
import { SessionDeleteButton, useSessionDelete } from "@/components/sport-session-actions";
import { UndoBar } from "@/components/session-undo";

const fmt = (minutes: number) =>
  minutes >= 60
    ? `${Math.floor(minutes / 60)}h${minutes % 60 ? ` ${minutes % 60}m` : ""}`
    : `${minutes}m`;

type DeviceWorkout = {
  id: string;
  activity: string;
  durationMin: number;
  avgHr: number | null;
  calories: number | null;
};

/**
 * The sports half of training, which the lifting log cannot see. Asked once a
 * day: "no" dismisses it until tomorrow, "yes" opens a five-second form. When
 * the calendar has a sporting event today the prompt names it; otherwise it
 * stays generic. A logged session renders as a plain summary row.
 *
 * A workout the watch already recorded settles the question on its own, so the
 * row shows what happened instead of asking about it. Writing to the log is a
 * side effect of looking at it, which is why it happens in an effect and why
 * syncDeviceWorkouts ignores workouts it has already stored.
 */
export function SportSessionRow({ today, workouts }: { today: string; workouts?: DeviceWorkout[] }) {
  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const tasks = useSyncExternalStore(tasksSub, tasksSnapshot, tasksServer);
  const [open, setOpen] = useState(false);
  const { remove, undo } = useSessionDelete(today);

  useEffect(() => {
    if (workouts) syncDeviceWorkouts(today, workouts);
  }, [today, workouts]);

  const sessions = onDate(state.sessions, today);
  const dismissed = state.dismissed.includes(today);
  const event = tasks.events.find((e) => e.date === today && e.sport);

  if (sessions.length > 0) {
    return (
      <>
        {sessions.map((session) => {
          const label = `${session.sport}, ${fmt(session.minutes)}`;
          return (
            <div key={session.id} className="tile group flex w-full items-center gap-3 px-3 py-2.5">
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{
                  background: session.source === "device" ? "var(--color-accent)" : "var(--color-good)",
                  boxShadow: `0 0 8px ${session.source === "device" ? "var(--color-accent)" : "var(--color-good)"}`,
                }}
              />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">
                  {session.source === "device" ? session.sport : "Sports session"}
                </span>
                <span className="block truncate text-[11px] text-ink-3">
                  {session.source === "manual" && `${session.sport} · ${session.kind === "game" ? "Game" : "Practice"} · `}
                  {fmt(session.minutes)} · intensity {session.intensity}/5
                  {session.source === "device" ? " · from watch" : ""}
                </span>
              </span>
              <SessionDeleteButton
                label={`Delete this session — ${label}`}
                onDelete={() => remove(sessions, session.id, label)}
              />
            </div>
          );
        })}
        {/* Below the rows, not attached to one: the row it refers to is gone. */}
        {undo.pending ? (
          <UndoBar label={undo.pending.label} onUndo={undo.undo} onDismiss={undo.clear} />
        ) : null}
        {open ? <SportForm today={today} onClose={() => setOpen(false)} /> : null}
      </>
    );
  }

  if (dismissed) return null;

  return (
    <>
      <div className="tile flex items-center gap-3 px-3 py-2.5">
        <span
          className="h-2 w-2 shrink-0 rounded-full"
          style={{ background: "var(--color-hairline-strong)" }}
        />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">Sports session?</span>
          <span className="block truncate text-[11px] text-ink-3">
            {event
              ? `${event.title}${event.startMin !== null ? ` · ${timeLabel(event.startMin)}` : ""}`
              : "Practice or game today"}
          </span>
        </span>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="shrink-0 rounded-md border border-hairline px-3 py-1 text-[11px] text-ink-2 transition-colors hover:border-[var(--color-accent)]"
        >
          Yes
        </button>
        <button
          type="button"
          onClick={() => dismissFor(today)}
          className="shrink-0 rounded-md border border-hairline px-3 py-1 text-[11px] text-ink-3 transition-colors hover:border-[var(--color-accent)]"
        >
          No
        </button>
      </div>
      {open ? <SportForm today={today} onClose={() => setOpen(false)} /> : null}
    </>
  );
}
