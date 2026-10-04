import { launchBrowser } from "./auth-state.mjs";

/* Sport sessions: the Home prompt is driven by the calendar, not asked daily.
   A sporting event today makes Home ask; nothing flagged keeps it quiet. An
   unplanned session is logged from Vitality instead. */

const BASE = process.env.SHOT_URL ?? "http://localhost:3000";
const pad = (n) => String(n).padStart(2, "0");
const d = new Date();
const today = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

const NO_EVENTS = { events: [], tasks: [], seeded: true };
const SPORT_EVENT = {
  events: [
    {
      id: "ev1",
      title: "Tennis match",
      date: today,
      startMin: 1020,
      durationMin: 90,
      note: "",
      category: "extracurriculars",
      sport: true,
    },
  ],
  tasks: [],
  seeded: true,
};

const seed = (page, tasks, sports) =>
  page.addInitScript(
    ([t, s]) => {
      localStorage.setItem("personaos:tasks", JSON.stringify(t));
      if (s) localStorage.setItem("personaos:sports", JSON.stringify(s));
    },
    [tasks, sports],
  );

const b = await launchBrowser();
const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(String(e)));

/* On Tue/Thu/Sat the provider's programme already writes a "Run" from the watch,
   so the log has a device session before this file has done anything. That is
   correct app behaviour, and it made every count below wrong on those three days:
   the suite was written when it happened to run on a rest day, and it failed 19
   checks on the next Tuesday.

   The id is read off a real load rather than guessed, because the app keys the
   remembered deletion on the provider's workout id, and a hardcoded "Run — Easy"
   would quietly stop matching the moment the programme changed. */
const deviceWorkoutId = await (async () => {
  const probe = await ctx.newPage();
  await probe.goto(`${BASE}/vitals`, { waitUntil: "load" });
  await probe.waitForTimeout(1200);
  const id = await probe.evaluate(() => {
    const s = JSON.parse(localStorage.getItem("personaos:sports") ?? "{}");
    return (s.sessions ?? []).find((x) => x.source === "device")?.deviceId ?? null;
  });
  await probe.close();
  return id;
})();
console.log(`note  watch workout hidden for this fixture: ${deviceWorkoutId ?? "none today"}`);

let failures = 0;
const check = (name, cond, extra = "") => {
  if (!cond) failures++;
  console.log(`${cond ? "ok  " : "FAIL"} ${name}${extra ? ` — ${extra}` : ""}`);
};

const loggedPanel = () =>
  page.locator("section", { has: page.getByText("Logged today", { exact: true }) });

/* The provider builds today's workout from a fixed weekly programme: Sun/Wed
   are strength, Tue/Thu/Sat are runs, Mon/Fri are rest. A run is a sport, so on
   those days the log answers itself and Home has nothing to ask. The prompt
   checks below are therefore only meaningful on the other five. */
const dow = d.getDay();
const expectRun = dow === 2 || dow === 4 || dow === 6;
const skip = (why) => console.log(`skip ${why}`);

