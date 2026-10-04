"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { PageShell } from "@/components/page-shell";
import { MonthCalendar } from "@/components/tasks/month-calendar";
import { TaskList } from "@/components/tasks/task-list";
import { HabitList } from "@/components/tasks/habit-list";
import {
  applyRemote,
  claimTasksOwnership,
  getSnapshot,
  seedSample,
  subscribe,
} from "@/lib/tasks";
import {
  applyRemote as applyRemoteHabits,
  claimHabitsOwnership,
  getSnapshot as habitsSnapshot,
  seedHabits,
  subscribe as subscribeHabits,
} from "@/lib/habits";
import { schedulePlansSync } from "@/lib/plans/sync";
import { EMPTY_TASKS } from "@/lib/types-tasks";
import { EMPTY_HABITS } from "@/lib/types-habits";
import type { TodayView } from "@/lib/types";

export function TasksScreen({
  view,
  userId,
  initialEvents = null,
  initialTasks = null,
  initialHabits = null,
}: {
  view: TodayView;
  /** Whose record this tab is allowed to show. Both local stores are bound to it. */
  userId: string;
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

  /* Whose record this is, before anything is read out of it or written into it.
   *
   * Runs during the first render rather than in an effect, because an effect runs
   * after the paint: the tab would render one frame with the previous account's
   * calendar and task list on screen, which is the whole leak this prevents. The
   * stores are module singletons, so claiming during render is a write during render —
   * safe here only because the claim is idempotent and the reads that follow it are
   * the same snapshot every consumer gets. */
  if (state.owner !== userId) claimTasksOwnership(userId);
  if (habitState.owner !== userId) claimHabitsOwnership(userId);

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

  /* First run gets sample content, otherwise the month grid is an empty rectangle and
     you cannot judge the layout before adding anything.
   *
   * Both seeders are no-ops for a bound account: the samples are a first-run
   * affordance for a record nobody owns, and pushing them to a real account would put
   * a calendar, a task list and four habits on that person's other devices that they
   * never chose. */
  useEffect(() => {
    seedSample(view.date);
    seedHabits(view.date);
  }, [view.date]);

  /* Push whatever changed, and on the first render whether anything did.
   *
   * Covers every write path — an event added, edited or removed, a task ticked or
   * deleted, a habit renamed or a day toggled — because they all go through the
   * stores, and watching the records rather than each call site means a new kind of
   * write cannot forget to sync.
   *
   * The effects have no dependency on the records themselves on purpose for the first
   * run: a device whose local plan is already correct has nothing to push and would
   * otherwise never contact the server, so it would never learn about a task added on
   * the other device until the user typed something here. */
  useEffect(() => {
    if (!seeded.current) return;
    schedulePlansSync();
  }, [state, habitState]);

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
