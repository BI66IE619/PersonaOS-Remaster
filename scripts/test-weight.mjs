import { launchBrowser } from "./auth-state.mjs";

const BASE = process.env.SHOT_URL ?? "http://localhost:3000";
const URL = BASE + "/body";
const b = await launchBrowser();
const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
const p = await ctx.newPage();

const errors = [];
p.on("console", (m) => m.type() === "error" && errors.push(m.text()));
p.on("pageerror", (e) => errors.push(String(e)));
const log = (...a) => console.log(...a);

/* This file was a trace: it logged what it saw and always exited 0, so the
   cadence could be changed without anything failing. The numbers stay because
   they are useful to read, but the cadence is now asserted. */
let failures = 0;
const check = (name, cond, extra = "") => {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? ` — ${extra}` : ""}`);
};

await p.goto(URL, { waitUntil: "load" });
await p.waitForTimeout(1500);

/* ---- weight log, in pounds ---- */
log("1. empty state:", (await p.getByText(/no weigh-ins yet/).count()) ? "shown" : "MISSING");

await p.getByLabel("Weight in pounds").fill("148.1");
await p.getByRole("button", { name: "Save", exact: true }).click();
await p.waitForTimeout(300);
log("2. saved:", (await p.getByText("148.1 lb").count()) ? "value shown in lb" : "MISSING");
log("3. cadence:", (await p.getByText(/^next /).textContent())?.trim());

/* ---- the cadence is a fortnight, shared with the Logged today row ---- */
const countdown = (await p.getByText(/^next /).textContent())?.trim() ?? "";
check("the countdown counts a fortnight, not a week", /\b14d$/.test(countdown), countdown);
check("a fresh weigh-in is not due again straight away", (await p.getByText("due now").count()) === 0);
check("the copy no longer says weekly", (await p.getByText(/weekly/i).count()) === 0);

await p.getByRole("button", { name: /Use last/ }).click();
await p.waitForTimeout(150);
log("4. use-last fills input:", await p.getByLabel("Weight in pounds").inputValue());

await p.getByLabel("Weight in pounds").fill("");
await p.waitForTimeout(100);
log(
  "5. save disabled when empty:",
  await p.getByRole("button", { name: "Save", exact: true }).isDisabled(),
);

/* One reading a day: a second save corrects the first rather than stacking. */
await p.getByLabel("Weight in pounds").fill("147.6");
await p.getByRole("button", { name: "Save", exact: true }).click();
await p.waitForTimeout(300);

/* Asserted against the named list, not the panel: "Use last · 148.1 lb" carries
   the same digits as a row, so counting the panel's text matched both. */
const list = p.getByLabel("Recent weigh-ins");
/* The ✕ is the row's own remove button, not part of the reading. */
const rows = async () =>
  (await list.locator("li").allInnerTexts()).map((t) => t.replace(/\s*✕\s*$/, "").replace(/\s+/g, " ").trim());
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

check("a second reading the same day corrects the first", eq(await rows(), ["today 147.6 lb"]), JSON.stringify(await rows()));
check("the day holds one value, not a list", await p.evaluate(() => {
  const raw = JSON.parse(localStorage.getItem("personaos:weight-log") ?? "{}");
  return Object.values(raw);
}), [147.6]);

/* THE REGRESSION: the Body card is fed by the seeded kg series, so logging a
   weight left it showing the same number forever. It must now follow the log. */
const bodyCard = p.locator("section.panel", { hasText: "Body fat" }).first();
const cardWeight = async () =>
  Number((await bodyCard.locator("span.num.text-3xl").innerText()).replace(/[^\d.]/g, ""));
check("the Body card shows the weight just logged", (await cardWeight()) === 147.6, String(await cardWeight()));

await p.getByLabel("Weight in pounds").fill("146.2");
await p.getByRole("button", { name: "Save", exact: true }).click();
await p.waitForTimeout(300);
check("the Body card follows a correction", (await cardWeight()) === 146.2, String(await cardWeight()));

await p.reload({ waitUntil: "load" });
await p.waitForTimeout(1500);
check("the card still follows the log after a reload", (await cardWeight()) === 146.2, String(await cardWeight()));
check("the weigh-in list survives the reload", eq(await rows(), ["today 146.2 lb"]), JSON.stringify(await rows()));

/* ---- Body panel converts seeded kg to lb ---- */
const body = await p.evaluate(() => {
  const panels = [...document.querySelectorAll("section")];
  const body = panels.find((s) => s.textContent?.trim().startsWith("Body30 days"));
  return body?.textContent?.replace(/\s+/g, " ").trim() ?? null;
});
log("8. body panel:", body);

/* Removing the day's one reading clears it, and with it the card's reason to
   prefer the log over the seeded series. */
await p.getByRole("button", { name: /Remove weigh-in from today/ }).click();
await p.waitForTimeout(300);
check("the empty state comes back", (await p.getByText(/no weigh-ins yet/).count()) === 1);
check("the weigh-ins list is gone", (await p.getByLabel("Recent weigh-ins").count()) === 0);
check("the day is gone from storage", await p.evaluate(
  () => Object.keys(JSON.parse(localStorage.getItem("personaos:weight-log") ?? "{}")).length === 0,
), await p.evaluate(() => localStorage.getItem("personaos:weight-log")));
/* With nothing logged the card must fall back rather than show a blank. */
check("the card falls back to the seeded series", typeof (await cardWeight()) === "number" && (await cardWeight()) > 100, String(await cardWeight()));
check("the card says the number is estimated", (await bodyCard.innerText()).length > 0);

const ox = await p.evaluate(
  () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
);
log("10. horizontal overflow:", ox);
log("11. console errors:", errors.length ? errors : "none");
check("no horizontal overflow", !ox);
check("no console errors", errors.length === 0, errors.join(" | ") || "none");

await b.close();
console.log(failures ? `\n${failures} FAILING` : "\nall passing");
process.exit(failures ? 1 : 0);
