import { launchBrowser } from "./auth-state.mjs";
import { addDays } from "../src/lib/dates.ts";
import { bestStreak, currentStreak } from "../src/lib/streaks.ts";

const BASE = process.env.SHOT_URL ?? "http://localhost:3000";
let failures = 0;
const log = (n, v) => console.log(`${n}. ${v}`);
const check = (n, cond, detail = "") => {
  if (!cond) failures++;
  log(n, `${cond ? "PASS" : "FAIL"}${detail ? ` — ${detail}` : ""}`);
};

const T = "2026-09-25";
const days = (...n) => n.map((i) => addDays(T, i));

/* ---- currentStreak ---- */
check("empty history is 0", currentStreak([], T) === 0);
check("today only", currentStreak(days(0), T) === 1);
check("run of 3 ending today", currentStreak(days(0, -1, -2), T) === 3);
check(
  "gap breaks the run",
  currentStreak(days(0, -1, -2, -4, -5), T) === 3,
  `got ${currentStreak(days(0, -1, -2, -4, -5), T)}`,
);
check("unsorted input", currentStreak(days(-2, 0, -1), T) === 3);
check("duplicates collapse", currentStreak(days(0, 0, -1), T) === 2);
check(
  "streak alive from yesterday",
  currentStreak(days(-1, -2, -3), T) === 3,
  `got ${currentStreak(days(-1, -2, -3), T)}`,
);
check(
  "broken when neither today nor yesterday",
  currentStreak(days(-2, -3, -4), T) === 0,
  `got ${currentStreak(days(-2, -3, -4), T)}`,
);
check("future days ignored", currentStreak(days(0, 1, 2, 3), T) === 1);
check(
  "spans a month boundary",
  currentStreak(["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02"], "2026-10-02") === 5,
);
check(
  "spans a leap day",
  currentStreak(["2028-02-28", "2028-02-29", "2028-03-01"], "2028-03-01") === 3,
);

/* ---- bestStreak ---- */
check("best of empty", bestStreak([]) === 0);
check("best single", bestStreak(days(0)) === 1);
check("best keeps history", bestStreak(days(-20, -21, -22, -23, -24, 0, -1)) === 5, `got ${bestStreak(days(-20, -21, -22, -23, -24, 0, -1))}`);
check("best ignores a live streak", bestStreak(days(-10, -11, -12, -13, -14, 0)) === 5);
check("best of one", bestStreak(days(-5)) === 1);
check("best counts duplicates once", bestStreak(days(0, 0, 0, -1)) === 2);
check(
  "best with a gap",
  bestStreak(days(0, -1, -5, -6, -7, -8, -9, -10)) === 6,
  `got ${bestStreak(days(0, -1, -5, -6, -7, -8, -9, -10))}`,
);

/* ---- browser ---- */
const b = await launchBrowser();
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" });
const page = await ctx.newPage();
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(String(e)));

await page.goto(BASE + "/tasks", { waitUntil: "load" });
await page.waitForTimeout(1200);

const panel = page.locator("section", { has: page.getByText("Habits", { exact: true }) });
check("habits panel present", (await panel.count()) === 1);
check("seeded habits rendered", (await page.getByText("Read", { exact: true }).count()) > 0);
check(
  "four habits seeded",
  (await panel.getByRole("checkbox").count()) === 4,
  `${await panel.getByRole("checkbox").count()} circles`,
);

const read = panel.locator("li", { hasText: "Read" });
check("Read is done today", (await read.getByRole("checkbox").getAttribute("aria-checked")) === "true");
check("Read streak label", (await read.getByText(/day streak|days$|\d+ days?$/).count()) > 0);

const stretch = panel.locator("li", { hasText: "Stretch" });
check(
  "Stretch not done today",
  (await stretch.getByRole("checkbox").getAttribute("aria-checked")) === "false",
);
const walk = panel.locator("li", { hasText: "Morning walk" });
check(
  "Morning walk has no streak",
  (await walk.getByText("no streak yet").count()) > 0,
);