/* ---- no sporting event: generic prompt still asks ---- */
if (expectRun) {
  skip("prompt checks — today is a run day, so the log answers itself");
} else {
  await seed(page, NO_EVENTS);
  await page.goto(`${BASE}/home`, { waitUntil: "load" });
  await page.waitForTimeout(1200);
  check(
    "no sporting event still asks, generically",
    (await loggedPanel().getByText("Practice or game today").count()) === 1,
  );

  /* ---- sporting event today: Home asks, naming the event ---- */
  await seed(page, SPORT_EVENT);
  await page.goto(`${BASE}/home`, { waitUntil: "load" });
  await page.waitForTimeout(1200);
  check("sporting event today prompts", (await loggedPanel().getByText("Sports session?").count()) === 1);
  check(
    "the prompt names the event, display only",
    (await loggedPanel().getByText(/Tennis match · /).count()) === 1,
  );

  /* ---- No dismisses for the day, and it stays dismissed ---- */
  await loggedPanel().getByRole("button", { name: "No", exact: true }).click();
  await page.waitForTimeout(300);
  check("No hides the prompt", (await loggedPanel().getByText("Sports session?").count()) === 0);
  await page.reload({ waitUntil: "load" });
  await page.waitForTimeout(1200);
  check(
    "it stays dismissed after a reload",
    (await loggedPanel().getByText("Sports session?").count()) === 0,
  );

  /* ---- Yes opens the form; save renders the summary ---- */
  await page.evaluate(() => localStorage.removeItem("personaos:sports"));
  await page.reload({ waitUntil: "load" });
  await page.waitForTimeout(1200);
  await loggedPanel().getByRole("button", { name: "Yes", exact: true }).click();
  await page.waitForTimeout(300);
  check("Yes opens the dialog", (await page.getByRole("dialog").count()) === 1);

  const saveBtn = page.getByRole("button", { name: "Save", exact: true });
  check("Save starts disabled", await saveBtn.isDisabled());
  await page.getByRole("dialog").locator("select").first().selectOption("Tennis");
  await page.getByRole("dialog").locator("select").nth(1).selectOption("game");
  await page.getByLabel("Hours").fill("1");
  await page.getByLabel("Minutes").fill("30");
  await page.getByRole("button", { name: "Intensity 4 of 5" }).click();
  check("Save enables once complete", !(await saveBtn.isDisabled()));
  await saveBtn.click();
  await page.waitForTimeout(300);
  check(
    "the summary row replaces the prompt",
    (await loggedPanel().getByText(/Tennis · Game · 1h 30m · intensity 4\/5/).count()) === 1,
  );
}

/* ---- Vitality: the add button covers the unplanned session ---- */
await seed(page, NO_EVENTS, {
  sessions: [],
  dismissed: [],
  hiddenDevice: deviceWorkoutId ? [deviceWorkoutId] : [],
});
await page.goto(`${BASE}/vitals`, { waitUntil: "load" });
await page.waitForTimeout(1200);
const addBtn = page.getByRole("button", { name: /Log a sports session/ });
check("Vitality offers to log a session", (await addBtn.count()) === 1);
await addBtn.click();
await page.waitForTimeout(300);
await page.getByRole("dialog").locator("select").first().selectOption("Running");
await page.getByRole("dialog").locator("select").nth(1).selectOption("practice");
await page.getByLabel("Minutes").fill("45");
await page.getByRole("button", { name: "Intensity 2 of 5" }).click();
await page.getByRole("dialog").getByRole("button", { name: "Save", exact: true }).click();
await page.waitForTimeout(300);
check(
  "the session lands in the Today list",
  (await page.getByText(/Running practice/).count()) === 1,
);
check(
  "the add button stays for a second session the same day",
  (await page.getByRole("button", { name: /Log a sports session/ }).count()) === 1,
);

/* The claim above used to be named "a second manual session does not replace the
   first" while only ever logging one session. Log a second one for real. */
await page.getByRole("button", { name: /Log a sports session/ }).click();
await page.waitForTimeout(250);
await page.getByRole("dialog").locator("select").first().selectOption("Basketball");
await page.getByRole("dialog").locator("select").nth(1).selectOption("game");
await page.getByLabel("Minutes").fill("40");
await page.getByRole("button", { name: "Intensity 4 of 5" }).click();
await page.getByRole("dialog").getByRole("button", { name: "Save", exact: true }).click();
await page.waitForTimeout(300);
check(
  "both sessions from the same day are listed",
  (await page.getByText(/Running practice/).count()) === 1 &&
    (await page.getByText(/Basketball game/).count()) === 1,
);
check(
  "a second manual session does not replace the first",
  (await page.evaluate(
    (day) => {
      const s = JSON.parse(localStorage.getItem("personaos:sports") ?? "{}");
      return (s.sessions ?? []).filter((x) => x.source === "manual" && x.date === day).length;
    },
    today,
  )) === 2,
);

/* ---- deleting a session you logged by mistake ----
   One tap, then a strip that offers to put it back. The old flow asked for a
   confirmation first because a session exists nowhere but this log; undo means
   the mistake is already cheap, so the safe action is the quick one. */
