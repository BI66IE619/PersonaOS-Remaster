"use client";

import { useState, useSyncExternalStore } from "react";
import { Sparkline } from "@/components/sparkline";
import { addDays, daysBetween, shortDayLabel, weekStart } from "@/lib/dates";
import {
  EMPTY_LOGS,
  estimateWeight,
  getServerSnapshot,
  getSnapshot,
  logWeight,
  logsOf,
  removeWeight,
  subscribe,
  weightDue,
} from "@/lib/weight-log";

const WEEKS_SHOWN = 8;

function shortDate(date: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T12:00:00Z`));
}

export function WeightLog({ date }: { date: string }) {
  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const logs = logsOf(state) ?? EMPTY_LOGS;
  const estimatedMap = state?.estimated ?? {};
  const [input, setInput] = useState("");
  /* A quiet way to correct a past reading — a skipped week's estimate, or a typo.
     There is no visible control: the weight itself is the button. */
  const [editingDate, setEditingDate] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  const dates = Object.keys(logs).sort();
  const latest = dates[dates.length - 1] ?? null;
  const { due, daysSince, next } = weightDue(logs, date);
  const loggedToday = date in logs;
  /* The Monday this week is owed, and what the line suggests it would have been —
     only worth offering a skip when there is something to estimate from. */
  const monday = weekStart(date);
  const estimate = due ? estimateWeight(logs, monday) : null;

  const save = () => {
    const lb = Number(input);
    if (!Number.isFinite(lb) || lb <= 0) return;
    logWeight(date, lb);
    setInput("");
  };

  const startEditLog = (d: string) => {
    setEditingDate(d);
    setEditValue(String(logs[d]));
  };

  const startAdd = (monday: string) => {
    setEditingDate(monday);
    setEditValue("");
  };

  const commitEditLog = () => {
    if (!editingDate) return;
    const lb = Number(editValue);
    if (Number.isFinite(lb) && lb > 0) logWeight(editingDate, lb);
    setEditingDate(null);
  };

  const points = dates.map((d) => ({ date: d, value: logs[d] }));
  const mean = points.length
    ? points.reduce((sum, p) => sum + p.value, 0) / points.length
    : 0;
  /* One row per week, anchored on its Monday, including weeks with no reading so a
     missed one can be filled in. A reading does not have to land on the Monday, so
     each row also carries the actual day it was logged. */
  const weekRows = Array.from({ length: WEEKS_SHOWN }, (_, i) => {
    const weekMonday = addDays(monday, -7 * i);
    const sunday = addDays(weekMonday, 6);
    const inWeek = Object.keys(logs)
      .filter((d) => d >= weekMonday && d <= sunday && d <= date)
      .sort();
    const logDay = inWeek.length ? inWeek[inWeek.length - 1] : null;
    return {
      monday: weekMonday,
      logDay,
      lb: logDay ? logs[logDay] : null,
      estimated: logDay ? !!estimatedMap[logDay] : false,
    };
  });

  return (
    /* Not h-full: the streak box sits under this one in the same column, and a
       full-height box would stretch to the column and leave a gap above it. */
    <div className="panel flex flex-col p-5">
      <div className="flex items-center justify-between gap-3">
        <span className="label-xs">Weight log</span>
        <span
          className="num text-[10px]"
          style={{ color: due ? "var(--color-ink-2)" : "var(--color-ink-3)" }}
        >
          {daysSince === null
            ? "no weigh-ins yet"
            : due
              ? "due now"
              : `next ${shortDate(next)} · ${daysBetween(date, next)}d`}
        </span>
      </div>

      <p className="mt-2 text-xs text-ink-3">Once a week is enough to see the trend.</p>

      <div className="mt-4 flex gap-2">
        <input
          type="number"
          inputMode="decimal"
          min={0}
          step={0.1}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              save();
            }
          }}
          placeholder={loggedToday ? `${logs[date]} — change?` : "lb"}
          aria-label="Weight in pounds"
          className="num min-w-0 flex-1 rounded-lg border border-hairline bg-white/[0.07] px-3 py-2.5 text-lg text-ink placeholder:text-sm placeholder:text-ink-3 focus:border-[var(--color-accent)] focus:outline-none"
        />
        <button
          type="button"
          onClick={save}
          disabled={!Number(input)}
          className="shrink-0 rounded-lg border border-hairline-strong bg-raised px-3.5 py-2.5 text-sm font-medium text-ink transition-colors hover:bg-inset disabled:cursor-not-allowed disabled:opacity-40"
        >
          Save
        </button>
      </div>

      {latest !== null && !input ? (
        <button
          type="button"
          onClick={() => setInput(String(logs[latest]))}
          className="num mt-2 self-start text-[11px] text-ink-3 transition-colors hover:text-ink-2"
        >
          Use last · {logs[latest]} lb
        </button>
      ) : null}

      {/* For the Monday that slipped past. It logs an estimate for that week, so the
          prompt clears and the trend stays continuous; the number is shown before it
          is written, because it is an estimate and not a weigh-in. */}
      {due && estimate !== null ? (
        <button
          type="button"
          onClick={() => logWeight(monday, estimate, true)}
          className="mt-2 self-start text-left text-[11px] text-ink-3 transition-colors hover:text-ink-2"
        >
          Skip this week · log an estimate of{" "}
          <span className="num text-ink-2">{estimate} lb</span>
        </button>
      ) : null}

      {points.length >= 2 ? (
        <div className="mt-4">
          <Sparkline
            points={points}
            mean={mean}
            color="var(--color-accent-dim)"
            height={34}
            ariaLabel={`Logged weight, ${points.length} weigh-ins, latest ${logs[latest]} pounds`}
          />
        </div>
      ) : null}

      {/* A week list rather than a reading list: every Monday for the last eight
          weeks, including ones with no reading, so a missed week can be added and a
          week logged on another day is shown with that day. Estimated readings are
          marked, because the skip button fills one and it should not pass for a
          measurement. */}
      <ul className="mt-4 space-y-1.5" aria-label="Weeks">
        {weekRows.map((w) => {
          const logDay = w.logDay;
          const key = logDay ?? w.monday;
          const editing = editingDate === key;
          return (
            <li
              key={w.monday}
              className="flex items-center justify-between gap-3 rounded-md px-1 py-0.5"
            >
              <span className="num text-[11px] text-ink-3">{shortDayLabel(w.monday)}</span>

              {editing ? (
                <span className="flex items-center gap-1">
                  <input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step={0.1}
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        commitEditLog();
                      } else if (e.key === "Escape") {
                        e.preventDefault();
                        setEditingDate(null);
                      }
                    }}
                    aria-label={`Weigh-in for week of ${shortDayLabel(w.monday)}`}
                    autoFocus
                    className="num w-16 rounded border border-hairline bg-white/[0.07] px-1.5 py-0.5 text-[11px] text-ink focus:border-[var(--color-accent)] focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={commitEditLog}
                    className="text-[10px] text-ink-2 transition-colors hover:text-ink"
                  >
                    Save
                  </button>
                </span>
              ) : logDay ? (
                <button
                  type="button"
                  onClick={() => startEditLog(logDay)}
                  title="Edit"
                  aria-label={`Edit weigh-in for week of ${shortDayLabel(w.monday)}`}
                  className="num rounded px-1 text-[11px] text-ink-2 transition-colors hover:bg-white/[0.06] hover:text-ink"
                >
                  {w.estimated ? "~" : ""}
                  {w.lb} lb
                  {logDay !== w.monday ? (
                    <span className="text-ink-3"> · logged {shortDayLabel(logDay)}</span>
                  ) : null}
                  {w.estimated ? <span className="text-ink-3"> · est</span> : null}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => startAdd(w.monday)}
                  className="text-[11px] text-ink-3 transition-colors hover:text-ink-2"
                >
                  Not logged · add
                </button>
              )}

              {logDay ? (
                <button
                  type="button"
                  onClick={() => removeWeight(logDay)}
                  aria-label={`Remove weigh-in for week of ${shortDayLabel(w.monday)}`}
                  className="shrink-0 rounded px-1 text-[11px] text-ink-3 transition-colors hover:text-[var(--color-low)]"
                >
                  ✕
                </button>
              ) : (
                <span className="w-3 shrink-0" aria-hidden />
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