/* A habit history is in the past. Seeding a future day would silently break
   every streak, because the run is only ever walked backwards from today. */
const future = await page.evaluate(() => {
  /* The app's "today" is the server's local date, not UTC. */
  const d = new Date();
  const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const raw = JSON.parse(localStorage.getItem("personaos:habits") ?? "{}");
  return (raw.habits ?? []).flatMap((h) => h.days.filter((x) => x > today));
});
check("no habit day is in the future", future.length === 0, future.join(",") || "none");
check(
  "patchy habit is 4 days",
  (await panel.locator("li", { hasText: "Practice piano" }).getByText("4 days").count()) > 0,
);

/* add */
await page.getByLabel("New habit name").fill("Drink water");
await panel.getByRole("button", { name: "Add", exact: true }).click();
await page.waitForTimeout(400);
check("habit added", (await page.getByText("Drink water", { exact: true }).count()) > 0);
check("new habit starts at zero", (await page.getByText("no streak yet").count()) > 0);

/* toggle today twice = back to where it started */
const water = panel.locator("li", { hasText: "Drink water" }).getByRole("checkbox");
await water.click();
await page.waitForTimeout(300);
check("toggle marks today", (await water.getAttribute("aria-checked")) === "true");
check("streak becomes 1", (await panel.locator("li", { hasText: "Drink water" }).getByText("1 day").count()) > 0);
await water.click();
await page.waitForTimeout(300);
check("toggle is reversible", (await water.getAttribute("aria-checked")) === "false");

/* persistence */
await page.reload({ waitUntil: "load" });
await page.waitForTimeout(1200);
check("habits persisted", (await page.getByText("Drink water", { exact: true }).count()) > 0);
check("no re-seed after reload", (await page.getByText("Read", { exact: true }).count()) === 1);

/* ---- delete is behind a confirmation ----

   The habit carries its own days array and both the streak and the best are
   derived from it, so deleting the habit is unrecoverable. There used to be a
   "Clear habits" button here that wiped every habit and every streak in one
   press with no confirmation at all. These cover both halves of the
   replacement: the button is gone, and the per-habit cross asks first. */
const row = (name) => panel.locator("li", { hasText: name });
const cross = (name) => row(name).getByRole("button", { name: /Delete habit/ });
const dialog = page.getByRole("dialog");

check("no clear-everything button is left", (await page.getByText("Clear habits").count()) === 0);

await cross("Drink water").click();
await page.waitForTimeout(300);
check("the cross alone deletes nothing", (await row("Drink water").count()) === 1);
check("a confirmation asks first", (await dialog.count()) === 1);
check("it names the habit", (await dialog.getByText("Drink water").count()) > 0);
check("it says the cost in numbers, not just a warning", (await dialog.getByText(/tracked day|There is no undo/).count()) > 0);
check("it offers a way out", (await dialog.getByRole("button", { name: "Keep it" }).count()) === 1);
check(
  "focus starts on the safe choice, so a stray Enter keeps the habit",
  await dialog.getByRole("button", { name: "Keep it" }).evaluate((el) => el === document.activeElement),
);

await dialog.getByRole("button", { name: "Keep it" }).click();
await page.waitForTimeout(300);
check("keeping it deletes nothing", (await row("Drink water").count()) === 1);
check("and closes the dialog", (await dialog.count()) === 0);

/* Escape has to back out too, since it is the reflex when a dialog appears that
   you did not mean to open. */
await cross("Drink water").click();
await page.waitForTimeout(250);
await page.keyboard.press("Escape");
await page.waitForTimeout(250);
check("escape backs out", (await dialog.count()) === 0 && (await row("Drink water").count()) === 1);

await cross("Drink water").click();
await page.waitForTimeout(250);
await dialog.getByRole("button", { name: "Delete habit" }).click();
await page.waitForTimeout(400);
check("habit deleted once confirmed", (await row("Drink water").count()) === 0);
check("and only that one", (await row("Read").count()) === 1);
check("the dialog is gone", (await dialog.count()) === 0);