const sessionsToday = (p = page) =>
  p.evaluate(
    (day) =>
      (JSON.parse(localStorage.getItem("personaos:sports") ?? "{}").sessions ?? []).filter(
        (x) => x.date === day,
      ),
    today,
  );

check("two sessions to choose from", (await sessionsToday()).length === 2, JSON.stringify((await sessionsToday()).map((x) => x.sport)));

const deleteRun = page.getByRole("button", { name: /^Delete this session — Running, 45m$/ });
const deleteBall = page.getByRole("button", { name: /^Delete this session — Basketball, 40m$/ });
check("each session carries its own delete, with no selection step", (await deleteRun.count()) === 1, String(await deleteRun.count()));
check("and the other one is addressable on its own terms", (await deleteBall.count()) === 1, String(await deleteBall.count()));
check("there is nothing to cancel, because nothing is pending", (await page.getByRole("button", { name: "Cancel", exact: true }).count()) === 0);
check("and no undo before anything is deleted", (await page.getByRole("button", { name: "Undo", exact: true }).count()) === 0);

/* ---- the delete control looks like every other one in the app ----
   It used to be a bordered, always-visible "Delete" label on every row, which
   meant a day with three sessions showed three of them and the row lost to its
   own control. The rest of the app — habits, tasks, events, notes, photos —
   uses a bare cross that appears on hover, and this one now does too. Asserted
   rather than left to a screenshot, because a permanent control and a revealed
   one look similar in a still. */
const opacity = (loc) => loc.evaluate((el) => Number(getComputedStyle(el).opacity));
/* Park the pointer somewhere neutral first. `group-hover` answers to where the
   real cursor is, and the last thing this test did was click Save on a dialog
   that sat over the second row — so that row was genuinely hovered, and
   measuring without moving the mouse would have blamed the component for the
   harness's own leftovers. */
await page.mouse.move(2, 2);
await page.waitForTimeout(300);
check("the delete is a bare cross, not a labelled button", (await deleteRun.innerText()).trim() === "✕", JSON.stringify((await deleteRun.innerText()).trim()));
check("and it stays out of the way until the row is hovered", (await opacity(deleteRun)) === 0, `opacity ${await opacity(deleteRun)}`);
check("every row's delete is hidden, not just the hovered one", (await opacity(deleteBall)) === 0, `opacity ${await opacity(deleteBall)}`);

await deleteRun.hover();
await page.waitForTimeout(300);
check("hovering the row reveals it", (await opacity(deleteRun)) === 1, `opacity ${await opacity(deleteRun)}`);
check("and leaves the other row alone", (await opacity(deleteBall)) === 0, `opacity ${await opacity(deleteBall)}`);

/* Keyboard readers get the same affordance without a pointer, which is the
   reason `focus-visible` is on the class and not only `group-hover`. */
await deleteRun.focus();
await page.waitForTimeout(300);
check("focus reveals it too, for anyone not using a pointer", (await opacity(deleteRun)) === 1, `opacity ${await opacity(deleteRun)}`);
check("while the other row is still untouched", (await opacity(deleteBall)) === 0, `opacity ${await opacity(deleteBall)}`);
await deleteRun.hover();
await page.waitForTimeout(200);
check("and it turns red on hover, like the other deletes", (await deleteRun.evaluate((el) => getComputedStyle(el).color)) === "rgb(248, 113, 113)", await deleteRun.evaluate((el) => getComputedStyle(el).color));
check("with no border box around it", (await deleteRun.evaluate((el) => getComputedStyle(el).borderTopWidth)) === "0px", await deleteRun.evaluate((el) => getComputedStyle(el).borderTopWidth));
check("and no visible label competing with the session", !(await deleteRun.innerText()).includes("Delete"));

/* One more session, so the delete-then-undo round trip has something to act on
   and the persistence check still has a neighbour left behind. */
