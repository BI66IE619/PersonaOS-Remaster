"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { PageShell } from "@/components/page-shell";
import { MonthCalendar } from "@/components/tasks/month-calendar";
import { TaskList } from "@/components/tasks/task-list";
import { HabitList } from "@/components/tasks/habit-list";
import {
  applyRemote,
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

          <section className="lg:col-span-4">
            <TaskList tasks={state.tasks} today={view.date} />
          </section>

          <section className="lg:col-span-12">
            <HabitList habits={habitState.habits} today={view.date} />
          </section>
        </main>
    </PageShell>
  );
}
