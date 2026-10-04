import { launchBrowser } from "./auth-state.mjs";

const BASE = process.env.SHOT_URL ?? "http://localhost:3000";
let failures = 0;
const check = (n, cond, detail = "") => {
  if (!cond) failures++;
  console.log(`${n}. ${cond ? "PASS" : "FAIL"}${detail ? ` — ${detail}` : ""}`);
};

const b = await launchBrowser();
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" });
const page = await ctx.newPage();
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(String(e)));

/* ---- sleep insights, on Vitality, from the real seeded provider history ---- */
await page.goto(BASE + "/vitals", { waitUntil: "load" });
await page.waitForTimeout(1400);

const sleepPanel = page.locator("section", { has: page.getByText("Sleep, over time", { exact: true }) });
check("sleep insights panel present", (await sleepPanel.count()) === 1);
check("sleep debt row present", (await sleepPanel.getByText("Sleep debt", { exact: true }).count()) === 1);
check("sleep-energy row present", (await sleepPanel.getByText("Sleep and your energy", { exact: true }).count()) === 1);

/* The last panel used to be seven columns wide in a twelve column grid with
   nothing beside it, which left five columns of bare background to its right
   and read as a hole. A closing panel that does not reach the grid's right edge
   is the signature of that, so the edge is measured instead of the class, which
   would only restate the implementation. */
const grid = page.locator("main.grid").first();
const gridBox = await grid.boundingBox();
const cells = grid.locator(":scope > *");
const lastCell = await cells.nth((await cells.count()) - 1).boundingBox();
const gridRight = gridBox.x + gridBox.width;
const lastRight = lastCell.x + lastCell.width;
check(
  "the closing panel reaches the right edge, so the last row has no hole",
  Math.abs(gridRight - lastRight) < 2,
  `grid ends at ${Math.round(gridRight)}px, panel ends at ${Math.round(lastRight)}px`,
);

/* Each read is its own tile, so the verdict is grabbed from the tile rather
   than from the label's own parent, which holds only the label and the stat. */
const debtText = (await sleepPanel.locator("div.tile", { has: page.getByText("Sleep debt", { exact: true }) }).textContent()) ?? "";
check("sleep debt says something", /median|owed|clear|night/i.test(debtText), debtText.slice(0, 90).replace(/\s+/g, " "));

/* The provider generates 120 days, so debt must have a real number rather than
   the "needs a week" holding line. */
check("sleep debt is computed from real history", !/a week is needed/.test(debtText));

/* Check-ins are seeded across the history, so the sleep/energy claim should be
   able to reach a verdict. If it cannot, it must say so rather than invent one. */
const linkText = (await sleepPanel.locator("div.tile", { has: page.getByText("Sleep and your energy", { exact: true }) }).textContent()) ?? "";
check(
  "sleep-energy either concludes or states the shortfall",
  /You rate|Something else|sleep is not the lever|needs 3 short/.test(linkText),
  linkText.slice(0, 90).replace(/\s+/g, " "),
);

/* ---- the month-long trend line, on Home ---- */
await page.goto(BASE + "/home", { waitUntil: "load" });
await page.waitForTimeout(1400);

const trendPanel = page.locator("section", { has: page.getByText("The last month, all together", { exact: true }) });
check("trend panel is on Home", (await trendPanel.count()) === 1);
const trendText = (await trendPanel.textContent()) ?? "";
check("trend draws a conclusion", /(Down|Up|Holding steady)/.test(trendText), trendText.slice(0, 110).replace(/\s+/g, " "));
check("trend shows the two groups", /Night and recovery/.test(trendText));
check("trend is not a bare number for today", !/today|readiness/i.test(trendText));

/* ---- training insights, on Body ---- */
await page.goto(BASE + "/body", { waitUntil: "load" });
await page.waitForTimeout(1400);

const trainPanel = page.locator("section", { has: page.getByText("What the log is telling you", { exact: true }) });
check("training insights panel present", (await trainPanel.count()) === 1);
check("weight direction row present", (await trainPanel.getByText("Weight direction", { exact: true }).count()) === 1);
check("stalled lifts row present", (await trainPanel.getByText("Lifts that have stalled", { exact: true }).count()) === 1);

/* ---- plateau reads a real stall once a log exists ---- */
/* Seeded directly so the assertion does not depend on how many movements the
   strength store happens to have history for. */
await page.evaluate(() => {
  const days = {};
  for (const [offset, lb] of [[-35, 100], [-28, 105], [-21, 110], [-14, 110], [-7, 110], [-2, 110]]) {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    days[key] = { "bench-press": [{ reps: 8, weightLb: lb }] };
  }
  localStorage.setItem(
    "personaos:strength",
    JSON.stringify({
      seeded: true,
      exercises: [{ id: "bench-press", name: "Bench press", usualReps: 8, targetSets: 4, weightLb: 110 }],
      days,
    }),
  );
});

await page.reload({ waitUntil: "load" });
await page.waitForTimeout(1400);

const stalledText = (await trainPanel.textContent()) ?? "";
check("stalled lift is named", /Bench press/.test(stalledText));
check("stall is explained in sessions", /No new best in 3 sessions/.test(stalledText), stalledText.slice(0, 120).replace(/\s+/g, " "));
check("estimated 1RM is shown", /e1RM/.test(stalledText));

/* ---- weight trend reads a real log ---- */
/* Steep early loss then flat, matching the unit fixture: a fall that has
   genuinely stopped, so the plateau branch is the one under test. */
await page.evaluate(() => {
  const logs = {};
  for (const [offset, lb] of [[-56, 140], [-42, 137], [-28, 136.2], [-2, 136.1]]) {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    logs[key] = lb;
  }
  localStorage.setItem("personaos:weight-log", JSON.stringify(logs));
});
await page.reload({ waitUntil: "load" });
await page.waitForTimeout(1400);

const weightText = (await trainPanel.locator("div.tile", { has: page.getByText("Weight direction", { exact: true }) }).textContent()) ?? "";
check("weight trend has a direction", /lb (down|up|flat)/.test(weightText), weightText.slice(0, 110).replace(/\s+/g, " "));
check("weight plateau is called out", /stopped moving/.test(weightText), weightText.slice(0, 110).replace(/\s+/g, " "));
check("weight head keeps the earlier direction", /3\.9lb down/.test(weightText));

check("no console errors", errors.length === 0, errors.slice(0, 2).join(" | "));

await b.close();
console.log(failures === 0 ? "\nall passing" : `\n${failures} failing`);
process.exit(failures === 0 ? 0 : 1);