await page.getByRole("button", { name: /Log a sports session/ }).click();
await page.waitForTimeout(300);
await page.getByRole("dialog").locator("select").first().selectOption("Soccer");
await page.getByRole("dialog").locator("select").nth(1).selectOption("practice");
await page.getByLabel("Minutes").fill("75");
await page.getByRole("button", { name: "Intensity 3 of 5" }).click();
await page.getByRole("dialog").getByRole("button", { name: "Save", exact: true }).click();
await page.waitForTimeout(400);
check("a third session is logged", (await sessionsToday()).length === 3, JSON.stringify((await sessionsToday()).map((x) => x.sport)));

await deleteRun.click();
await page.waitForTimeout(300);
check("one tap is the whole delete", (await sessionsToday()).length === 2, JSON.stringify((await sessionsToday()).map((x) => x.sport)));
check("the other sessions are still listed", (await page.getByText(/Basketball game/).count()) === 1, String(await page.getByText(/Basketball game/).count()));
check("the deleted one is gone from the screen", (await page.getByText(/Running practice/).count()) === 0, String(await page.getByText(/Running practice/).count()));

/* ---- undo ----
   The delete is only safe to be this cheap because it can be taken back. The
   strip names what went, so Undo is never a guess about which row it refers to. */
const undoBtns = await page.getByRole("button", { name: "Undo", exact: true }).count();
check("an undo strip appears", undoBtns === 1, `${undoBtns} buttons, strip: ${(await page.locator("[role=status]").innerText().catch(() => "none"))}`);
check("it names what was deleted", (await page.getByText(/Running, 45m deleted/).count()) === 1, (await page.locator("[role=status]").innerText().catch(() => "no strip")));

await page.getByRole("button", { name: "Undo", exact: true }).click();
await page.waitForTimeout(400);
check("undo brings the session back", (await sessionsToday()).length === 3, JSON.stringify((await sessionsToday()).map((x) => x.sport)));
check("and it is on screen again", (await page.getByText(/Running practice/).count()) === 1, String(await page.getByText(/Running practice/).count()));
check("with its delete available again", (await deleteRun.count()) === 1);
check("the strip is gone once undone", (await page.getByRole("button", { name: "Undo", exact: true }).count()) === 0);

/* Deleting again and dismissing instead: the delete stands, and saying so is the
   point of a separate dismiss from an undo. */
await deleteRun.click();
await page.waitForTimeout(300);
check("deleted a second time", (await sessionsToday()).length === 2, JSON.stringify((await sessionsToday()).map((x) => x.sport)));
await page.getByRole("button", { name: "Dismiss undo" }).click();
await page.waitForTimeout(300);
check("dismissed, so the strip is closed", (await page.getByRole("button", { name: "Undo", exact: true }).count()) === 0);
check("and the delete still stands", (await sessionsToday()).length === 2, JSON.stringify((await sessionsToday()).map((x) => x.sport)));

/* The persistence check runs on a second page, not a reload: the seeding script
   above is an init script, so it re-runs on every single load of `page` and
   resets personaos:sports, which would wipe the very state under test. A new
   page in the same context shares the localStorage without carrying the script. */
const fresh = await ctx.newPage();
await fresh.goto(`${BASE}/vitals`, { waitUntil: "load" });
await fresh.waitForTimeout(1200);
check("the delete survived a reload", (await sessionsToday(fresh)).length === 2, JSON.stringify((await sessionsToday(fresh)).map((x) => x.sport)));
check("it is still gone from the screen", (await fresh.getByText(/Running practice/).count()) === 0, String(await fresh.getByText(/Running practice/).count()));
check("the other sessions are still listed", (await fresh.getByText(/Basketball game/).count()) === 1, String(await fresh.getByText(/Basketball game/).count()));