/* the accent must actually paint, not fall back to nothing */
const fill = await panel
  .locator('li:has-text("Read") button[role="checkbox"]')
  .evaluate((el) => getComputedStyle(el).backgroundColor);
check("done circle is filled", fill === "rgb(255, 255, 255)", fill);

const dot = await panel
  .locator('li:has-text("Read") div[aria-hidden] span')
  .first()
  .evaluate((el) => getComputedStyle(el).backgroundColor);
check("history dots paint", dot !== "rgba(0, 0, 0, 0)", dot);

/* ---- Home's habits panel: ordering, and the workout row worked out from the log ---- */
await page.setViewportSize({ width: 1440, height: 900 });
await page.evaluate(() => localStorage.clear());
await page.goto(BASE + "/home", { waitUntil: "load" });
await page.waitForTimeout(1800);

const home = page.locator("section", { has: page.getByText("Habits today", { exact: true }) });
check("Habits today panel on Home", (await home.count()) === 1);

/* Row order is read from the list container's direct children, so the panel
   header is not mistaken for a row. */
const list = home.locator("div.flex.flex-1");
const rowOrder = () =>
  list
    .locator(":scope > a, :scope > div")
    .evaluateAll((els) => els.map((e) => (e.textContent || "").replace(/\s+/g, " ").trim()));

const workout = home.locator("a", { hasText: "Workout" });
check("workout row is present", (await workout.count()) === 1);
check(
  "workout row is read-only, not a tick box",
  (await workout.getByRole("checkbox").count()) === 0 && (await workout.getAttribute("href")) === "/body",
);
check("workout row links to the log", (await workout.getAttribute("href")) === "/body");
check(
  "workout is not in the habits store",
  await page.evaluate(() => !JSON.parse(localStorage.getItem("personaos:habits") ?? "{}").habits
    ?.some((h) => h.name.toLowerCase().includes("workout"))),
);

/* Unfinished first, done last. The seed leaves Read and Practice piano done and
   Stretch and Morning walk open, so a correct panel reads open, open, done, done
   rather than in the order the habits were created. */
const order0 = await rowOrder();
const openNames = ["Stretch", "Morning walk"];
const doneNames = ["Read", "Practice piano"];
check("the workout row leads", order0[0].startsWith("Workout"), order0.join(" | "));
const afterWorkout = order0.slice(1);
check("the two open habits come next", afterWorkout.slice(0, 2).every((r, i) => r.startsWith(openNames[i])),
  afterWorkout.join(" | "));
check("the two finished habits trail", afterWorkout.slice(2).every((r, i) => r.startsWith(doneNames[i])),
  afterWorkout.join(" | "));

/* The workout is a habit like any other, so it counts toward the same total. */
const homeCount = await home.locator(".num").first().innerText();
check("workout is counted in the panel total", homeCount.trim() === "2/5", homeCount.trim());

/* Ticking a habit moves it to the bottom rather than leaving it where it was. */
await home.locator('[aria-label="Mark Stretch done for today"]').click();
await page.waitForTimeout(400);
const order1 = (await rowOrder()).slice(1);
check("a ticked habit drops below the open ones", order1[0].startsWith("Morning walk"), order1.join(" | "));
check("a ticked habit goes to the bottom", order1[order1.length - 1].startsWith("Stretch"), order1.join(" | "));
check("the count follows the tick", (await home.locator(".num").first().innerText()).trim() === "3/5");

/* Un-ticking puts it back at the top of the open group. */
await home.locator('[aria-label="Mark Stretch done for today"]').click();
await page.waitForTimeout(400);
const order2 = (await rowOrder()).slice(1);
check("un-ticking restores its place", order2[0].startsWith("Stretch"), order2.join(" | "));

