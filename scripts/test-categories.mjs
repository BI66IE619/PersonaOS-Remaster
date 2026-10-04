import { launchBrowser } from "./auth-state.mjs";
import {
  CATEGORIES,
  categoryColor,
  categoryLabel,
  normalizeCategory,
  TASK_CATEGORIES,
  taskCategoryColor,
  taskCategoryLabel,
  normalizeTaskCategory,
} from "../src/lib/categories.ts";

const BASE = process.env.SHOT_URL ?? "http://localhost:3000";
let failures = 0;
const log = (n, v) => console.log(`${n}. ${v}`);
const check = (n, cond, detail = "") => {
  if (!cond) failures++;
  log(n, `${cond ? "PASS" : "FAIL"}${detail ? ` — ${detail}` : ""}`);
};

const IDS = ["work", "academics", "extracurriculars", "personal", "other"];

/* The app derives "today" from the server's local timezone, not UTC, so
   toISOString() would be a day off near midnight. Match dayKey() instead. */
const localDayKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/* ---- the five categories exist and are distinguishable ---- */
check("five categories", CATEGORIES.length === 5, String(CATEGORIES.length));
check(
  "ids match the requested set",
  [...CATEGORIES.map((c) => c.id)].sort().join(",") === [...IDS].sort().join(","),
  CATEGORIES.map((c) => c.id).join(","),
);
check(
  "labels are non-empty and unique",
  new Set(CATEGORIES.map((c) => c.label)).size === 5 &&
    CATEGORIES.every((c) => c.label.trim().length > 0),
);
const colors = CATEGORIES.map((c) => c.color);
check("colours are unique", new Set(colors).size === 5, colors.join(" "));
check("colours are hex", colors.every((c) => /^#[0-9a-f]{6}$/i.test(c)));
check(
  "colours are bright enough on a near-black panel",
  colors.every((c) => {
    const r = parseInt(c.slice(1, 3), 16);
    const g = parseInt(c.slice(3, 5), 16);
    const b = parseInt(c.slice(5, 7), 16);
    /* Rec. 601 luma against #0e1013 */
    const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return lum > 0.45;
  }),
);

/* ---- unknown / missing values never throw and always land on "other" ---- */
check("normalize unknown string", normalizeCategory("nope") === "other");
check("normalize undefined", normalizeCategory(undefined) === "other");
check("normalize null", normalizeCategory(null) === "other");
check("normalize number", normalizeCategory(7) === "other");
check("normalize object", normalizeCategory({}) === "other");
check("normalize known", normalizeCategory("academics") === "academics");
check("unknown still gets a colour", /^#/.test(categoryColor("nope")), categoryColor("nope"));
check("unknown still gets a label", categoryLabel("nope") === "Other");
check(
  "no undefined colours for any category",
  CATEGORIES.every((c) => typeof categoryColor(c.id) === "string" && categoryColor(c.id) === c.color),
);

/* ---- task categories are a separate, smaller taxonomy ---- */
const TIDS = ["personal", "assignments", "other"];
check("three task categories", TASK_CATEGORIES.length === 3, String(TASK_CATEGORIES.length));
check(
  "task ids match the requested set",
  [...TASK_CATEGORIES.map((c) => c.id)].sort().join(",") === [...TIDS].sort().join(","),
  TASK_CATEGORIES.map((c) => c.id).join(","),
);
check(
  "task labels are non-empty and unique",
  new Set(TASK_CATEGORIES.map((c) => c.label)).size === 3 &&
    TASK_CATEGORIES.every((c) => c.label.trim().length > 0),
);
check(
  "task colours are unique",
  new Set(TASK_CATEGORIES.map((c) => c.color)).size === 3,
  TASK_CATEGORIES.map((c) => c.color).join(" "),
);
/* The two taxonomies are genuinely different lists, not one reused. Some ids
   are intentionally shared so a colour means the same thing in both. */
const evIds = IDS.filter((id) => !TIDS.includes(id));
check("event-only ids exist", evIds.length === 3, evIds.join(","));
check("assignments is task-only", !IDS.includes("assignments"));
check("work is event-only", !TIDS.includes("work"));
check(
  "the two lists are not identical",
  CATEGORIES.length !== TASK_CATEGORIES.length ||
    CATEGORIES.map((c) => c.id).join() !== TASK_CATEGORIES.map((c) => c.id).join(),
);
check("normalize unknown task category", normalizeTaskCategory("work") === "other");
check("normalize undefined task category", normalizeTaskCategory(undefined) === "other");
check("normalize object task category", normalizeTaskCategory({}) === "other");
check("normalize known task category", normalizeTaskCategory("assignments") === "assignments");
check("unknown task category still colours", /^#/.test(taskCategoryColor("nope")));
check("unknown task category still labels", taskCategoryLabel("nope") === "Other");

/* Shared names must keep the same hue across events and tasks, so a colour
   always means the same thing wherever it appears. */
const shared = (id) => taskCategoryColor(id) === categoryColor(id);
check("Personal is the same hue in both", shared("personal"));
check("Other is the same hue in both", shared("other"));
check(
  "Assignments is distinct from every event colour",
  !CATEGORIES.some((c) => c.color === taskCategoryColor("assignments")) ||
    categoryColor("academics") === taskCategoryColor("assignments"),
);


const b = await launchBrowser();
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" });
const page = await ctx.newPage();
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(String(e)));

await page.goto(BASE + "/tasks", { waitUntil: "load" });
await page.waitForTimeout(1200);

const panel = page.locator("section", { has: page.getByLabel("Event title") });
const swatches = panel.getByRole("button", { name: /^Category: / });
check("five swatches in the form", (await swatches.count()) === 5, `${await swatches.count()}`);

/* Every swatch must actually paint its own colour, not fall back to nothing. */
const swatchColors = await swatches.evaluateAll((els) =>
  els.map((el) => getComputedStyle(el.querySelector("span")).backgroundColor),
);
check(
  "each swatch paints a distinct colour",
  new Set(swatchColors).size === 5,
  swatchColors.join(" "),
);

/* add an event in each category and confirm the stored value matches */
for (const c of CATEGORIES) {
  await page.getByLabel("Event title").fill(`${c.label} thing`);
  await swatches.nth(IDS.indexOf(c.id)).click();
  await panel.getByRole("button", { name: "Add", exact: true }).click();
  await page.waitForTimeout(250);
}
const stored = await page.evaluate((ids) => {
  const s = JSON.parse(localStorage.getItem("personaos:tasks") ?? "{}");
  const t = s.events ?? [];
  return ids.map((id) => t.filter((e) => e.category === id).length);
}, IDS);
check(
  "one event stored per category",
  stored.every((n) => n >= 1),
  IDS.map((id, i) => `${id}:${stored[i]}`).join(" "),
);

/* the agenda names the category, so colour is not the only signal */
check("agenda shows the category name", (await panel.getByText(/· Work$/).count()) > 0);
check("agenda shows Academics", (await panel.getByText(/· Academics$/).count()) > 0);

/* migration: an event saved before categories existed must survive as "other" */
await page.evaluate((date) => {
  const s = JSON.parse(localStorage.getItem("personaos:tasks") ?? "{}");
  s.events.push({
    id: "legacy1",
    title: "Legacy event",
    date,
    startMin: 600,
    durationMin: 30,
    note: "",
  });
  localStorage.setItem("personaos:tasks", JSON.stringify(s));
}, localDayKey());
await page.reload({ waitUntil: "load" });
await page.waitForTimeout(1200);
const legacy = panel.locator("li", { hasText: "Legacy event" });
check("legacy event not dropped", (await legacy.count()) === 1, `${await legacy.count()}`);
check("legacy event became Other", (await legacy.getByText(/· Other$/).count()) > 0);

/* a corrupt category must not throw or blank the event */
await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem("personaos:tasks") ?? "{}");
  s.events.find((e) => e.id === "legacy1").category = { bogus: true };
  localStorage.setItem("personaos:tasks", JSON.stringify(s));
});
await page.reload({ waitUntil: "load" });
await page.waitForTimeout(1200);
check("corrupt category does not drop the event", (await legacy.count()) === 1);
check("corrupt category still reads as Other", (await legacy.getByText(/· Other$/).count()) > 0);