/* Home carries the same control, so a session can be dropped from either screen. */
await fresh.goto(`${BASE}/home`, { waitUntil: "load" });
await fresh.waitForTimeout(1500);
const homeDelete = fresh.getByRole("button", { name: /^Delete this session — Basketball, 40m$/ });
check("Home offers the same one-tap delete", (await homeDelete.count()) === 1, String(await homeDelete.count()));
check("with no selection step to get there", (await fresh.getByRole("button", { name: /Select to delete/ }).count()) === 0);
check("Home offers the same undo", (await fresh.getByRole("button", { name: "Undo", exact: true }).count()) === 0, "not yet deleted");
await homeDelete.click();
await fresh.waitForTimeout(300);
check("the delete works from Home", (await sessionsToday(fresh)).length === 1, JSON.stringify(await sessionsToday(fresh)));
check("with an undo strip", (await fresh.getByRole("button", { name: "Undo", exact: true }).count()) === 1);
await fresh.getByRole("button", { name: "Undo", exact: true }).click();
await fresh.waitForTimeout(300);
check("and Home's undo works too", (await sessionsToday(fresh)).length === 2, JSON.stringify(await sessionsToday(fresh)));
check("so the screen matches the log again", (await fresh.getByText(/Basketball · Game/).count()) === 1, String(await fresh.getByText(/Basketball · Game/).count()));

/* Clean out the rest so the prompt assertion below is not fighting live rows. */
while ((await sessionsToday(fresh)).length > 0) {
  const left = await sessionsToday(fresh);
  for (const s of left) {
    await fresh.getByRole("button", { name: new RegExp(`^Delete this session — ${s.sport},`) }).first().click();
    await fresh.waitForTimeout(300);
    const dismiss = fresh.getByRole("button", { name: "Dismiss undo" });
    if ((await dismiss.count()) === 1) await dismiss.click();
    await fresh.waitForTimeout(250);
  }
}
check("the log can be emptied again", (await sessionsToday(fresh)).length === 0, JSON.stringify(await sessionsToday(fresh)));
check("with nothing logged, the prompt asks again", (await fresh.locator("section", { has: fresh.getByText("Logged today", { exact: true }) }).getByText("Sports session?").count()) === 1, `dow ${dow}, expectRun ${expectRun}`);

/* ---- the week total ----
   Seeded relative to the machine's week, not to fixed dates, so this holds on
   any day of the week. Last week's sessions sit exactly seven days before this
   week's, which is the one arrangement where the matched-day slice always
   contains both of them — so the total and the delta are the same on a Monday
   as on a Sunday. */
