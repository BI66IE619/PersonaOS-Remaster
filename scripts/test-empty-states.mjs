/* The empty states, asserted as behaviour rather than as copy.
 *
 * Three of these were changed to say what the panel is for and offer a way out,
 * and the failure being guarded is the quiet one: an empty state that renders
 * nothing, or renders a title with no way to leave, still passes a screenshot.
 * So this checks that each one explains itself, offers the action, and that the
 * action actually works — the last one being the only part a copy review can
 * catch and a click test cannot be written around. */

import { launchBrowser } from "./auth-state.mjs";

const BASE = process.env.SHOT_URL ?? "http://localhost:3000";
const b = await launchBrowser();
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, colorScheme: "dark" });
const page = await ctx.newPage();
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(String(e)));

let failures = 0;
const check = (name, cond, extra = "") => {
  const ok = Boolean(cond);
  if (!ok) failures++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${extra ? ` — ${extra}` : ""}`);
};

/* An empty habit, task and note, all at once, so Home, Tasks and Notes each have
   something with nothing in it. Seeded rather than deleted, because reaching
   "empty" by deleting things tests the delete button instead. `seeded: true`
   matters: it is what stops the app from filling the store with its own demo
   data on first read, which is how this first run found a populated list.
   Strength goes in too, because the habits panel counts the workout as one of
   its rows — an empty habit list next to an installed programme is not empty. */
await ctx.addInitScript(() => {
  localStorage.setItem("personaos:habits", JSON.stringify({ seeded: true, habits: [] }));
  localStorage.setItem("personaos:tasks", JSON.stringify({ seeded: true, tasks: [], events: [] }));
  localStorage.setItem("personaos:notes", JSON.stringify({ seeded: true, entries: [] }));
  localStorage.setItem("personaos:strength", JSON.stringify({ seeded: true, exercises: [], days: {} }));
});

/* Every empty state is marked with data-empty, so a panel that has quietly lost its
   explanation is visible as a missing block. The hook rather than a class, so
   restyling the empty state cannot quietly break this. */
const block = (text) => page.locator("[data-empty]").filter({ hasText: text });

/* ---- Home: the agenda and the habits ---- */
await page.goto(`${BASE}/home`, { waitUntil: "load" });
await page.waitForTimeout(1400);

check("the agenda says what it is for", (await block("Your day is clear.").count()) === 1, (await page.locator("section", { hasText: "Up next" }).innerText()).replace(/\n/g, " | "));
check("and where things will show up", (await page.getByText(/Anything you add with a date shows up here/).count()) === 1);
check("with a way out of it", (await block("Your day is clear.").getByRole("link", { name: /Add something to Plan/ }).count()) === 1);

check("the habits panel explains itself", (await block("Nothing to keep track of yet.").count()) === 1, (await page.locator("section", { hasText: "Habits" }).innerText()).replace(/\n/g, " | "));
check("and how a habit behaves once added", (await page.getByText(/it joins this list every day/).count()) === 1);
check("habits offers its own way out", (await block("Nothing to keep track of yet.").getByRole("link", { name: /Add a habit/ }).count()) === 1);

/* The two links go to different places, which is the part that a shared default
   would quietly break. */
const agendaHref = await block("Your day is clear.").getByRole("link", { name: /Add something to Plan/ }).getAttribute("href");
const habitHref = await block("Nothing to keep track of yet.").getByRole("link", { name: /Add a habit/ }).getAttribute("href");
check("the agenda's link goes to Tasks", agendaHref === "/tasks", String(agendaHref));
check("and the habits link goes to Tasks too", habitHref === "/tasks", String(habitHref));

/* Following one for real, because a link to nowhere is still a link. */
await block("Your day is clear.").getByRole("link", { name: /Add something to Plan/ }).click();
await page.waitForURL("**/tasks", { timeout: 15000 }).catch(() => {});
check("the link actually navigates", new URL(page.url()).pathname === "/tasks", new URL(page.url()).pathname);

/* ---- Tasks ---- */
await page.waitForTimeout(900);
/* With no tasks or events, Tasks has two empty panels of its own, plus one for
   the habits it owns — the calendar day, the task list and the habit list. */
check("Tasks says what it is for", (await block("No tasks yet.").count()) === 1, (await page.locator("main").innerText()).replace(/\n/g, " | "));
check("and does not imply a due date is required", (await page.getByText(/A due date is optional/).count()) === 1);
/* No action here on purpose: there is nothing to add from inside a list. What
   matters is that it does not offer a way to add one from nowhere. */
check("with no fake action offered", (await block("No tasks yet.").getByRole("link").count()) === 0 && (await block("No tasks yet.").getByRole("button").count()) === 0);

check("the selected day's calendar explains itself", (await block("Nothing on this day.").count()) === 1, (await page.locator("section", { has: page.getByText("TODAY") }).first().innerText()).replace(/\n/g, " | "));
check("and says the day does not have to be today", (await page.getByText(/It does not have to be today/).count()) === 1);
check("the habit list explains itself", (await block("Nothing tracked.").count()) === 1, (await page.locator("section", { hasText: /^Habits/ }).innerText()).replace(/\n/g, " | "));

/* Both of these are cases where the way out is the field right underneath, so
   the action has to point at that field rather than link back to the screen you
   are already on — the two failure modes, and the one that is easy to ship. */
const dayFocus = block("Nothing on this day.").getByRole("button", { name: "Add the first one" });
const habitFocus = block("Nothing tracked.").getByRole("button", { name: "Name the first one" });
check("the calendar's action is a button, not a link to itself", (await dayFocus.count()) === 1 && (await block("Nothing on this day.").getByRole("link").count()) === 0);
check("and it puts the cursor in the field that fills it", await dayFocus.evaluate((b) => { b.click(); return true; }) && (await page.getByLabel("Event title").evaluate((el) => el === document.activeElement)));
check("the habit list's action too", (await habitFocus.count()) === 1 && (await block("Nothing tracked.").getByRole("link").count()) === 0);
check("and it focuses the habit field", await habitFocus.evaluate((b) => { b.click(); return true; }) && (await page.getByLabel("New habit name").evaluate((el) => el === document.activeElement)));

/* ---- Notes ---- */
await page.getByRole("link", { name: "Notes", exact: true }).first().click();
await page.waitForTimeout(1400);
check("Notes says what it is for", (await block("No notes yet.").count()) === 1, (await page.locator("main").innerText()).replace(/\n/g, " | "));
check("and that it saves itself", (await page.getByText(/Write one a day and it saves itself/).count()) === 1);

/* ---- a search that finds nothing ----
   This is the one with a button rather than a link: the way out is right here,
   and a link to an anchor would only scroll the page without clearing anything. */
await ctx.addInitScript(() => {
  localStorage.setItem(
    "personaos:notes",
    JSON.stringify({
      seeded: true,
      entries: [{ date: "2026-01-01", note: "Sourdough: starter, flour, water, salt.", tags: ["kitchen"] }],
    }),
  );
});
await page.goto(`${BASE}/notes`, { waitUntil: "load" });
await page.waitForTimeout(1400);
check("the note is there to be searched", (await page.getByText(/Sourdough/).count()) === 1, String(await page.getByText(/Sourdough/).count()));
await page.getByPlaceholder("Search notes").fill("zzzqqq");
await page.waitForTimeout(400);
check("a failed search names the word that failed", (await block("Nothing matches that.").count()) === 1, (await page.locator("main").innerText()).replace(/\n/g, " | "));
check("quoting it, so it is clear which search", (await page.getByText(/No entry contains "zzzqqq"/).count()) === 1);
const clearBtn = block("Nothing matches that.").getByRole("button", { name: "Clear the search" });
check("and offers to clear it", (await clearBtn.count()) === 1);
check("as a button, not a link to nowhere", (await block("Nothing matches that.").getByRole("link").count()) === 0);

await clearBtn.click();
await page.waitForTimeout(500);
check("clicking it clears the search", (await page.getByPlaceholder("Search notes").inputValue()) === "", await page.getByPlaceholder("Search notes").inputValue());
check("and the note is back", (await page.getByText(/Sourdough/).count()) === 1, String(await page.getByText(/Sourdough/).count()));
check("with the empty state gone", (await block("Nothing matches that.").count()) === 0);

/* ---- a habit that exists, to prove the empty state is not simply always on ----
   A new context rather than a reload: the seeding init script above runs on
   every single load and would put the empty list straight back, which is the
   same trap test-sports documents. */
await ctx.close();
const filled = await b.newContext({ viewport: { width: 390, height: 844 }, colorScheme: "dark" });
await filled.addInitScript(() => {
  localStorage.setItem("personaos:tasks", JSON.stringify({ seeded: true, tasks: [], events: [] }));
  localStorage.setItem("personaos:strength", JSON.stringify({ seeded: true, exercises: [], days: {} }));
  localStorage.setItem(
    "personaos:habits",
    JSON.stringify({
      seeded: true,
      habits: [{ id: "h1", name: "Read", createdAt: "2026-01-01T00:00:00.000Z", days: [] }],
    }),
  );
});
const fp = await filled.newPage();
fp.on("pageerror", (e) => errors.push(String(e)));
fp.on("console", (m) => m.type() === "error" && errors.push(m.text()));
await fp.goto(`${BASE}/home`, { waitUntil: "load" });
await fp.waitForTimeout(1400);
check("with a habit logged, the habits empty state is gone", (await fp.locator("[data-empty]").filter({ hasText: "Nothing to keep track of yet." }).count()) === 0);
check("and the habit is listed", (await fp.getByText(/Read/).count()) > 0, String(await fp.getByText(/Read/).count()));
check("and the panel counts it", (await fp.getByText("0/1").count()) === 1, (await fp.locator("section", { hasText: "Habits today" }).innerText()).replace(/\n/g, " | "));

check("console errors", errors.length === 0, errors.join(" / "));
console.log(failures ? `\n${failures} FAILING` : "\nall passing");
await b.close();
process.exit(failures ? 1 : 0);
