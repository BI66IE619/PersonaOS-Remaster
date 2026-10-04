"use client";

import { useSyncExternalStore } from "react";
import { toggleTask, getServerSnapshot, getSnapshot, subscribe } from "@/lib/tasks";
import { EmptyState } from "@/components/empty-state";
import { daysBetween, relativeDayLabel, timeLabel } from "@/lib/dates";
import type { CalEvent, Task } from "@/lib/types-tasks";

/** All-day rows sort first, then by clock time. */
const eventOrder = (a: CalEvent, b: CalEvent) =>
  (a.startMin ?? -1) - (b.startMin ?? -1);

function timeRange(e: CalEvent) {
  if (e.startMin === null) return "All day";
  if (e.durationMin === null) return timeLabel(e.startMin);
  return `${timeLabel(e.startMin)} – ${timeLabel(e.startMin + e.durationMin)}`;
}

function Check({
  done,
  label,
  onToggle,
}: {
  done: boolean;
  label: string;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={done}
      aria-label={label}
      onClick={onToggle}
      className="mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border transition-colors"
      style={{
        borderColor: done ? "var(--color-accent)" : "var(--color-hairline-strong)",
        background: done ? "var(--color-accent)" : "transparent",
      }}
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
    </button>
  );
}

/**
 * The day's schedule and the things waiting on you, in one panel. Ordering is
 * deliberately "what needs a decision" first: overdue and due-today tasks sit
 * above the clock, because a task with no time attached is easier to forget
 * than a 5pm training session.
 */
export function AgendaPanel({ today }: { today: string }) {
  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const events = state.events.filter((e) => e.date === today).sort(eventOrder);

  const open = state.tasks
    .filter((t) => !t.done && t.due !== null && t.due <= today)
    .sort((a, b) => (a.due ?? "").localeCompare(b.due ?? ""));

  const overdue = open.filter((t) => t.due !== null && t.due! < today);
  const empty = events.length === 0 && open.length === 0;

  return (
    <section className="panel flex flex-col p-5 lg:col-span-7">
      <div className="flex shrink-0 items-center justify-between gap-3">
        <span className="label-xs">Up next</span>
        {overdue.length > 0 ? (
          <span className="num text-[10px] text-ink-3">
            {overdue.length} overdue
          </span>
        ) : null}
      </div>

      {empty ? (
        <EmptyState
          title="Your day is clear."
          detail="Anything you add with a date shows up here, and anything without one waits on Plan. The list stays empty until then."
          action={{ href: "/tasks", label: "Add something to Plan" }}
        />
      ) : (
        <div className="mt-4 flex flex-col gap-4">
          {open.length > 0 ? (
            <div>
              <span className="block text-[10px] text-ink-3">Due</span>
              <div className="mt-1.5 space-y-2">
                {open.map((t) => (
                  <TaskRow key={t.id} task={t} today={today} />
                ))}
              </div>
            </div>
          ) : null}

          {events.length > 0 ? (
            <div>
              <span className="block text-[10px] text-ink-3">Schedule</span>
              <div className="mt-1.5 space-y-2">
                {events.map((e) => (
                  <div key={e.id} className="tile flex items-start gap-3 px-3 py-2.5">
                    <span className="num mt-0.5 w-12 shrink-0 text-[11px] text-ink-3">
                      {e.startMin === null ? "All day" : timeLabel(e.startMin)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{e.title}</div>
                      <div className="num mt-0.5 text-[11px] text-ink-3">{timeRange(e)}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}

function TaskRow({ task, today }: { task: Task; today: string }) {
  const late = task.due !== null && task.due < today;
  /* A bare date does not read as late, so overdue says how late — same wording
     the Plan tab uses, so the two screens never describe a day differently. */
  const sub =
    task.due === null
      ? "someday"
      : late
        ? `${Math.abs(daysBetween(today, task.due))}d ago`
        : relativeDayLabel(task.due, today);

  return (
    <div className="tile flex items-start gap-3 px-3 py-2.5">
      <Check
        done={task.done}
        label={`Mark ${task.title} done`}
        onToggle={() => toggleTask(task.id)}
      />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{task.title}</div>
        <div
          className="num mt-0.5 text-[11px]"
          style={{ color: late ? "var(--color-mid)" : "var(--color-ink-3)" }}
        >
          {sub}
        </div>
      </div>
    </div>
  );
}