const shiftDays = (iso, n) => {
  const [y, m, d] = iso.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`;
};
const mondayOf = (iso) => {
  const [y, m, d] = iso.split("-").map(Number);
  const back = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
  return shiftDays(iso, -back);
};
const weekStart = mondayOf(today);
const onMonday = weekStart === today;
const session = (id, date, minutes, source) => ({
  id,
  date,
  sport: "Soccer",
  kind: "practice",
  minutes,
  intensity: 3,
  source,
  ...(source === "device" ? { deviceId: `dev-${id}` } : {}),
});

const weekHistory = {
  sessions: [
    /* This week: 120 on the Monday, 45 today. */
    session("w1", weekStart, 120, "manual"),
    session("w2", today, 45, "device"),
    /* The same two days a week earlier, so both fall inside the slice. */
    session("p1", shiftDays(weekStart, -7), 60, "manual"),
    session("p2", shiftDays(today, -7), 90, "manual"),
  ],
    dismissed: [],
    /* The provider's own watch workout would otherwise sync in on top of this
       fixture and make the week a session heavier than the two it is about. The
       seeded `w2` is deliberately a device session and is not hidden — it is
       there to prove device sessions are counted too. */
    hiddenDevice: deviceWorkoutId ? [deviceWorkoutId] : [],
  };

await seed(page, NO_EVENTS, weekHistory);
await page.goto(`${BASE}/vitals`, { waitUntil: "load" });
await page.waitForTimeout(1200);

const weekPanel = page.locator("div.tile", { has: page.getByText("This week", { exact: true }) });
check("the week total is on the page", (await weekPanel.count()) === 1, String(await weekPanel.count()));
/* The label is uppercased by CSS, and innerText returns it transformed, so the
   assertions match on a lowercased copy. */
const weekText = (await weekPanel.innerText()).replace(/\s+/g, " ");
const week = weekText.toLowerCase();
check("it totals this week's minutes", /this week \d+ days? in 2h 45m/.test(week), weekText);
check("it counts the sessions", week.includes("2 sessions on "), weekText);
/* On a Monday the Monday and today are the same day, so it is one training day. */
check("training days are distinct days, not sessions", week.includes(onMonday ? "2 sessions on 1 day" : "2 sessions on 2 days"), weekText);
check("it compares against the matched days of last week", week.includes("15m more than the same days last week"), weekText);
/* Monday is day one, so the count is the ISO weekday index plus one. */
const elapsed = ((new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;
check("it says how many days the number covers", week.includes(`this week ${elapsed} ${elapsed === 1 ? "day" : "days"} in`), weekText);

  /* The panel must not claim a comparison it cannot make. */
  await seed(page, NO_EVENTS, {
    sessions: [],
    dismissed: [],
    hiddenDevice: deviceWorkoutId ? [deviceWorkoutId] : [],
  });
  await page.reload({ waitUntil: "load" });
await page.waitForTimeout(1200);
const emptyWeek = (await weekPanel.innerText()).replace(/\s+/g, " ").toLowerCase();
check("an empty week says so", emptyWeek.includes("nothing logged this week yet"), emptyWeek);
check("an empty first week makes no comparison", emptyWeek.includes("than the same days last week") === false, emptyWeek);

/* ---- the event form no longer carries the toggle ---- */
await seed(page, NO_EVENTS, { sessions: [], dismissed: [] });
await page.goto(`${BASE}/tasks`, { waitUntil: "load" });
await page.waitForTimeout(1200);
check(
  "no Sporting event toggle in the form",
  (await page.getByRole("button", { name: "Sporting event" }).count()) === 0,
);

/* ---- watch workouts: sports log themselves, training does not ----
   The provider builds today's workout from a fixed weekly programme:
   Sun/Wed are strength, Tue/Thu/Sat are runs, Mon/Fri are rest. So the
   expectation follows the weekday, and the invariants hold on all of them. */
await seed(page, NO_EVENTS, { sessions: [], dismissed: [] });
await page.goto(`${BASE}/vitals`, { waitUntil: "load" });
await page.waitForTimeout(1500);

const readDevice = () =>
  page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem("personaos:sports") ?? "{}");
    return (s.sessions ?? []).filter((x) => x.source === "device");
  });

const device = await readDevice();

check(
  "strength is never written as a sport session",
  device.every((s) => s.sport !== "Strength"),
  JSON.stringify(device.map((s) => s.sport)),
);
check(
  "a run day is logged without being asked",
  expectRun ? device.some((s) => s.sport === "Running") : device.length === 0,
  `dow ${dow}, got ${JSON.stringify(device.map((s) => s.sport))}`,
);
check(
  "device entries are practices carrying a provider id",
  device.every((s) => s.kind === "practice" && typeof s.deviceId === "string" && s.intensity >= 1 && s.intensity <= 5),
  JSON.stringify(device),
);

/* Three visits across two pages: the sync is idempotent, so the count holds. */
await page.reload({ waitUntil: "load" });
await page.waitForTimeout(1200);
await page.goto(`${BASE}/home`, { waitUntil: "load" });
await page.waitForTimeout(1500);
const afterRevisits = await readDevice();
check(
  "revisiting does not duplicate device entries",
  afterRevisits.length === device.length,
  `was ${device.length}, now ${afterRevisits.length}`,
);

/* A strength day must not answer the sports question. */
await seed(page, NO_EVENTS, { sessions: [], dismissed: [] });
await page.goto(`${BASE}/home`, { waitUntil: "load" });
await page.waitForTimeout(1500);
const askedHome = (await loggedPanel().getByText("Sports session?").count()) === 1;
check(
  "Home still asks on a day the watch only recorded training",
  expectRun ? !askedHome : askedHome,
  `dow ${dow}, prompt shown: ${askedHome}`,
);

check("no console errors", errors.length === 0, errors.join(" | ") || "none");

await b.close();
console.log(failures ? `\n${failures} FAILING` : "\nall passing");
process.exit(failures ? 1 : 0);