/* ---- the workout row is derived from the sets actually logged ---- */
const dayKey = (o = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + o);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const TODAY = dayKey();
const mkSets = (n, reps) => Array.from({ length: n }, () => ({ reps, weightLb: null }));
const logSets = (byExercise) =>
  page.evaluate(([d, ex]) => {
    const s = JSON.parse(localStorage.getItem("personaos:strength") ?? "{}");
    s.seeded = true;
    s.days = { ...(s.days ?? {}), [d]: ex };
    localStorage.setItem("personaos:strength", JSON.stringify(s));
  }, [TODAY, byExercise]);
const BENCH = "bench-press";
const CURLS = "bicep-curls";
const EXT = "overhead-db-tricep-extension";

check("workout starts incomplete", (await workout.innerText()).includes("0 of 3 movements"),
  (await workout.innerText()).replace(/\s+/g, " "));

await logSets({ [BENCH]: mkSets(4, 12), [CURLS]: mkSets(4, 16) });
await page.reload({ waitUntil: "load" });
await page.waitForTimeout(1500);
check("two movements is not a finished workout", (await workout.innerText()).includes("2 of 3 movements"),
  (await workout.innerText()).replace(/\s+/g, " "));

/* One short of the target on the third movement must not complete it. */
await logSets({ [BENCH]: mkSets(4, 12), [CURLS]: mkSets(4, 16), [EXT]: mkSets(3, 22) });
await page.reload({ waitUntil: "load" });
await page.waitForTimeout(1500);
check("a short set count does not complete it", (await workout.innerText()).includes("2 of 3 movements"),
  (await workout.innerText()).replace(/\s+/g, " "));

await logSets({ [BENCH]: mkSets(4, 12), [CURLS]: mkSets(4, 16), [EXT]: mkSets(4, 22) });
await page.reload({ waitUntil: "load" });
await page.waitForTimeout(1500);
check("4 sets on all three completes the workout",
  !(await workout.innerText()).includes("movements"),
  (await workout.innerText()).replace(/\s+/g, " "));
check("the completed workout counts in the total",
  (await home.locator(".num").first().innerText()).trim() === "3/5",
  (await home.locator(".num").first().innerText()).trim());

/* More than the target still counts. */
await logSets({ [BENCH]: mkSets(5, 12), [CURLS]: mkSets(6, 16), [EXT]: mkSets(4, 22) });
await page.reload({ waitUntil: "load" });
await page.waitForTimeout(1500);
check("going past the target still counts",
  !(await workout.innerText()).includes("movements"),
  (await workout.innerText()).replace(/\s+/g, " "));

/* The whole point of deriving it: removing a set un-completes the workout on its
   own, because there is no separate "I did it" flag to fall out of step. */
await logSets({ [BENCH]: mkSets(2, 12), [CURLS]: mkSets(4, 16), [EXT]: mkSets(4, 22) });
await page.reload({ waitUntil: "load" });
await page.waitForTimeout(1500);
check("deleting a set un-ticks the workout", (await workout.innerText()).includes("2 of 3 movements"),
  (await workout.innerText()).replace(/\s+/g, " "));

/* A movement you added yourself has no target, so it cannot hold the workout up. */
await logSets({
  [BENCH]: mkSets(4, 12),
  [CURLS]: mkSets(4, 16),
  [EXT]: mkSets(4, 22),
  "face-pulls": mkSets(1, 15),
});
await page.reload({ waitUntil: "load" });
await page.waitForTimeout(1500);
check("a movement with no target is not counted",
  !(await workout.innerText()).includes("movements"),
  (await workout.innerText()).replace(/\s+/g, " "));

/* responsive */
for (const [w, h, label] of [
  [390, 844, "390px"],
  [1440, 900, "1440px"],
]) {
  await page.setViewportSize({ width: w, height: h });
  await page.waitForTimeout(300);
  const o = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  check(`no overflow at ${label}`, !o);
}

check("console errors", errors.length === 0, errors.join(" | ") || "none");

await b.close();
console.log(failures ? `\n${failures} FAILING` : "\nall passing");
process.exit(failures ? 1 : 0);
