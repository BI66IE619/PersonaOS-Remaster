import { launchBrowser } from "./auth-state.mjs";
import {
  addDays,
  daysBetween,
  monthDays,
  monthMatrix,
  timeLabel,
  weekStart,
} from "../src/lib/dates.ts";

const BASE = process.env.SHOT_URL ?? "http://localhost:3000";
const log = (n, v) => console.log(`${n}. ${v}`);
let failures = 0;
const check = (n, cond, detail = "") => {
  if (!cond) failures++;
  log(n, `${cond ? "PASS" : "FAIL"}${detail ? ` — ${detail}` : ""}`);
};

/* ---- date maths, no browser needed ---- */
check("weekStart is Monday", weekStart("2026-09-25") === "2026-09-21", weekStart("2026-09-25"));
check("weekStart of a Monday is itself", weekStart("2026-09-21") === "2026-09-21");
check("weekStart of a Sunday rolls back", weekStart("2026-09-27") === "2026-09-21");
check("monthDays length", monthDays("2026-09").length === 30, String(monthDays("2026-09").length));
check("monthDays February 2028 leap", monthDays("2028-02").length === 29);
check("monthDays February 2026", monthDays("2026-02").length === 28);
check("daysBetween across a month end", daysBetween("2026-01-30", "2026-02-02") === 3);
check("addDays across a year end", addDays("2026-12-31", 1) === "2027-01-01");
check("addDays backwards", addDays("2026-03-01", -1) === "2026-02-28");

for (const m of ["2026-01", "2026-02", "2026-09", "2026-12", "2028-02"]) {
  const rows = monthMatrix(m);
  const flat = rows.flat();
  const weeksOk = rows.every((r) => r.length === 7);
  const six = rows.length === 6;
  const covers = flat.includes(`${m}-01`) && flat.includes(monthDays(m).at(-1));
  const monotonic = flat.every((d, i) => i === 0 || daysBetween(flat[i - 1], d) === 1);
  const monday = rows.every((r) => new Date(`${r[0]}T00:00:00Z`).getUTCDay() === 1);
  check(
    `monthMatrix ${m}`,
    weeksOk && six && covers && monotonic && monday,
    `${rows.length} rows, monday-first ${monday}, spans ${flat[0]}..${flat.at(-1)}`,
  );
}

check("timeLabel 570", timeLabel(570) === "9:30 AM", timeLabel(570));
check("timeLabel 0", timeLabel(0) === "12:00 AM", timeLabel(0));
check("timeLabel 750", timeLabel(750) === "12:30 PM", timeLabel(750));

/* ---- browser ---- */
const b = await launchBrowser();
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" });
const page = await ctx.newPage();
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(String(e)));

await page.goto(BASE + "/tasks", { waitUntil: "load" });
await page.waitForTimeout(1200);

check("nav has Plan", (await page.getByRole("link", { name: "Plan", exact: true }).count()) === 1);
/* The tab is called Plan because the screen holds events, tasks and habits, but
   the page heading and the nav must not drift into calling it two things. */
check("the page is headed Plan", (await page.getByRole("heading", { name: "Plan", exact: true }).count()) === 1);
check(
  "Plan marked current",
  (await page.getByRole("link", { name: "Plan", exact: true }).getAttribute("aria-current")) === "page",
);
check("seeded tasks rendered", (await page.getByText("Return library books").count()) > 0);

/* Events are titled only in the agenda for the selected day; the grid marks
   them with dots. Read the seeded date out of storage and open that day. */
const dentistDate = await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem("personaos:tasks") ?? "{}");
  return s.events?.find((e) => e.title === "Dentist" && e.date > new Date().toISOString().slice(0, 10))?.date;
});
check("seeded event has a future date", typeof dentistDate === "string", String(dentistDate));
check(
  "grid marks event days",
  (await page.locator('main button[aria-label*="event"]').count()) > 0,
);

/* Events are stored per day, and the agenda only shows the selected day, so
   every event assertion has to name the day it is looking at. */