/* editing swaps the category */
await panel.locator("li", { hasText: "Work thing" }).getByRole("button", { name: "Edit" }).click();
await page.waitForTimeout(250);
await swatches.nth(IDS.indexOf("academics")).click();
await panel.getByRole("button", { name: "Update", exact: true }).click();
await page.waitForTimeout(300);
const moved = await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem("personaos:tasks") ?? "{}");
  return (s.events ?? []).find((e) => e.title === "Work thing")?.category;
});
check("edit changes the category", moved === "academics", String(moved));

/* month grid dots must use the category colour, not the old grey */
const dotColors = await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem("personaos:tasks") ?? "{}");
  const d = new Date();
  const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return (s.events ?? []).filter((e) => e.date === today).map((e) => e.category);
});
check("today has events to colour", dotColors.length > 0, String(dotColors.length));

/* ---- task categories in the browser ---- */
const taskPanel = page.locator("section", { has: page.getByLabel("Task title") });
const tSwatches = taskPanel.getByRole("button", { name: /^Task category: / });
check("three task swatches in the form", (await tSwatches.count()) === 3, `${await tSwatches.count()}`);

const tSwatchColors = await tSwatches.evaluateAll((els) =>
  els.map((el) => getComputedStyle(el.querySelector("span")).backgroundColor),
);
check("task swatches paint distinct colours", new Set(tSwatchColors).size === 3, tSwatchColors.join(" "));

