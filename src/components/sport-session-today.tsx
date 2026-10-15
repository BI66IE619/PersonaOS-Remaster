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

/** How many rows show before the list collapses behind "View more". */
const LIMIT = 3;

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
  const [expanded, setExpanded] = useState(false);
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

  /* The box sits beside "Last night", which is a fixed height. A long training day
     used to stretch this panel and drag its neighbour down with it, so only the
     newest rows show until the reader asks for the rest. Ordered newest first on the
     row's own clock: a workout carries its start, a logged session its last edit. */
  const at = (iso: string) => {
    const t = Date.parse(iso);
    return Number.isNaN(t) ? 0 : t;
  };
  const rows = [
    ...training.map((w) => ({ key: `t:${w.id}`, at: at(w.startUtc), kind: "training" as const, w })),
    ...sessions.map((s) => ({ key: `s:${s.id}`, at: at(s.updatedAt), kind: "session" as const, s })),
  ].sort((a, b) => b.at - a.at);
  const shown = expanded ? rows : rows.slice(0, LIMIT);

  return (
    <>
      {rows.length === 0 ? (
        <div className="tile px-3 py-3 text-xs text-ink-3">
          Rest day. Nothing logged for today, and the button below adds a session
          whenever you do one.
        </div>
      ) : null}

      {shown.map((row) => {
        if (row.kind === "training") {
          const w = row.w;
          return (
            <div key={row.key} className="tile flex items-center justify-between gap-3 px-3 py-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{w.activity}</div>
                <div className="num mt-0.5 text-[11px] text-ink-3">
                  {formatDuration(w.durationMin)}
                  {w.avgHr ? ` · ${w.avgHr} bpm avg` : ""}
                </div>
              </div>
              {w.calories ? (
                <span className="num shrink-0 text-xs text-ink-2">{w.calories} kcal</span>
              ) : null}
            </div>
          );
        }

        const s = row.s;
        const label = `${s.sport}, ${formatDuration(s.minutes)}`;
        return (
          <div key={row.key} className="tile group flex items-center justify-between gap-3 px-3 py-3">
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

      {rows.length > LIMIT ? (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="tile w-full px-3 py-2.5 text-left text-[11px] text-ink-3 transition-colors hover:text-ink-2"
        >
          {expanded ? "Hide" : "View more"}
        </button>
      ) : null}

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