const openToday = async () => {
  await page.getByRole("button", { name: /^today,/ }).click();
  await page.waitForTimeout(300);
};
await openToday();

/* The calendar, task list, and habits panel each have an "Add" button, so
   every click has to be scoped to its own panel. */
const calendarPanel = page.locator("section", { has: page.getByLabel("Event title") });
const taskPanel = page.locator("section", { has: page.getByLabel("Task title") });

// add an event
await page.getByLabel("Event title").fill("Team standup");
await page.getByLabel("Event time").fill("11:00");
await calendarPanel.getByRole("button", { name: "Add", exact: true }).click();
await page.waitForTimeout(400);
check("event added", (await page.getByText("Team standup").count()) > 0);
check("time rendered", (await page.getByText("11:00 AM – 12:00 PM").count()) > 0);

// add a task
await page.getByLabel("Task title").fill("Buy cat food");
await taskPanel.getByRole("button", { name: "Add", exact: true }).click();
await page.waitForTimeout(400);
check("task added", (await page.getByText("Buy cat food").count()) > 0);

/* Marking a task done moves it into the collapsed Done section, so the checkbox
   leaves the DOM by design. Click it, then assert on the result. */
await page.getByLabel('Mark "Buy cat food" done').click();
await page.waitForTimeout(400);
check("task toggled done", (await page.getByText(/Show done \(\d+\)/).count()) > 0);
check("done task left the open list", (await page.getByText("Buy cat food").count()) === 0);

// persistence
await page.reload({ waitUntil: "load" });
await page.waitForTimeout(1200);
check("event persisted to today", (await page.getByText("Team standup").count()) > 0);
await page.getByText(/Show done \(\d+\)/).click();
await page.waitForTimeout(300);
check("task persisted", (await page.getByText("Buy cat food").count()) > 0);
check("sample not re-seeded", (await page.getByText("Return library books").count()) === 1);
check(
  "no duplicate seeding",
  (await page.getByText("Call Dad").count()) === 0,
  "a second run must not add the sample again",
);

// month navigation
const label = () => page.locator("main span.num").first().innerText();
const before = await label();
await page.getByLabel("Next month").click();
await page.waitForTimeout(300);
const after = await label();
check("month advances", before !== after, `${before} -> ${after}`);
/* exact: the day chips in the calendar are labelled "today, 1 event: …", and
   getByRole matches name by substring, so a bare "Today" also matches today's
   chip and the click hits two elements. */
await page.getByRole("button", { name: "Today", exact: true }).click();
await page.waitForTimeout(300);
check("Today returns", (await label()) === before, await label());

// day selection drives the agenda
await page.getByLabel(/, 0 events$/).first().click();
await page.waitForTimeout(300);
/* The Plan screen's own empty day, not Home's: they are separate panels with
   separate wording, and this check used to pass against the old bare "Nothing
   planned." because both screens happened to say the same thing. */
check("agenda switched day", (await page.getByText("Nothing on this day.").count()) > 0);
check("and Home's wording has not leaked in here", (await page.getByText("Your day is clear.").count()) === 0);

// delete, back on today where the event lives
await openToday();
await page.getByRole("button", { name: /Delete "Team standup"/ }).click();
await page.waitForTimeout(300);
check("event deleted", (await page.getByText("Team standup").count()) === 0);

// responsive
for (const w of [390, 1440]) {
  await page.setViewportSize({ width: w, height: 900 });
  await page.goto(BASE + "/tasks", { waitUntil: "load" });
  await page.waitForTimeout(600);
  const o = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  check(`no overflow at ${w}px`, !o);
}

// other routes still fine
for (const path of ["/", "/vitals", "/body", "/money"]) {
  await page.goto(BASE + path, { waitUntil: "load" });
  await page.waitForTimeout(500);
  const o = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  check(`${path} no overflow`, !o);
}

check("console errors", errors.length === 0, errors.join(" / "));
await b.close();
console.log(failures ? `\n${failures} FAILING` : "\nall passing");
process.exit(failures ? 1 : 0);
