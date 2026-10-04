"use client";

import { useRef, useState } from "react";
import {
  addEvent,
  removeEvent,
  updateEvent,
} from "@/lib/tasks";
import {
  CATEGORIES,
  categoryColor,
  categoryLabel,
  type CalCategory,
} from "@/lib/categories";
import {
  addDays,
  addMonths,
  daysBetween,
  monthLabel,
  monthMatrix,
  relativeDayLabel,
  timeLabel,
  weekStart,
} from "@/lib/dates";
import type { CalEvent } from "@/lib/types-tasks";
import { EmptyState } from "@/components/empty-state";

const DOW = ["M", "T", "W", "T", "F", "S", "S"] as const;
const DOW_FULL = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
const MAX_DOTS = 3;
const DURATIONS = [15, 30, 45, 60, 90, 120, 180] as const;

const toMin = (hhmm: string): number | null => {
  if (!hhmm) return null;
  const [h, m] = hhmm.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
};

const toHHMM = (min: number | null): string => {
  if (min === null) return "";
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
};

function rangeLabel(e: CalEvent) {
  if (e.startMin === null) return "All day";
  if (e.durationMin === null) return timeLabel(e.startMin);
  return `${timeLabel(e.startMin)} – ${timeLabel(e.startMin + e.durationMin)}`;
}

/** Screen readers get the category names, since the dots are colour only. */
function categorySummary(list: CalEvent[]): string {
  const names = [...new Set(list.map((e) => categoryLabel(e.category)))];
  return names.join(", ");
}

