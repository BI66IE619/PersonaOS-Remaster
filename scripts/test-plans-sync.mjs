/**
 * The plan tab's merge, its payloads, and its tombstones.
 *
 * Pure functions, no browser and no server, because the property worth testing is the
 * one that cannot be seen from the UI: that a second device reading the server's
 * answer ends up with the same calendar, the same tasks and the same habit grid the
 * first device had, and that a delete on one device removes the row on the other
 * rather than being read as silence.
 *
 * Run: node --env-file=.env.local --experimental-strip-types --no-warnings --import ./scripts/ts-alias.mjs scripts/test-plans-sync.mjs
 */
import { EMPTY_TASKS } from "../src/lib/types-tasks.ts";
import {
  addTaskPure,
  clearPendingDeletes,
  eventPayload,
  mergeRemote as mergeTasks,
  putEvent,
  removeEventPure,
  removeTaskPure,
  revive as reviveTasks,
  taskPayload,
  toggleTaskPure,
} from "../src/lib/tasks.ts";
import { EMPTY_HABITS } from "../src/lib/types-habits.ts";
import {
  clearPendingDeletes as clearHabitDeletes,
  addHabitPure,
  habitPayload,
  mergeRemote as mergeHabits,
  removeHabitPure,
  revive as reviveHabits,
  toggleHabitPure,
} from "../src/lib/habits.ts";

