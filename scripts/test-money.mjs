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

await page.goto(BASE + "/money", { waitUntil: "load" });
await page.waitForTimeout(1200);

/* ---- budgets are gone ----
   The user does not set a budget: they are 15 and do not run a household.
   Nothing in the money tab may reintroduce the concept. */
const body = await page.locator("main").innerText();
check("no budget anywhere on the tab", !/budget/i.test(body));
check("no 'left for the month' nudge", !/left for/i.test(body));
check("no over-budget warning", !/over budget/i.test(body));

/* ---- the accounting still works ---- */
check("balance tile", (await page.getByText("Balance", { exact: true }).count()) === 1);
check("in tile", (await page.getByText("In", { exact: true }).count()) === 1);
check("out tile", (await page.getByText("Out", { exact: true }).count()) === 1);
check("net tile", (await page.getByText("Net", { exact: true }).count()) === 1);
check("by-category breakdown survives", (await page.getByText("By category").count()) === 1);
check("subscriptions still listed", (await page.getByText("Subscriptions").count()) >= 1);

/* Category rows must be ordered and show a share of spend rather than a target. */
const rows = page.locator("section", { has: page.getByText("By category") });
const shares = await rows.locator("text=/%/").allInnerTexts();
const nums = shares.map((t) => parseInt(t.replace(/\D+/g, ""), 10)).filter((n) => !Number.isNaN(n));
check("every category shows a share", nums.length > 0, `${nums.length} rows`);
check("shares top out below 100% of any budget", Math.max(...nums) <= 100);
check("categories are in descending order", nums.every((n, i) => i === 0 || nums[i - 1] >= n));

/* ---- no overflow at both widths ---- */
for (const w of [390, 1440]) {
  await page.setViewportSize({ width: w, height: 900 });
  await page.waitForTimeout(400);
  const o = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  check(`no overflow-x at ${w}px`, !o);
}

check("console errors", errors.length === 0, errors.join(" / "));
console.log(failures ? `\n${failures} FAILING` : "\nall passing");
await b.close();
process.exit(failures ? 1 : 0);