/* the dot on a row must match its category, and the name must be printed */
for (const c of TASK_CATEGORIES) {
  await page.getByLabel("Task title").fill(`${c.label} chore`);
  await tSwatches.nth(TIDS.indexOf(c.id)).click();
  await taskPanel.getByRole("button", { name: "Add", exact: true }).click();
  await page.waitForTimeout(250);
}
const taskStored = await page.evaluate((ids) => {
  const s = JSON.parse(localStorage.getItem("personaos:tasks") ?? "{}");
  return ids.map((id) => (s.tasks ?? []).filter((t) => t.category === id).length);
}, TIDS);
check(
  "a task stored per category",
  taskStored.every((n) => n >= 1),
  TIDS.map((id, i) => `${id}:${taskStored[i]}`).join(" "),
);

const personalRow = taskPanel.locator("li", { hasText: "Personal chore" });
/* The separator only appears when there is a due date to separate from. */
check("task row names its category", (await personalRow.getByText(/^·? ?Personal$/).count()) > 0);
const taskDot = await personalRow
  .locator("span[aria-hidden]")
  .first()
  .evaluate((el) => getComputedStyle(el).backgroundColor);
check("task dot matches Personal", taskDot === "rgb(221, 127, 180)", taskDot);

/* a someday task with no due date still shows its category */
const someday = taskPanel.locator("li", { hasText: "Someday: learn to make ramen" });
check("undated task still shows a category", (await someday.getByText("Other").count()) > 0);

/* migration: a task saved before task categories existed must survive */
await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem("personaos:tasks") ?? "{}");
  s.tasks.push({
    id: "legacyt1",
    title: "Legacy task",
    due: null,
    done: false,
    createdAt: new Date().toISOString(),
    note: "",
  });
  localStorage.setItem("personaos:tasks", JSON.stringify(s));
});
await page.reload({ waitUntil: "load" });
await page.waitForTimeout(1200);
const legacyTask = page.locator("section", { has: page.getByLabel("Task title") }).locator("li", {
  hasText: "Legacy task",
});
check("legacy task not dropped", (await legacyTask.count()) === 1, `${await legacyTask.count()}`);
check("legacy task became Other", (await legacyTask.getByText("Other").count()) > 0);

/* a corrupt task category must not throw or drop it */
await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem("personaos:tasks") ?? "{}");
  s.tasks.find((t) => t.id === "legacyt1").category = 42;
  localStorage.setItem("personaos:tasks", JSON.stringify(s));
});
await page.reload({ waitUntil: "load" });
await page.waitForTimeout(1200);
check("corrupt task category keeps the task", (await legacyTask.count()) === 1);

/* every event category must still be present after the task changes */
check(
  "event categories still stored",
  await page.evaluate((ids) => {
    const s = JSON.parse(localStorage.getItem("personaos:tasks") ?? "{}");
    return ids.every((id) => (s.events ?? []).some((e) => e.category === id));
  }, IDS),
);

for (const [w, label] of [
  [390, "390px"],
  [1440, "1440px"],
]) {
  await page.setViewportSize({ width: w, height: 900 });
  await page.waitForTimeout(300);
  const o = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  );
  check(`no overflow at ${label}`, !o);
}

check("console errors", errors.length === 0, errors.join(" | ") || "none");

await b.close();
console.log(failures ? `\n${failures} FAILING` : "\nall passing");
process.exit(failures ? 1 : 0);
