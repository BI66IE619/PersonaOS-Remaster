"use client";

import { useState } from "react";
import { addTask, removeTask, toggleTask } from "@/lib/tasks";
import { EmptyState } from "@/components/empty-state";
import {
  taskCategoryColor,
  taskCategoryLabel,
  type TaskCategory,
} from "@/lib/categories";
import { addDays, daysBetween, relativeDayLabel } from "@/lib/dates";
import type { Task } from "@/lib/types-tasks";

const SOON = 14;

type Group = { key: string; label: string; tasks: Task[] };

function group(tasks: Task[], today: string): Group[] {
  const open = tasks.filter((t) => !t.done);
  const soon = addDays(today, SOON);
  const buckets: Record<string, Task[]> = {
    past: [],
    today: [],
    tomorrow: [],
    soon: [],
    later: [],
    someday: [],
  };
  for (const t of open) {
    if (t.due === null) buckets.someday.push(t);
    else if (t.due < today) buckets.past.push(t);
    else if (t.due === today) buckets.today.push(t);
    else if (t.due === addDays(today, 1)) buckets.tomorrow.push(t);
    else if (t.due <= soon) buckets.soon.push(t);
    else buckets.later.push(t);
  }
  const byDue = (a: Task, b: Task) => (a.due ?? "9999").localeCompare(b.due ?? "9999");
  for (const k of Object.keys(buckets)) buckets[k].sort(byDue);

  const defs: [string, string][] = [
    ["past", "Past due"],
    ["today", "Today"],
    ["tomorrow", "Tomorrow"],
    ["soon", "Soon"],
    ["later", "Later"],
    ["someday", "Someday"],
  ];
  return defs
    .filter(([k]) => buckets[k].length)
    .map(([key, label]) => ({ key, label, tasks: buckets[key] }));
}

/**
 * One box of the plan.
 *
 * The two boxes differ only in what they collect and what they print under each
 * row, so they share this rather than forking: a plain to-do (title, due, and a
 * personal/other tag) and an assignment (title, subject, due). The subject rides
 * in the task's note column — see addTaskPure — and shows in place of the category
 * tag, because "Assignments" under every row in the assignments box says nothing.
 */