export function MonthCalendar({
  events,
  today,
  month,
  onMonthChange,
  selected,
  onSelect,
}: {
  events: CalEvent[];
  today: string;
  month: string;
  onMonthChange: (m: string) => void;
  selected: string;
  onSelect: (d: string) => void;
}) {
  const [title, setTitle] = useState("");
  const [time, setTime] = useState("");
  const [duration, setDuration] = useState(60);
  const [editing, setEditing] = useState<string | null>(null);
  const [category, setCategory] = useState<CalCategory>("other");
  const field = useRef<HTMLInputElement>(null);

  const matrix = monthMatrix(month);
  const byDate = new Map<string, CalEvent[]>();
  for (const e of events) {
    const list = byDate.get(e.date);
    if (list) list.push(e);
    else byDate.set(e.date, [e]);
  }
  for (const list of byDate.values()) {
    list.sort((a, b) => (a.startMin ?? -1) - (b.startMin ?? -1));
  }

  const dayEvents = byDate.get(selected) ?? [];
  const week = Array.from({ length: 7 }, (_, i) => addDays(weekStart(selected), i));
  const edited = editing ? events.find((e) => e.id === editing) : undefined;

  const reset = () => {
    setTitle("");
    setTime("");
    setDuration(60);
    setEditing(null);
    setCategory("other");
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const value = title.trim();
    if (!value) return;
    const startMin = toMin(time);
    const payload = {
      title: value,
      date: selected,
      startMin,
      durationMin: startMin === null ? null : duration,
      note: "",
      category,
    };
    if (edited) updateEvent(edited.id, payload);
    else addEvent(payload);
    reset();
  };

  return (
    <div className="panel flex flex-col p-5">
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => onMonthChange(addMonths(month, -1))}
          aria-label="Previous month"
          className="num rounded-lg border border-hairline px-2.5 py-1 text-sm text-ink-2 transition-colors hover:bg-white/[0.07]"
        >
          &lsaquo;
        </button>
        <span className="num text-sm font-medium">{monthLabel(month)}</span>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => onMonthChange(today.slice(0, 7))}
            className="rounded-lg border border-hairline px-2.5 py-1 text-[11px] text-ink-3 transition-colors hover:bg-white/[0.07]"
          >
            Today
          </button>
          <button
            type="button"
            onClick={() => onMonthChange(addMonths(month, 1))}
            aria-label="Next month"
            className="num rounded-lg border border-hairline px-2.5 py-1 text-sm text-ink-2 transition-colors hover:bg-white/[0.07]"
          >
            &rsaquo;
          </button>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-7 gap-1">
        {DOW.map((d, i) => (
          <div key={i} className="label-xs pb-1 text-center text-ink-3" aria-hidden>
            {d}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {matrix.flat().map((day) => {
          const inMonth = day.startsWith(month);
          const isToday = day === today;
          const isSel = day === selected;
          const dots = byDate.get(day) ?? [];
          return (
            <button
              key={day}
              type="button"
              onClick={() => onSelect(day)}
              aria-label={`${relativeDayLabel(day, today)}, ${dots.length} ${dots.length === 1 ? "event" : "events"}${dots.length ? `: ${categorySummary(dots)}` : ""}`}
              aria-pressed={isSel}
              className="flex h-12 flex-col items-center justify-center gap-1 rounded-lg border text-[11px] transition-colors lg:h-14"
              style={{
                borderColor: isSel ? "#ffffff2b" : "transparent",
                background: isSel ? "#ffffff14" : "transparent",
                color: inMonth ? "var(--color-ink-2)" : "var(--color-ink-3)",
                opacity: inMonth ? 1 : 0.4,
                boxShadow: isToday && !isSel ? "inset 0 0 0 1px #ffffff26" : undefined,
              }}
            >
              <span
                className="num leading-none"
                style={{
                  color: isToday ? "var(--color-ink)" : undefined,
                  fontWeight: isToday ? 600 : 400,
                }}
              >
                {Number(day.slice(8))}
              </span>
              <span className="flex h-1.5 items-center gap-[3px]">
                {dots.slice(0, MAX_DOTS).map((e) => (
                  <span
                    key={e.id}
                    className="h-1 w-1 rounded-full"
                    style={{ background: categoryColor(e.category) }}
                  />
                ))}
              </span>
            </button>
          );
        })}
      </div>

      <div className="mt-3 grid grid-cols-7 gap-1">
        {week.map((day) => {
          const isToday = day === today;
          const isSel = day === selected;
          const dots = byDate.get(day) ?? [];
          return (
            <button
              key={day}
              type="button"
              onClick={() => {
                onSelect(day);
                if (!day.startsWith(month)) onMonthChange(day.slice(0, 7));
              }}
              aria-label={`${DOW_FULL[week.indexOf(day)]}${dots.length ? `, ${dots.length} ${dots.length === 1 ? "event" : "events"}: ${categorySummary(dots)}` : ""}`}
              aria-pressed={isSel}
              className="flex flex-col items-center gap-1 rounded-lg py-1.5 transition-colors"
              style={{ background: isSel ? "#ffffff17" : "transparent" }}
            >
              <span className="text-[10px] text-ink-3" aria-hidden>
                {DOW[week.indexOf(day)]}
              </span>
              <span
                className="num text-xs"
                style={{ color: isToday ? "var(--color-ink)" : "var(--color-ink-2)" }}
              >
                {Number(day.slice(8))}
              </span>
              <span
                className="h-1 w-1 rounded-full"
                style={{ background: dots.length ? categoryColor(dots[0].category) : "transparent" }}
              />
            </button>
          );
        })}
      </div>

      <div className="hairline-t mt-4 pt-4">
        <div className="flex items-center justify-between gap-3">
          <span className="label-xs">{relativeDayLabel(selected, today)}</span>
          <span className="num text-[10px] text-ink-3">
            {selected === today ? "" : `${daysBetween(today, selected) > 0 ? "in" : ""} ${Math.abs(daysBetween(today, selected))}d`}
          </span>
        </div>

        {dayEvents.length ? (
          <ul className="mt-3 space-y-1.5">
            {dayEvents.map((e) => (
              <li
                key={e.id}
                className="flex items-center justify-between gap-3 rounded-md border border-hairline bg-white/[0.04] px-3 py-2"
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <span
                    aria-hidden
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ background: categoryColor(e.category) }}
                  />
                  <div className="min-w-0">
                    <div className="truncate text-sm">{e.title}</div>
                    <div className="num text-[11px] text-ink-3">
                      {rangeLabel(e)} · {categoryLabel(e.category)}
                    </div>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => {
                      setEditing(e.id);
                      setTitle(e.title);
                      setTime(toHHMM(e.startMin));
                      setDuration(e.durationMin ?? 60);
                      setCategory(e.category);
                    }}
                    className="rounded px-1.5 py-0.5 text-[11px] text-ink-3 transition-colors hover:text-ink-2"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => removeEvent(e.id)}
                    aria-label={`Delete "${e.title}"`}
                    className="rounded px-1.5 py-0.5 text-[11px] text-ink-3 transition-colors hover:text-[var(--color-low)]"
                  >
                    &#10005;
                  </button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          /* The form that fills this is directly underneath, so the way out is a
             pointer at it rather than a link back to this same screen. */
          <EmptyState
            title="Nothing on this day."
            detail="Add anything with a time and it shows up here, under the day you put it on. It does not have to be today."
            action={{ label: "Add the first one", onClick: () => field.current?.focus() }}
          />
        )}

        <form onSubmit={submit} className="mt-3">
          <div className="flex flex-wrap gap-2">
            <input
              ref={field}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={edited ? "Edit event" : "Add an event"}
              aria-label="Event title"
              className="min-w-0 flex-1 rounded-lg border border-hairline bg-white/[0.07] px-3 py-2 text-sm text-ink placeholder:text-ink-3 focus:border-[var(--color-accent)] focus:outline-none"
            />
            <input
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              aria-label="Event time"
              className="num rounded-lg border border-hairline bg-white/[0.07] px-2.5 py-2 text-sm text-ink focus:border-[var(--color-accent)] focus:outline-none"
            />
            {time ? (
              <select
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value))}
                aria-label="Event duration"
                className="num rounded-lg border border-hairline bg-white/[0.07] px-2 py-2 text-sm text-ink focus:border-[var(--color-accent)] focus:outline-none"
              >
                {DURATIONS.map((d) => (
                  <option key={d} value={d} className="bg-[var(--color-raised)]">
                    {d < 60 ? `${d}m` : `${d / 60}h`}
                  </option>
                ))}
              </select>
            ) : null}
            <button
              type="submit"
              disabled={!title.trim()}
              className="shrink-0 rounded-lg border border-hairline-strong bg-raised px-3.5 py-2 text-sm font-medium text-ink transition-colors hover:bg-inset disabled:cursor-not-allowed disabled:opacity-40"
            >
              {edited ? "Update" : "Add"}
            </button>
            {edited ? (
              <button
                type="button"
                onClick={reset}
                className="shrink-0 rounded-lg px-2.5 py-2 text-sm text-ink-3 transition-colors hover:text-ink-2"
              >
                Cancel
              </button>
            ) : null}
          </div>

          <fieldset className="mt-2.5 flex flex-wrap items-center gap-1.5">
            <legend className="sr-only">Category</legend>
            {CATEGORIES.map((c) => {
              const on = category === c.id;
              return (
                <button
                  key={c.id}
                  type="button"
                  aria-pressed={on}
                  aria-label={`Category: ${c.label}`}
                  onClick={() => setCategory(c.id)}
                  className={[
                    "flex items-center gap-1.5 rounded-full border px-2 py-1 text-[11px] transition-colors",
                    on
                      ? "border-[var(--color-accent-dim)] bg-white/[0.07] text-ink"
                      : "border-hairline text-ink-3 hover:text-ink-2",
                  ].join(" ")}
                >
                  <span
                    aria-hidden
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ background: c.color }}
                  />
                  {c.label}
                </button>
              );
            })}
          </fieldset>
        </form>
      </div>
    </div>
  );
}
