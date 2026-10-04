"use client";

import { useState, useSyncExternalStore } from "react";
import { Sparkline } from "@/components/sparkline";
import { addDays } from "@/lib/dates";
import {
  CADENCE_DAYS,
  EMPTY_LOGS,
  getServerSnapshot,
  getSnapshot,
  logWeight,
  logsOf,
  removeWeight,
  subscribe,
  weightDue,
} from "@/lib/weight-log";

const RECENT = 6;

function shortDate(date: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T12:00:00Z`));
}

export function WeightLog({ date }: { date: string }) {
  const logs = logsOf(useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)) ?? EMPTY_LOGS;
  const [input, setInput] = useState("");

  const dates = Object.keys(logs).sort();
  const latest = dates[dates.length - 1] ?? null;
  const { due, daysSince } = weightDue(logs, date);
  const loggedToday = date in logs;

  const save = () => {
    const lb = Number(input);
    if (!Number.isFinite(lb) || lb <= 0) return;
    logWeight(date, lb);
    setInput("");
  };

  const points = dates.map((d) => ({ date: d, value: logs[d] }));
  const mean = points.length
    ? points.reduce((sum, p) => sum + p.value, 0) / points.length
    : 0;
  const rows = dates.slice(-RECENT).reverse();

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
              : `next ${shortDate(addDays(latest, CADENCE_DAYS))} · ${CADENCE_DAYS - daysSince}d`}
        </span>
      </div>

      <p className="mt-2 text-xs text-ink-3">Every other week is enough to see the trend.</p>

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

      {rows.length ? (
        /* A real list, and named: the rows are the only place a weigh-in is
           listed, and a test or a screen reader needs to tell them apart from the
           "Use last · 148.1 lb" button carrying the same digits. */
        <ul className="mt-4 space-y-1.5" aria-label="Recent weigh-ins">
          {rows.map((d) => (
            <li
              key={d}
              className="flex items-center justify-between gap-3 rounded-md px-1 py-0.5"
            >
              <span className="num text-[11px] text-ink-3">
                {d === date ? "today" : shortDate(d)}
              </span>
              <span className="num text-[11px] text-ink-2">{logs[d]} lb</span>
              <button
                type="button"
                onClick={() => removeWeight(d)}
                aria-label={`Remove weigh-in from ${d === date ? "today" : shortDate(d)}`}
                className="shrink-0 rounded px-1 text-[11px] text-ink-3 transition-colors hover:text-[var(--color-low)]"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-4 text-xs text-ink-3">
          Weigh in every other week and the trend builds itself.
        </p>
      )}
    </div>
  );
}