export function TaskPanel({
  label,
  tasks,
  today,
  categories,
  subject = false,
  addPlaceholder,
  emptyTitle,
  emptyDetail,
}: {
  label: string;
  tasks: Task[];
  today: string;
  /** Categories the add form offers. A single entry means the box is fixed to
   *  that kind and shows no tag chips. */
  categories: readonly TaskCategory[];
  /** Collect and show a subject (used by the assignments box). */
  subject?: boolean;
  addPlaceholder: string;
  emptyTitle: string;
  emptyDetail: string;
}) {
  const [title, setTitle] = useState("");
  const [subjectText, setSubjectText] = useState("");
  const [due, setDue] = useState("");
  const [someday, setSomeday] = useState(false);
  const [category, setCategory] = useState<TaskCategory>(categories[0]);
  const [showDone, setShowDone] = useState(false);

  const done = tasks.filter((t) => t.done);
  const groups = group(tasks, today);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const value = title.trim();
    if (!value) return;
    addTask(value, someday ? null : due || null, category, subject ? subjectText.trim() : "");
    setTitle("");
    setSubjectText("");
    setDue("");
    setSomeday(false);
  };

  const row = (t: Task) => {
    const parts: string[] = [];
    if (t.due) {
      const diff = daysBetween(today, t.due);
      parts.push(relativeDayLabel(t.due, today) + (diff < 0 ? ` · ${Math.abs(diff)}d ago` : ""));
    }
    /* A subject when there is one, otherwise the category — which keeps the line
       from going empty on an assignment whose subject was left blank. */
    parts.push(subject && t.note ? t.note : taskCategoryLabel(t.category));
    return (
      <li key={t.id} className="group flex items-start gap-2.5 py-1.5">
        <input
          type="checkbox"
          checked={t.done}
          onChange={() => toggleTask(t.id)}
          aria-label={`Mark "${t.title}" ${t.done ? "not done" : "done"}`}
          className="mt-0.5 h-4 w-4 shrink-0 accent-white"
        />
        <span
          aria-hidden
          className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full"
          style={{ background: taskCategoryColor(t.category) }}
        />
        <div className="min-w-0 flex-1">
          <div
            className="break-words text-sm"
            style={{
              color: t.done ? "var(--color-ink-3)" : "var(--color-ink-2)",
              textDecoration: t.done ? "line-through" : undefined,
            }}
          >
            {t.title}
          </div>
          <div className="num text-[11px] text-ink-3">{parts.join(" · ")}</div>
        </div>
        <button
          type="button"
          onClick={() => removeTask(t.id)}
          aria-label={`Delete "${t.title}"`}
          className="shrink-0 rounded px-1 text-[11px] text-ink-3 opacity-100 transition-opacity hover:text-[var(--color-low)] focus-visible:opacity-100 md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100"
        >
          &#10005;
        </button>
      </li>
    );
  };

  return (
    <div className="panel flex flex-col p-5">
      <div className="flex items-center justify-between gap-3">
        <span className="label-xs">{label}</span>
        <span className="num text-[10px] text-ink-3">
          {tasks.length ? `${tasks.length - done.length} open` : ""}
        </span>
      </div>

      <form onSubmit={submit} className="mt-3 space-y-2">
        <div className="flex gap-2">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={addPlaceholder}
            aria-label={`${label} title`}
            className="min-w-0 flex-1 rounded-lg border border-hairline bg-white/[0.07] px-3 py-2 text-sm text-ink placeholder:text-ink-3 focus:border-[var(--color-accent)] focus:outline-none"
          />
          <button
            type="submit"
            disabled={!title.trim()}
            className="shrink-0 rounded-lg border border-hairline-strong bg-raised px-3.5 py-2 text-sm font-medium text-ink transition-colors hover:bg-inset disabled:cursor-not-allowed disabled:opacity-40"
          >
            Add
          </button>
        </div>

        {subject ? (
          <input
            value={subjectText}
            onChange={(e) => setSubjectText(e.target.value)}
            placeholder="Subject"
            aria-label="Subject"
            className="w-full rounded-lg border border-hairline bg-white/[0.07] px-3 py-2 text-sm text-ink placeholder:text-ink-3 focus:border-[var(--color-accent)] focus:outline-none"
          />
        ) : null}

        <div className="flex items-center gap-2">
          <input
            type="date"
            value={due}
            onChange={(e) => {
              setDue(e.target.value);
              if (e.target.value) setSomeday(false);
            }}
            aria-label="Due date"
            className={`num rounded-lg border border-hairline bg-white/[0.07] px-2.5 py-1.5 text-xs text-ink focus:border-[var(--color-accent)] focus:outline-none ${someday ? "opacity-40" : ""}`}
          />
          <button
            type="button"
            onClick={() => {
              setSomeday((s) => !s);
              if (!someday) setDue("");
            }}
            aria-pressed={someday}
            className="rounded-lg border px-2.5 py-1.5 text-xs transition-colors"
            style={{
              borderColor: someday ? "#ffffff2b" : "var(--color-hairline)",
              background: someday ? "#ffffff14" : "transparent",
              color: someday ? "var(--color-ink)" : "var(--color-ink-3)",
            }}
          >
            Someday
          </button>
        </div>

        {categories.length > 1 ? (
          <fieldset className="flex flex-wrap items-center gap-1.5">
            <legend className="sr-only">Category</legend>
            {categories.map((id) => {
              const on = category === id;
              return (
                <button
                  key={id}
                  type="button"
                  aria-pressed={on}
                  aria-label={`Task category: ${taskCategoryLabel(id)}`}
                  onClick={() => setCategory(id)}
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
                    style={{ background: taskCategoryColor(id) }}
                  />
                  {taskCategoryLabel(id)}
                </button>
              );
            })}
          </fieldset>
        ) : null}
      </form>

      {groups.length ? (
        <div className="mt-4 space-y-4">
          {groups.map((g) => (
            <div key={g.key}>
              <div className="label-xs text-ink-3">{g.label}</div>
              <ul className="mt-1">{g.tasks.map(row)}</ul>
            </div>
          ))}
        </div>
      ) : done.length ? (
        /* All of them are ticked. Saying "nothing open" would be technically
           right and useless, because the list below it is full — the thing worth
           saying is that there is nothing left to do. */
        <EmptyState
          title="Everything here is done."
          detail="Nothing is waiting on you. Finished items stay listed underneath until you hide them."
        />
      ) : (
        <EmptyState title={emptyTitle} detail={emptyDetail} />
      )}

      {done.length ? (
        <button
          type="button"
          onClick={() => setShowDone((s) => !s)}
          aria-expanded={showDone}
          className="num mt-4 text-[11px] text-ink-3 transition-colors hover:text-ink-2"
        >
          {showDone ? "Hide" : "Show"} done ({done.length})
        </button>
      ) : null}

      {showDone && done.length ? <ul className="mt-1">{done.map(row)}</ul> : null}
    </div>
  );
}
