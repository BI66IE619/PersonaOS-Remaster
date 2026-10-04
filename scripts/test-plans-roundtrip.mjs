/**
 * The plan tab's half of /api/sync, against a real database.
 *
 * The pure merge is covered in test-plans-sync.mjs. What this covers is the part that
 * merge cannot prove: that a calendar, a task and a habit grid pushed from one device
 * come back out of the server as the same three, through the same DAL a route calls,
 * with the unique indexes, the conflict clauses and the foreign key actually behaving.
 *
 * The awkward parts live here rather than in the merge test, because they only exist
 * in the database:
 *
 *   - an event pushed twice is one row, which needs the (user_id, client_id) index
 *   - a task with no day is stored as no day, which needs the column to be nullable
 *   - a habit's days are replaced wholesale and the habit uuid is resolved from a
 *     client id the device has never seen
 *   - a losing habit push does not overwrite the winner's grid
 *   - a tombstone stops the row coming back and takes the habit's days with it
 *
 * Rows are written under a throwaway user id and cleaned up after, so this never
 * touches a real account's plan.
 *
 * Run: node --env-file=.env.local --experimental-strip-types --no-warnings --import ./scripts/ts-alias.mjs scripts/test-plans-roundtrip.mjs
 */
import postgres from "postgres";
import nextEnv from "@next/env";
import { randomUUID } from "node:crypto";

/* @next/env is CommonJS, so the named import is not available under ESM. */
const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