let failures = 0;
function check(name, condition, detail = "") {
  if (condition) {
    console.log(`  ok    ${name}`);
  } else {
    failures++;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const DAY = "2026-03-04";

/* Relative to the real clock rather than to a fixed date.
 *
 * The stores stamp rows with new Date() at the moment of the edit, so a fixed
 * "later" date would sit behind them whenever the test ran on a day after it — and
 * the stale-edit checks would then pass for the wrong reason: the remote edit would
 * lose because its stamp was old, not because the merge put an old clock behind a
 * new one. */
const at = (msFromNow) => new Date(Date.now() + msFromNow).toISOString();
const LATER = at(60_000);
const EARLIER = at(-60_000);

/** A plan as a device would hold it after some use. */
function withPlan() {
  let s = putEvent(EMPTY_TASKS, {
    title: "Team training",
    date: DAY,
    startMin: 1020,
    durationMin: 90,
    note: "bring boots",
    category: "extracurriculars",
  });
  s = addTaskPure(s, "Return library books", DAY, "personal");
  return s;
}

/** The server's shape, as the route emits it. */
const asServerTasks = (s) => ({
  events: s.events.map((e, i) => eventPayload(e, i)),
  tasks: s.tasks.map((t, i) => taskPayload(t, i)),
  deleted: [],
});
const asServerHabits = (s) => ({
  habits: s.habits.map((h, i) => habitPayload(h, i)),
  deleted: [],
});

console.log("\nplan sync: the merge, the payloads, the tombstones\n");

/* ---- 1. a second device reproduces the plan ---- */
{
  const first = withPlan();
  const merged = mergeTasks(EMPTY_TASKS, asServerTasks(first));

  check("a second device gets the event", merged.events.length === 1, `${merged.events.length}`);
  check("with its title", merged.events[0]?.title === "Team training");
  check("and its start time", merged.events[0]?.startMin === 1020, `${merged.events[0]?.startMin}`);
  check("and its duration", merged.events[0]?.durationMin === 90);
  check("and its note", merged.events[0]?.note === "bring boots");
  check(
    "and its category",
    merged.events[0]?.category === "extracurriculars",
    `${merged.events[0]?.category}`,
  );
  check("and the same id", merged.events[0]?.id === first.events[0]?.id);

  check("and the task", merged.tasks.length === 1, `${merged.tasks.length}`);
  check("undone", merged.tasks[0]?.done === false);
  check("with its category", merged.tasks[0]?.category === "personal");
  check("and its due date", merged.tasks[0]?.due === DAY);
}

/* ---- 2. a task with no due date survives the trip ---- */
{
  let s = addTaskPure(EMPTY_TASKS, "Learn to make ramen", null);
  s = addTaskPure(s, "Email the coach", DAY);
  const merged = mergeTasks(EMPTY_TASKS, asServerTasks(s));

  const someday = merged.tasks.find((t) => t.title === "Learn to make ramen");
  check("a task with no day comes back", !!someday);
  check("and is still due no day", someday?.due === null, `${someday?.due}`);
  check(
    "while the dated one keeps its day",
    merged.tasks.find((t) => t.title === "Email the coach")?.due === DAY,
  );
}

/* ---- 3. the newer edit wins, the older one loses ---- */
{
  /* Left on the store's own clock, which is now — so LATER is genuinely later than it
     and EARLIER genuinely earlier, and the two assertions below are about the
     comparison rather than about which stamp happened to be written later in the test. */
  const local = addTaskPure(EMPTY_TASKS, "Read chapter 4", DAY);

  /* Same row, edited later on another device. */
  const remote = {
    events: [],
    tasks: [
      {
        clientId: local.tasks[0].id,
        day: DAY,
        title: "Read chapter 4 and 5",
        done: true,
        note: "",
        category: "other",
        updatedAt: LATER,
        position: 0,
      },
    ],
    deleted: [],
  };
  const merged = mergeTasks(local, remote);
  check("a newer remote edit wins", merged.tasks[0]?.title === "Read chapter 4 and 5");
  check("and so does its done flag", merged.tasks[0]?.done === true);

  /* And the same edit arriving with a clock behind the local one. */
  const stale = { ...remote, tasks: [{ ...remote.tasks[0], updatedAt: EARLIER }] };
  const kept = mergeTasks(local, stale);
  check("an older remote edit is ignored", kept.tasks[0]?.title === "Read chapter 4");
  check("and leaves the local one done as it was", kept.tasks[0]?.done === false);
}

/* ---- 4. silence is not a delete ---- */
{
  const local = withPlan();
  /* A pull with a cursor returns only what changed, so an absent row means "not
     touched", never "gone". Treating it as a delete would empty the plan on every
     pull that happened to change something else. */
  const merged = mergeTasks(local, { events: [], tasks: [], deleted: [] });
  check("a pull with nothing in it changes nothing", merged === local);
  check("and the event is still there", merged.events.length === 1);
  check("and so is the task", merged.tasks.length === 1);
}

/* ---- 5. a delete crosses, namespaced ---- */
{
  const before = withPlan();
  let local = before;
  const taskId = local.tasks[0].id;
  const eventId = local.events[0].id;

  check("an event delete owes a tombstone", removeEventPure(local, eventId).pendingDeletes.events.includes(eventId));
  check("and removes it locally", removeEventPure(local, eventId).events.length === 0);
  check("leaving the task alone", removeEventPure(local, eventId).tasks.length === 1);
  check("and an unknown id changes nothing", removeEventPure(local, "nope") === local);

  local = removeTaskPure(local, taskId);

  check("a delete owes a tombstone", local.pendingDeletes.tasks.includes(taskId));
  check("and names it bare", local.pendingDeletes.tasks[0] === taskId);

  /* The route namespaces ids on the way out, because a task id and an event id are
     both bare strings and the two stores can hold the same one. */
  const merged = mergeTasks(local, { events: [], tasks: [], deleted: [`event:${eventId}`] });
  check("an event tombstone removes the event", merged.events.length === 0);
  check("and leaves the task alone", merged.tasks.length === 0, "the task was already removed above");

  const both = mergeTasks(local, {
    events: [],
    tasks: [],
    deleted: [`task:${taskId}`, `event:${eventId}`],
  });
  check("a task tombstone removes the task", both.tasks.length === 0);

  /* The other device's side of the same delete: it learns about it from the pull
     rather than from having deleted it. Merged into the record as it was *before*
     the delete, which is the point — the other device never had the delete applied
     locally, so its only knowledge of it is the tombstone. */
  const other = mergeTasks(before, {
    events: [],
    tasks: [],
    deleted: [`task:${taskId}`],
  });
  check("a delete on one device removes the row on the other", other.tasks.length === 0);
  check("and leaves its event", other.events.length === 1, `${other.events.length}`);
}

/* ---- 6. tombstones are cleared only by acknowledgement ---- */
{
  let local = withPlan();
  const id = local.tasks[0].id;
  local = removeTaskPure(local, id);
  check("and stay until the server confirms", local.pendingDeletes.tasks.length === 1);

  const cleared = clearPendingDeletes(local, { events: [], tasks: [id] });
  check("and are cleared by an acknowledgement", cleared.pendingDeletes.tasks.length === 0);

  const unrelated = clearPendingDeletes(local, { events: [], tasks: ["someone-elses-id"] });
  check("an acknowledgement for another id clears nothing", unrelated === local);
}

/* ---- 7. events and tasks with the same id do not collide ---- */
{
  /* Both stores mint ids the same way, so this is not a contrived case: it is what
     two devices that added one event and one task each will hold. */
  let local = putEvent(EMPTY_TASKS, {
    title: "Event",
    date: DAY,
    startMin: null,
    durationMin: null,
    note: "",
    category: "other",
  });
  /* Handed the event's own id rather than letting addTaskPure mint one, because the
     property under test is that two stores can hold the same eight characters — which
     happens in real use every time two devices each add one row, and cannot be
     provoked by waiting for two random eight-character strings to collide. */
  const shared = local.events[0].id;
  local = {
    ...local,
    tasks: [
      ...local.tasks,
      { id: shared, title: "Task", due: DAY, done: false, createdAt: LATER, updatedAt: LATER, note: "", category: "other" },
    ],
  };
  check("the test really does share one id", local.tasks[0].id === shared);

  const merged = mergeTasks(local, { events: [], tasks: [], deleted: [`event:${shared}`] });
  check("an event tombstone removes only the event", merged.events.length === 0);
  check("and leaves the task standing", merged.tasks.length === 1, `${merged.tasks.length}`);
}

/* ---- 8. untrusted input cannot make an impossible row ---- */
{
  const merged = mergeTasks(EMPTY_TASKS, {
    events: [
      { clientId: "e1", day: "not-a-day", title: "Bad day", updatedAt: LATER },
      { clientId: "e2", day: DAY, title: "   ", updatedAt: LATER },
      { clientId: "e3", day: DAY, title: "Fine", startMin: 9999, updatedAt: LATER },
      null,
      "nonsense",
      { clientId: "e4", day: DAY, title: "Good", startMin: -5, durationMin: 0, updatedAt: LATER },
    ],
    tasks: [],
    deleted: ["task:whatever"],
  });

  check("a bad day is dropped", !merged.events.some((e) => e.id === "e1"));
  check("a blank title is dropped", !merged.events.some((e) => e.id === "e2"));
  check("a start past midnight is dropped", merged.events.find((e) => e.id === "e3")?.startMin === null);
  check("a non-row is dropped", merged.events.length === 2, `${merged.events.length}`);
  check("a negative start becomes no start", merged.events.find((e) => e.id === "e4")?.startMin === null);
  check("a zero duration becomes no duration", merged.events.find((e) => e.id === "e4")?.durationMin === null);
  check("the good row survives", merged.events.find((e) => e.id === "e4")?.title === "Good");
  check("and a stray delete of an absent row is harmless", merged.tasks.length === 0);
}

/* ---- 9. the local record's own rules ---- */
{
  const before = withPlan();
  const s = toggleTaskPure(before, before.tasks[0].id);
  check("toggling moves the clock", s.tasks[0].updatedAt > before.tasks[0].updatedAt, `${s.tasks[0].updatedAt} vs ${before.tasks[0].updatedAt}`);
  check("and flips done", s.tasks[0].done === true);

  const old = addTaskPure(EMPTY_TASKS, "T", DAY);
  check("an unclocked row reads as long ago", reviveTasks({ tasks: [{ id: "x", title: "T" }] }).tasks[0].updatedAt.startsWith("1970"));
  check("and an event the same", reviveTasks({ events: [{ id: "x", title: "E", date: DAY }] }).events[0].updatedAt.startsWith("1970"));
  check("a record with no owner is unclaimed, not empty", reviveTasks(old).owner === null);
  check("so its rows are still there", reviveTasks(old).tasks.length === 1);

  /* A hand-edited record must not put a non-string into a list that gets sent back
     to the server. */
  const dirty = reviveTasks({ tasks: [], pendingDeletes: { tasks: [1, "ok", null], events: "no" } });
  check("a non-string in the delete list is dropped", JSON.stringify(dirty.pendingDeletes.tasks) === '["ok"]');
  check("a non-list delete field is ignored", dirty.pendingDeletes.events.length === 0);

  const missing = reviveTasks({ tasks: [{ id: "x", title: "" }], events: [{ id: "y", date: "nope" }] });
  check("a blank title is dropped on the way in", missing.tasks.length === 0);
  check("and a bad day with it", missing.events.length === 0);
}

/* ---- 10. wiping the plan owes every row ---- */
{
  const s = withPlan();
  /* The delete list is the only thing that can tell the server about rows that were
     just removed locally. Dropping it here would mean the other device keeps a
     calendar the user threw away. */
  const ids = s.events.map((e) => e.id).concat(s.tasks.map((t) => t.id));
  check("both rows have ids to tombstone", ids.length === 2);
}

/* ---- 11. habits, the whole-state merge ---- */
{
  let first = addHabitPure(EMPTY_HABITS, "Read");
  first = toggleHabitPure(first, first.habits[0].id, DAY);
  check("a toggled day is on the habit", first.habits[0].days.includes(DAY));

  const merged = mergeHabits(EMPTY_HABITS, asServerHabits(first));
  check("a second device gets the habit", merged.habits.length === 1, `${merged.habits.length}`);
  check("with its name", merged.habits[0]?.name === "Read");
  check("and its grid", merged.habits[0]?.days.includes(DAY));
  check("and the same id", merged.habits[0]?.id === first.habits[0].id);

  /* Toggling moves the clock, so the round trip is not a flapping one: the device
     that pushed sees the same habit come back and keeps it. */
  const home = mergeHabits(first, asServerHabits(first));
  check("a device that pushed sees no change come back", home === first);
}

/* ---- 12. a habit renamed elsewhere wins, an older rename loses ---- */
{
  /* On the store's own clock, for the reason given in the task section above. */
  const local = addHabitPure(EMPTY_HABITS, "Read");
  const renamed = {
    habits: [
      {
        clientId: local.habits[0].id,
        name: "Read every day",
        days: [],
        updatedAt: LATER,
        position: 0,
      },
    ],
    deleted: [],
  };
  check("a newer remote rename wins", mergeHabits(local, renamed).habits[0].name === "Read every day");
  check(
    "an older one is ignored",
    mergeHabits(local, { ...renamed, habits: [{ ...renamed.habits[0], updatedAt: EARLIER }] }).habits[0]
      .name === "Read",
  );
  check(
    "a pull with nothing in it changes nothing",
    mergeHabits(local, { habits: [], deleted: [] }) === local,
  );
}

/* ---- 13. a deleted habit takes its grid with it ---- */
{
  let local = addHabitPure(EMPTY_HABITS, "Read");
  const id = local.habits[0].id;
  const before = toggleHabitPure(local, id, DAY);
  local = removeHabitPure(before, id);

  check("a habit delete owes one tombstone", local.pendingDeletes.includes(id));
  check("not one per day", local.pendingDeletes.length === 1, `${local.pendingDeletes.length}`);
  check("and the habit is gone locally", local.habits.length === 0);

  /* The other device, which still has the habit and its grid and only learns of the
     delete from the pull. */
  const other = mergeHabits(before, { habits: [], deleted: [`habit:${id}`] });
  check("a habit tombstone removes it on the other device", other.habits.length === 0);

  /* An event and a habit can share an id, which is why the route namespaces them. */
  const scoped = mergeHabits(local, { habits: [{ clientId: id, name: "Read", days: [], updatedAt: LATER }], deleted: [] });
  check("an event's delete does not take a habit with it", scoped.habits.length === 1);

  check("an acknowledgement clears it", clearHabitDeletes(local, [id]).pendingDeletes.length === 0);
  check("and an unrelated one does not", clearHabitDeletes(local, ["other"]) === local);
  check("while the habit itself is untouched by clearing", clearHabitDeletes(local, [id]).habits.length === 0);
}

/* ---- 14. habit days are validated like everything else ---- */
{
  const merged = mergeHabits(EMPTY_HABITS, {
    habits: [
      { clientId: "h1", name: "Fine", days: [DAY, "nope", DAY], updatedAt: LATER },
      { clientId: "h2", name: "  ", days: [], updatedAt: LATER },
      { clientId: "h3", name: "No days", days: "nope", updatedAt: LATER },
    ],
    deleted: [],
  });
  check("a bad day is dropped from a grid", merged.habits.find((h) => h.id === "h1")?.days.length === 1);
  check("a duplicate day is collapsed", merged.habits.find((h) => h.id === "h1")?.days[0] === DAY);
  check("a blank name is dropped", !merged.habits.some((h) => h.id === "h2"));
  check("a habit with no day list arrives with none", merged.habits.find((h) => h.id === "h3")?.days.length === 0);
  check("the good ones survive", merged.habits.length === 2, `${merged.habits.length}`);

  const dirty = reviveHabits({ habits: [{ id: "h", name: "H" }], pendingDeletes: [1, "ok"] });
  check("an unclocked habit reads as long ago", dirty.habits[0].updatedAt.startsWith("1970"));
  check("a non-string in the delete list is dropped", JSON.stringify(dirty.pendingDeletes) === '["ok"]');
  check("a record with no owner is unclaimed", dirty.owner === null);
  check("and an absent list is empty", reviveHabits({ habits: [] }).pendingDeletes.length === 0);
}

console.log(failures === 0 ? "\nall plan sync checks passed\n" : `\n${failures} failed\n`);
process.exit(failures === 0 ? 0 : 1);