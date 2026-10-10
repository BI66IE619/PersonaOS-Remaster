"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { PageShell } from "@/components/page-shell";
import { MonthCalendar } from "@/components/tasks/month-calendar";
import { TaskPanel } from "@/components/tasks/task-panel";
import { HabitList } from "@/components/tasks/habit-list";
import {
  applyRemote,
  clearAll,
  getSnapshot,
  subscribe,
} from "@/lib/tasks";
import {
  applyRemote as applyRemoteHabits,
  getSnapshot as habitsSnapshot,
  subscribe as subscribeHabits,
} from "@/lib/habits";
import { EMPTY_TASKS } from "@/lib/types-tasks";
import { EMPTY_HABITS } from "@/lib/types-habits";
import type { TodayView } from "@/lib/types";

export function TasksScreen({
  view,
  initialEvents = null,
  initialTasks = null,
  initialHabits = null,
}: {
  view: TodayView;
  /** The account's plan, read server-side for the first paint. Null when that read
   *  failed, which is not the same as an empty plan — see the effect below. */
  initialEvents?: unknown[] | null;
  initialTasks?: unknown[] | null;
  initialHabits?: unknown[] | null;
}) {
  const state = useSyncExternalStore(subscribe, getSnapshot, () => EMPTY_TASKS);
  const habitState = useSyncExternalStore(subscribeHabits, habitsSnapshot, () => EMPTY_HABITS);
  const [month, setMonth] = useState(view.date.slice(0, 7));
  const [selected, setSelected] = useState(view.date);

  /* Two boxes rather than one list: assignments carry a subject that an ordinary
     to-do does not, so mixing them put a field on rows that would never use it.
     The split is by category, and "personal" and "other" share a box because the
     difference between them is a tag, not a shape. */
  const assignments = state.tasks.filter((t) => t.category === "assignments");
  const personalOther = state.tasks.filter((t) => t.category !== "assignments");

  /* Ownership and the sync schedule live in <AccountSync>, which the page mounts
     above this screen — the plan stores are read and written from Home too, so
     binding them here would leave the Home habit panel pushing nothing. This
     screen only seeds from the server render and draws. */

  /* Seed from the server, once.
   *
   * The props arrive with the HTML so a second device does not paint an empty
   * calendar, task list and habit grid and then fill them in a moment later. Seeded
   * into the same stores rather than kept beside them, so there is one copy of the
   * plan rather than a server one and a local one that agree only until the next
   * write.
   *
   * `seeded` records that seeding was *attempted*, not that it found rows. Gating the
   * sync below on "the seed found rows" means a device whose server read failed —
   * the exact device that most needs to push its local plan somewhere safe — would
   * never sync at all, and would keep the whole plan in localStorage until the tab
   * was closed and lost. */
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current) return;
    seeded.current = true;
    if (!initialEvents || !initialTasks || !initialHabits) return;
    /* One merge per store rather than one per list, so a habit grid cannot arrive
       before the habits it belongs to. */
    applyRemote({ events: initialEvents, tasks: initialTasks, deleted: [] });
    applyRemoteHabits({ habits: initialHabits, deleted: [] });
  }, [initialEvents, initialTasks, initialHabits]);

  return (
    <PageShell>
        <header className="py-4">
          {/* "Plan" rather than "Tasks", because this screen holds three things
              and the old name only admitted one. The route stays /tasks: it is
              the data, not the label, and renaming it would orphan the saved
              store key for no gain. */}
          <h1 className="text-sm font-medium">Plan</h1>
        </header>

        <main className="grid grid-cols-1 items-start gap-4 lg:grid-cols-12">
          <section className="lg:col-span-8">
            <MonthCalendar
              events={state.events}
              today={view.date}
              month={month}
              onMonthChange={setMonth}
              selected={selected}
              onSelect={setSelected}
            />
          </section>

          <section className="space-y-4 lg:col-span-4">
            <TaskPanel
              label="Personal & other"
              tasks={personalOther}
              today={view.date}
              categories={["personal", "other"]}
              addPlaceholder="Add a task"
              emptyTitle="No tasks yet."
              emptyDetail="Add whatever you want to keep track of. A due date is optional, and anything without one waits until you are ready for it."
            />

            <TaskPanel
              label="Assignments"
              tasks={assignments}
              today={view.date}
              categories={["assignments"]}
              subject
              addPlaceholder="Add an assignment"
              emptyTitle="No assignments yet."
              emptyDetail="Give each one a name, a subject and a due date so you can see what is coming."
            />

            {/* One clear for both boxes. clearAll wipes the calendar entries too,
                which is why it sits outside either panel and says "everything"
                rather than "all tasks". */}
            {state.tasks.length ? (
              <button
                type="button"
                onClick={clearAll}
                className="w-full text-left text-[11px] text-ink-3 transition-colors hover:text-[var(--color-low)]"
              >
                Clear everything
              </button>
            ) : null}
          </section>

          <section className="lg:col-span-12">
            <HabitList habits={habitState.habits} today={view.date} />
          </section>
        </main>
    </PageShell>
  );
}