let failures = 0;
function check(name, condition, detail = "") {
  if (condition) {
    console.log(`  ok    ${name}`);
  } else {
    failures++;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const sql = postgres(process.env.DATABASE_URL ?? "", { max: 1 });
const TEST_USER = randomUUID();

/* Exercised through the DAL rather than over HTTP: a request would need a session, and
 * forging one would test the auth layer instead of the thing being tested here. The
 * zod body is checked separately, in test-plans-sync's shape. */
const dal = await import("../src/lib/dal.ts");
const tasks = await import("../src/lib/tasks.ts");
const habits = await import("../src/lib/habits.ts");
const { EMPTY_TASKS } = await import("../src/lib/types-tasks.ts");
const { EMPTY_HABITS } = await import("../src/lib/types-habits.ts");

const DAY = "2026-04-12";
const LATER = new Date(Date.now() + 60_000).toISOString();
const MUCH_LATER = new Date(Date.now() + 120_000).toISOString();

console.log("\nplan round trip: through the database, both directions\n");

/* A profile row first: every other table references it, and the app creates it lazily
   at first write. Reproduced here so the foreign keys behave as they do in production
   rather than being skipped. */
await sql`insert into profiles (id, email, display_name) values (${TEST_USER}::uuid, ${`plans-test-${TEST_USER}@example.invalid`}, 'plans test') on conflict do nothing`;

const cleanup = async () => {
  await sql`delete from profiles where id = ${TEST_USER}::uuid`;
  await sql.end({ timeout: 5 }).catch(() => {});
};

/** The plan a first device holds after some use. */
function deviceOnePlan() {
  let t = tasks.putEvent(EMPTY_TASKS, {
    title: "Team training",
    date: DAY,
    startMin: 1020,
    durationMin: 90,
    note: "bring boots",
    category: "extracurriculars",
  });
  t = tasks.putEvent(t, {
    title: "All-day thing",
    date: DAY,
    startMin: null,
    durationMin: null,
    note: "",
    category: "other",
  });
  t = tasks.addTaskPure(t, "Return library books", DAY, "personal");
  t = tasks.addTaskPure(t, "Learn to make ramen", null);
  return t;
}

const pushPlan = (t) =>
  dal.upsertPlanEvents(
    TEST_USER,
    t.events.map((e, i) => tasks.eventPayload(e, i)),
  );
const pushTasks = (t) =>
  dal.upsertPlanTasks(
    TEST_USER,
    t.tasks.map((k, i) => tasks.taskPayload(k, i)),
  );
const pushHabits = (h) =>
  dal.upsertPlanHabits(
    TEST_USER,
    h.habits.map((k, i) => habits.habitPayload(k, i)),
  );

/** The habit days as the route folds them onto their habits. */
async function habitGrids() {
  const [rows, days] = await Promise.all([
    dal.getPlanHabits(TEST_USER),
    dal.getPlanHabitDays(TEST_USER),
  ]);
  const byHabit = new Map();
  for (const d of days) {
    byHabit.set(d.habitClientId, [...(byHabit.get(d.habitClientId) ?? []), d.day]);
  }
  return rows.map((h) => ({ clientId: h.clientId, name: h.name, days: byHabit.get(h.clientId) ?? [] }));
}

try {
  /* ---- 1. a plan goes in ---- */
  const one = deviceOnePlan();
  await pushPlan(one);
  await pushTasks(one);

  const events = await dal.getPlanEvents(TEST_USER);
  check("the events came back", events.length === 2, `${events.length} events`);
  const training = events.find((e) => e.clientId === one.events[0].id);
  check("with the same client id", training !== undefined);
  check("and its title", training?.title === "Team training");
  check("and its start minute", training?.startMin === 1020, `${training?.startMin}`);
  check("and its duration", training?.durationMin === 90);
  check("and its note", training?.note === "bring boots");
  check("and its category", training?.category === "extracurriculars");
  check(
    "an all-day event keeps no start",
    events.find((e) => e.clientId === one.events[1].id)?.startMin === null,
  );

  const rows = await dal.getPlanTasks(TEST_USER);
  check("the tasks came back", rows.length === 2, `${rows.length} tasks`);
  const someday = rows.find((t) => t.clientId === one.tasks[1].id);
  check("a task with no day is stored with no day", someday !== undefined);
  check("rather than being dropped or given a date", someday?.day === null, `${someday?.day}`);
  check("and keeps its category", someday?.category === "other");
  check(
    "a dated task keeps its day",
    rows.find((t) => t.clientId === one.tasks[0].id)?.day === DAY,
  );

  /* ---- 2. the second device ---- */
  /* A device that has never seen this plan reads it and rebuilds the local record.
     This is the claim being made to the user, so it is asserted end to end. */
  const two = tasks.mergeRemote(EMPTY_TASKS, {
    events: events.map((e) => ({
      clientId: e.clientId,
      day: e.day,
      title: e.title,
      startMin: e.startMin,
      durationMin: e.durationMin,
      position: e.position,
      note: e.note,
      category: e.category,
      updatedAt: e.updatedAt.toISOString(),
    })),
    tasks: rows.map((t) => ({
      clientId: t.clientId,
      day: t.day,
      title: t.title,
      done: t.done,
      position: t.position,
      note: t.note,
      category: t.category,
      updatedAt: t.updatedAt.toISOString(),
    })),
    deleted: [],
  });

  check("a second device reconstructs both events", two.events.length === 2, `${two.events.length}`);
  check("with the titles intact", two.events.some((e) => e.title === "Team training"));
  check("and the ids matching", two.events.every((e) => one.events.some((o) => o.id === e.id)));
  check("and both tasks", two.tasks.length === 2, `${two.tasks.length}`);
  check("including the someday one", two.tasks.some((t) => t.due === null));
  check("which stays undated", two.tasks.find((t) => t.title === "Learn to make ramen")?.due === null);

  /* Push that second device's record straight back. A retried sync is the normal case,
     not the edge one, and it must not duplicate anything. */
  await pushPlan(two);
  await pushTasks(two);
  const afterRepush = await dal.getPlanEvents(TEST_USER);
  check("re-pushing a round-tripped plan does not duplicate the events", afterRepush.length === 2, `${afterRepush.length} events`);
  check("nor the tasks", (await dal.getPlanTasks(TEST_USER)).length === 2);

  /* ---- 3. a task ticked on one device reaches the other ---- */
  const ticked = tasks.toggleTaskPure(two, two.tasks[0].id);
  await pushTasks(ticked);
  const afterTick = await dal.getPlanTasks(TEST_USER);
  check(
    "a toggle on device two is stored done",
    afterTick.find((t) => t.clientId === ticked.tasks[0].id)?.done === true,
  );
  const backOnOne = tasks.mergeRemote(one, {
    events: [],
    tasks: afterTick.map((t) => ({
      clientId: t.clientId,
      day: t.day,
      title: t.title,
      done: t.done,
      position: t.position,
      note: t.note,
      category: t.category,
      /* .toISOString(), not the Date the DAL handed back. Over JSON this is what
         the route sends and what the merge actually sees, and handing the raw Date
         instead would test a shape no device ever receives — where every row reads
         as unclocked and loses every conflict. */
      updatedAt: t.updatedAt.toISOString(),
    })),
    deleted: [],
  });
  check("and device one sees it done", backOnOne.tasks.find((t) => t.id === ticked.tasks[0].id)?.done === true);

  /* ---- 4. a habit and its grid ---- */
  let oneHabits = habits.addHabitPure(EMPTY_HABITS, "Read");
  const read = oneHabits.habits[0].id;
  oneHabits = habits.toggleHabitPure(oneHabits, read, DAY);
  oneHabits = habits.toggleHabitPure(oneHabits, read, "2026-04-11");
  await pushHabits(oneHabits);

  check("the habit came back", (await habitGrids()).length === 1);
  let grid = await habitGrids();
  check("with both days", grid[0]?.days.length === 2, `${grid[0]?.days.length} days`);
  check("including the one just toggled", grid[0]?.days.includes(DAY));

  /* A second device rebuilds the grid from the habit and its days together, which is
     what the route's fold is for. */
  const twoHabits = habits.mergeRemote(EMPTY_HABITS, {
    habits: (await habitGrids()).map((h) => ({ clientId: h.clientId, name: h.name, days: h.days, updatedAt: LATER })),
    deleted: [],
  });
  check("a second device reconstructs the habit", twoHabits.habits.length === 1);
  check("with both days", twoHabits.habits[0]?.days.length === 2, `${twoHabits.habits[0]?.days.length}`);

  /* Un-toggling a day on another device replaces the grid rather than adding to it.
     This is the whole-state rule, and it is the case that is easy to get wrong: a
     merge would leave the day on forever. */
  await pushHabits(habits.toggleHabitPure(twoHabits, read, DAY));
  grid = await habitGrids();
  check("an un-toggled day comes off the server's grid", !grid[0]?.days.includes(DAY), `${grid[0]?.days}`);
  check("and the other day stays", grid[0]?.days.includes("2026-04-11"));
  check("with no duplicates", new Set(grid[0]?.days).size === grid[0]?.days.length);

  /* ---- 5. a losing habit push does not rewrite the winner's grid ---- */
  /* The conflict unit is the habit, so a stale push must leave both the row and its
     days alone. Without this the two devices disagree until the next sync, which is
     the flapping this design exists to avoid. */
  const currentRows = await dal.getPlanHabits(TEST_USER);
  const currentStamp = currentRows[0].updatedAt.toISOString();
  const stale = [
    {
      clientId: read,
      name: "Read (renamed long ago)",
      days: ["2020-01-01"],
      position: 0,
      updatedAt: new Date(Date.parse(currentStamp) - 60_000).toISOString(),
    },
  ];
  const written = await dal.upsertPlanHabits(TEST_USER, stale);
  check("a stale habit push writes nothing", written.size === 0, `${written.size} written`);
  grid = await habitGrids();
  check("and leaves the name alone", grid[0]?.name === "Read", `${grid[0]?.name}`);
  check("and the grid alone", !grid[0]?.days.includes("2020-01-01"), `${grid[0]?.days}`);

  /* A newer one wins, both row and grid. */
  await dal.upsertPlanHabits(TEST_USER, [
    { clientId: read, name: "Read daily", days: ["2026-04-10"], position: 0, updatedAt: MUCH_LATER },
  ]);
  grid = await habitGrids();
  check("a newer habit push wins the row", grid[0]?.name === "Read daily", `${grid[0]?.name}`);
  check("and rewrites the grid", grid[0]?.days.length === 1 && grid[0]?.days[0] === "2026-04-10", `${grid[0]?.days}`);

  /* ---- 6. tombstones ---- */
  const doomedEvent = one.events[0].id;
  const doomedTask = one.tasks[0].id;
  await dal.tombstoneEvents(TEST_USER, [doomedEvent]);
  await dal.tombstoneTasks(TEST_USER, [doomedTask]);

  const afterDeletes = await dal.getPlanEvents(TEST_USER);
  check("a deleted event does not come back", !afterDeletes.some((e) => e.clientId === doomedEvent), `${afterDeletes.length} events`);
  check("and the other one stays", afterDeletes.some((e) => e.clientId === one.events[1].id));
  check("a deleted task does not come back", !(await dal.getPlanTasks(TEST_USER)).some((t) => t.clientId === doomedTask));

  /* The route reads tombstones separately from live rows, because a pull's ordinary
     reads exclude them. */
  const deletes = await dal.getDeletedPlanRows(TEST_USER, 2000);
  check("the event's tombstone is readable", deletes.some((d) => d.kind === "event" && d.clientId === doomedEvent));
  check("and the task's", deletes.some((d) => d.kind === "task" && d.clientId === doomedTask));
  check("each named with its store", deletes.every((d) => ["task", "event", "habit"].includes(d.kind)));

  /* A delete of a habit takes its days with it. A tombstone is not a delete, so the
     cascade does not fire — and a pull that read the leftover days would hand a device
     a grid for a habit that no longer exists. */
  await dal.tombstoneHabits(TEST_USER, [read]);
  check("the habit is gone", (await dal.getPlanHabits(TEST_USER)).length === 0);
  check("and its days went with it", (await dal.getPlanHabitDays(TEST_USER)).length === 0, `${(await dal.getPlanHabitDays(TEST_USER)).length} days`);
  check("and its tombstone is readable", (await dal.getDeletedPlanRows(TEST_USER, 2000)).some((d) => d.kind === "habit" && d.clientId === read));

  /* ---- 7. an edit after a delete brings the row back ---- */
  /* The resurrection guard: a stale re-push must lose to the tombstone, and a real
     later edit must win. Both matter — one loses data, the other makes a deleted task
     impossible to delete. */
  await dal.upsertPlanTasks(TEST_USER, [
    {
      clientId: doomedTask,
      day: DAY,
      title: "Return library books",
      done: false,
      note: "",
      category: "personal",
      position: 0,
      updatedAt: new Date(Date.parse(currentStamp) - 60_000).toISOString(),
    },
  ]);
  check(
    "a stale re-push cannot resurrect a deleted task",
    !(await dal.getPlanTasks(TEST_USER)).some((t) => t.clientId === doomedTask),
  );
  await dal.upsertPlanTasks(TEST_USER, [
    {
      clientId: doomedTask,
      day: DAY,
      title: "Return library books",
      done: false,
      note: "",
      category: "personal",
      position: 0,
      updatedAt: MUCH_LATER,
    },
  ]);
  check(
    "a real later edit brings it back",
    (await dal.getPlanTasks(TEST_USER)).some((t) => t.clientId === doomedTask),
  );

  /* ---- 8. the cursor ---- */
  /* A pull asks for what is newer, so a device that has seen a row must not be handed
     it again, and one that has not seen a row must be. The comparison is on the
     device's own clock, which is what makes a lagging clock honest rather than a
     silent data loss. */
  const all = await dal.getPlanEvents(TEST_USER);
  const newest = all.map((e) => e.updatedAt.toISOString()).sort().pop();
  const afterCursor = await dal.getPlanEvents(TEST_USER, newest);
  check("a pull past the newest row returns nothing", afterCursor.length === 0, `${afterCursor.length} events`);
  const fromStart = await dal.getPlanEvents(TEST_USER, "2000-01-01T00:00:00.000Z");
  check("a pull from the beginning returns everything", fromStart.length === all.length);
  check("an unparseable cursor reads everything rather than nothing", (await dal.getPlanEvents(TEST_USER, "nonsense")).length === all.length);

  /* ---- 9. another account's plan is invisible ---- */
  const OTHER_USER = randomUUID();
  await sql`insert into profiles (id, email, display_name) values (${OTHER_USER}::uuid, ${`plans-other-${OTHER_USER}@example.invalid`}, 'other') on conflict do nothing`;
  try {
    await dal.upsertPlanEvents(OTHER_USER, [
      { clientId: "not-mine", day: DAY, title: "Someone else", startMin: null, durationMin: null, position: 0, note: "", category: "other", updatedAt: LATER },
    ]);
    check("another account's event is not read back", !(await dal.getPlanEvents(TEST_USER)).some((e) => e.clientId === "not-mine"));
    check("nor its tasks", (await dal.getPlanTasks(OTHER_USER)).every((t) => t.clientId !== "not-mine"));

    /* And a tombstone cannot reach across accounts, which is the same user_id
       constraint with a write attached. */
    await dal.tombstoneEvents(OTHER_USER, ["not-mine"]);
    check(
      "and a delete aimed at another account's id does nothing here",
      (await dal.getPlanEvents(OTHER_USER)).length === 0,
    );
  } finally {
    await sql`delete from profiles where id = ${OTHER_USER}::uuid`;
  }

  /* ---- 10. a bad day is refused, not coerced ---- */
  /* The old behavior returned 1970-01-01 for anything unparseable, which synced
     successfully and then showed up in no window and was never seen again. */
  let refused = false;
  try {
    await dal.upsertPlanEvents(TEST_USER, [
      { clientId: "bad", day: "not-a-day", title: "Bad", startMin: null, durationMin: null, position: 0, note: "", category: "other", updatedAt: LATER },
    ]);
  } catch {
    refused = true;
  }
  check("a bad day throws rather than becoming 1970", refused);
  check("and nothing was written", !(await dal.getPlanEvents(TEST_USER)).some((e) => e.clientId === "bad"));

  /* A task's bad day is the same question, and null is not a bad day — the someday
     bucket has to survive the trip. */
  await dal.upsertPlanTasks(TEST_USER, [
    { clientId: "someday", day: null, title: "No day", done: false, note: "", category: "other", position: 0, updatedAt: LATER },
  ]);
  check("a null day is accepted for a task", (await dal.getPlanTasks(TEST_USER)).some((t) => t.clientId === "someday"));
} catch (e) {
  failures++;
  console.log(`  FAIL  threw — ${e.message}`);
  /* Postgres errors arrive as a cause on the wrapper, and the cause is the only place
     the actual reason is named — the message above is the query. */
  if (e.cause) console.log(`  cause — ${e.cause.message ?? e.cause}`);
} finally {
  await cleanup();
}

console.log(failures === 0 ? "\nall plan round trip checks passed\n" : `\n${failures} failed\n`);
process.exit(failures === 0 ? 0 : 1);