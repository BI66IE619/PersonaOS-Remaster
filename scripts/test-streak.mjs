import { launchBrowser } from "./auth-state.mjs";

/** Lifting streak: the box under the weight log. The run number and the 14-day
    dots are read from one derived set of days, so the two can never disagree,
    and the current run walks back from today while tolerating an unfinished
    today, because a day that is not over is not a miss. */

const BASE = process.env.SHOT_URL ?? "http://localhost:3000";
const b = await launchBrowser();
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, colorScheme: "dark" });
const page = await ctx.newPage();
const errs = [];
page.on("console", (m) => m.type() === "error" && errs.push(m.text()));
page.on("pageerror", (e) => errs.push(String(e)));

let bad = 0;
const check = (n, c, x = "") => {
  if (!c) bad++;
  console.log(`${c ? "ok  " : "FAIL"} ${n}${x ? ` — ${x}` : ""}`);
};

const day = (o) => {
  const d = new Date();
  d.setDate(d.getDate() + o);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/* finished = every targeted movement at 4 sets */
const seed = async (offs, mangle) => {
  await page.evaluate(
    ({ o, m, t }) => {
      const ids = ["bench-press", "bicep-curls", "overhead-db-tricep-extension"];
      const exercises = ids.map((id) => ({ id, name: id, usualReps: 10, targetSets: 4, weightLb: 0 }));
      const days = {};
      for (const k of o) {
        const d = new Date();
        d.setDate(d.getDate() + k);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        days[key] = Object.fromEntries(
          ids.map((id) => [id, Array.from({ length: 4 }, () => ({ reps: 10, weightLb: null }))]),
        );
      }
      if (m === "half") days[t]["bicep-curls"] = days[t]["bicep-curls"].slice(0, 2);
      localStorage.setItem("personaos:strength", JSON.stringify({ seeded: true, exercises, days }));
    },
    { o: offs, m: mangle, t: day(0) },
  );
  await page.reload({ waitUntil: "load" });
  await page.waitForTimeout(1200);
};

const panel = () => page.locator(".panel").filter({ hasText: "Lifting streak" });
const dots = () => panel().locator('[role="img"] > span');
/* Read the inline background the component set on each dot. Comparing computed
   colours does not work: --color-inset is translucent, so every dot differs from
   the panel behind it and all 14 would read as filled. */
const filled = () =>
  page.evaluate(() => {
    const p = [...document.querySelectorAll(".panel")].find((s) => s.textContent?.includes("Lifting streak"));
    const box = p.querySelector('[role="img"]');
    return [...box.children].filter((s) => s.style.background.includes("accent")).length;
  });
const text = async () => (await panel().innerText()).replace(/\s+/g, " ");

await page.goto(BASE + "/body", { waitUntil: "load" });
await page.waitForTimeout(1500);

check("the box is under the weight log", await page.evaluate(() => {
  const ps = [...document.querySelectorAll(".panel")];
  const w = ps.find((p) => p.textContent?.includes("Weight log"));
  const s = ps.find((p) => p.textContent?.includes("Lifting streak"));
  return Boolean(w && s && w.compareDocumentPosition(s) & Node.DOCUMENT_POSITION_FOLLOWING);
}), "weight log comes first");
check("it has 14 dots", (await dots().count()) === 14, `${await dots().count()}`);
check("it labels the dot section", (await panel().getByText("Last 14 Days").count()) === 1);
check("it states the current run", (await panel().getByText(/Current run:/).count()) === 1);
check("today is the only outlined dot", (await page.evaluate(() => {
  const p = [...document.querySelectorAll(".panel")].find((s) => s.textContent?.includes("Lifting streak"));
  const box = [...p.querySelectorAll('[role="img"] > span')];
  return box.filter((s) => s.style.border.includes("hairline-strong")).length;
})) === 1, "rightmost");

await seed([0, -1, -2, -3, -4]);
let t = await text();
check("five days ending today reads 5", /Current run: Day 5/.test(t), t);
check("today finished says so", /Today is done\./.test(t), t);
check("5 of 14 days filled", (await filled()) === 5, `${await filled()}`);

await seed([-1, -2, -3, -4, -5]);
t = await text();
check("an unfinished today does not break the run", /Current run: Day 5/.test(t), t);
check("it still counts today as unfinished", /0 of 3 movements finished today/.test(t), t);
check("5 of 14 days filled without today", (await filled()) === 5, `${await filled()}`);

await seed([0, -2, -3, -4]);
t = await text();
check("a skipped yesterday resets the run to today alone", /Current run: Day 1/.test(t), t);
check("the skipped day stays an empty dot", (await filled()) === 4, `${await filled()}`);

await seed([0], "half");
t = await text();
check("a half-finished day does not count", /Current run: Day 0/.test(t), t);
check("it reports what is left of today", /2 of 3 movements finished today/.test(t), t);
check("half a day is not a filled dot", (await filled()) === 0, `${await filled()}`);

await seed([]);
t = await text();
check("no history reads a run of 0", /Current run: Day 0/.test(t), t);
check("no dots are filled", (await filled()) === 0, `${await filled()}`);

for (const w of [390, 1440]) {
  await page.setViewportSize({ width: w, height: 900 });
  await page.waitForTimeout(400);
  check(
    `no overflow-x at ${w}px`,
    !(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)),
  );
}
check("no console errors", errs.length === 0, errs.join(" / ") || "none");
console.log(bad ? `\n${bad} FAILING` : "\nall passing");
await b.close();
process.exit(bad ? 1 : 0);
