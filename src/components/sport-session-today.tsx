"use client";

import { useEffect, useState } from "react";
import { useSyncExternalStore } from "react";
import { getServerSnapshot, getSnapshot, onDate, subscribe, syncDeviceWorkouts } from "@/lib/sports";
import { SportForm } from "@/components/sport-form";
import { SessionDeleteButton, useSessionDelete } from "@/components/sport-session-actions";
import { UndoBar } from "@/components/session-undo";
import { formatDuration } from "@/lib/format";
import type { TodayView } from "@/lib/types";

type Workout = TodayView["today"]["workouts"][number];

/**
 * Today's training, from both sources in one list: whatever the watch recorded
 * and whatever was logged by hand. The watch's workouts are written into the
 * log as this component renders, so there is no second list to reconcile and
 * nothing to confirm — a workout that happened is already written down.
 *
 * The add button is for the session nobody planned. Home's question is
 * answered by the watch when there is a workout, and skipped when there is
 * not, so an impromptu session still needs a person to say so.
 */
export function TodaySessions({ date, workouts }: { date: string; workouts: Workout[] }) {
  const sports = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const [open, setOpen] = useState(false);
  const { remove, undo } = useSessionDelete(date);

  useEffect(() => {
    syncDeviceWorkouts(date, workouts);
  }, [date, workouts]);

  const sessions = onDate(sports.sessions, date);
  /* A watch workout that became a sport session is already in the list below,
     so it is not drawn twice. The rest — strength, cardio — is training rather
     than sport, and keeps its own row. */
  const logged = new Set(sessions.map((s) => s.deviceId).filter(Boolean));
  const training = workouts.filter((w) => !logged.has(w.id));

  return (
    <>
      {sessions.length === 0 && training.length === 0 ? (
        <div className="tile px-3 py-3 text-xs text-ink-3">
          Rest day. Nothing logged for today, and the button below adds a session
          whenever you do one.
        </div>
      ) : null}
      {training.map((w) => (
        <div key={w.id} className="tile flex items-center justify-between gap-3 px-3 py-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">{w.activity}</div>
            <div className="num mt-0.5 text-[11px] text-ink-3">
              {formatDuration(w.durationMin)}
              {w.avgHr ? ` · ${w.avgHr} bpm avg` : ""}
            </div>
          </div>
          {w.calories ? <span className="num shrink-0 text-xs text-ink-2">{w.calories} kcal</span> : null}
        </div>
      ))}
      {sessions.map((s) => {
        const label = `${s.sport}, ${formatDuration(s.minutes)}`;
        return (
          <div key={s.id} className="tile group flex items-center justify-between gap-3 px-3 py-3">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">
                {s.sport} {s.kind === "game" ? "game" : "practice"}
              </span>
              <span className="num mt-0.5 block text-[11px] text-ink-3">
                {formatDuration(s.minutes)} · intensity {s.intensity}/5
                {s.source === "device" && s.avgHr ? ` · ${s.avgHr} bpm avg` : ""}
              </span>
            </span>
            <span className="shrink-0 text-[10px] text-ink-3">
              {s.source === "device" ? "watch" : "logged"}
            </span>
            <SessionDeleteButton
              label={`Delete this session — ${label}`}
              onDelete={() => remove(sessions, s.id, label)}
            />
          </div>
        );
      })}
      {/* Below the rows, not attached to one: the row it refers to is gone. */}
      {undo.pending ? (
        <UndoBar label={undo.pending.label} onUndo={undo.undo} onDismiss={undo.clear} />
      ) : null}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="tile w-full px-3 py-2.5 text-left text-[11px] text-ink-3 transition-colors hover:text-ink-2"
      >
        + Log a sports session
      </button>
      {open ? <SportForm today={date} onClose={() => setOpen(false)} /> : null}
    </>
  );
}
