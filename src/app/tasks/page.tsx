import { TasksScreen } from "@/components/tasks/tasks-screen";
import { AccountSync } from "@/components/account-sync";
import { getProvider } from "@/lib/providers";
import { requireUserId, getPlanEvents, getPlanTasks, getPlanHabits, getPlanHabitDays } from "@/lib/dal";

// Reads "now", so it must never be prerendered into a frozen day at build time.
export const dynamic = "force-dynamic";

/** The account's plan, read for the first paint.
 *
 *  Read here rather than pulled from the client for the reason it is done on the
 *  mentor tab: a second device would otherwise render an empty calendar, an empty
 *  task list and an empty habit grid, and then fill them in a moment later — which
 *  reads as "your plan was lost" on the device that has it and as "this app is empty"
 *  on the new one. The rows are the same ones the pull returns, from the same DAL
 *  functions, so seeding from them and then pulling cannot disagree about what exists.
 *
 *  A failure is swallowed rather than raised: the local record still holds everything
 *  on this device, and a database problem should not be an error page. The screen
 *  treats a null as "nothing to seed" and falls back to pulling. */
async function loadPlan(userId: string): Promise<{
  events: unknown[];
  tasks: unknown[];
  habits: unknown[];
} | null> {
  try {
    const [events, tasks, habits, days] = await Promise.all([
      getPlanEvents(userId),
      getPlanTasks(userId),
      getPlanHabits(userId),
      getPlanHabitDays(userId),
    ]);

    /* Days folded onto their habits before they leave the server, keyed by the habit's
       client id. The same fold the route does on a pull, so a device seeded from here
       and a device that pulls converge on the same thing rather than one of them
       having an empty grid. */
    const daysByHabit = new Map<string, string[]>();
    for (const d of days) {
      const list = daysByHabit.get(d.habitClientId);
      if (list) list.push(d.day);
      else daysByHabit.set(d.habitClientId, [d.day]);
    }

    return {
      events: events.map((e) => ({
        clientId: e.clientId,
        day: e.day,
        title: e.title,
        startMin: e.startMin,
        durationMin: e.durationMin,
        position: e.position,
        note: e.note,
        category: e.category,
        updatedAt: e.updatedAt,
      })),
      tasks: tasks.map((t) => ({
        clientId: t.clientId,
        day: t.day,
        title: t.title,
        done: t.done,
        position: t.position,
        note: t.note,
        category: t.category,
        updatedAt: t.updatedAt,
      })),
      habits: habits.map((h) => ({
        clientId: h.clientId,
        name: h.name,
        days: daysByHabit.get(h.clientId) ?? [],
        position: h.position,
        updatedAt: h.updatedAt,
      })),
    };
  } catch {
    /* Not a crash worth showing the user: their plan is still on this device, and a tab
       that renders is better than one that errors. The pull tries again a moment
       after first paint. */
    return null;
  }
}

export default async function TasksPage() {
  /* Resolved once, up front, and passed down.
   *
   * Two requireUserId() calls in one render would be two chances to read two
   * different answers — the proxy refreshes the session on every request, and a
   * refresh landing between two cookie reads is a real possibility. More to the point,
   * both stores need this same id to bind their local records to, and an id that
   * differed by a single character between the two reads would empty them. */
  const userId = await requireUserId();
  const view = await getProvider().getToday();
  const plan = await loadPlan(userId);

  return (
    <>
      {/* Binds the plan stores to the account and keeps them syncing. Above the
          screen so the stores are claimed before it reads a snapshot of them. */}
      <AccountSync userId={userId} />
      <TasksScreen
        view={view}
        initialEvents={plan?.events ?? null}
        initialTasks={plan?.tasks ?? null}
        initialHabits={plan?.habits ?? null}
      />
    </>
  );
}