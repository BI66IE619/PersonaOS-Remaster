import { launchBrowser } from "./auth-state.mjs";

const BASE = process.env.SHOT_URL ?? "http://localhost:3000";
let failures = 0;
const check = (n, cond, detail = "") => {
  if (!cond) failures++;
  console.log(`${n}. ${cond ? "PASS" : "FAIL"}${detail ? ` — ${detail}` : ""}`);
};

const localDayKey = (offset = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const b = await launchBrowser();
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" });
const page = await ctx.newPage();
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(String(e)));

await page.goto(BASE + "/vitals", { waitUntil: "load" });
await page.waitForTimeout(1400);

const panel = page.locator("section", { has: page.getByText("How'd today go", { exact: true }) });

/* ---- the panel is on Vitality ---- */
check("check-in panel on Vitality", (await panel.count()) === 1);
check("panel is labelled", (await panel.getByRole("heading", { name: "How'd today go" }).count()) === 1);
for (const label of ["Energy", "Mood", "Soreness"]) {
  check(`${label} has 5 steps`, (await panel.getByRole("button", { name: new RegExp(`^${label} \\d of 5$`) }).count()) === 5);
}
check("scales are grouped", (await panel.getByRole("group", { name: "Mood" }).count()) === 1);

/* ---- past days are seeded, today is not fabricated ---- */
const seeded = await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem("personaos:checkins") ?? "{}");
  return s.entries ?? [];
});
check("past days seeded", seeded.length >= 8, `${seeded.length} entries`);
check("today is not pre-seeded", seeded.every((e) => e.date !== localDayKey()));
check("history is newest first", seeded.every((d, i) => i === 0 || seeded[i - 1].date > d.date));
check("a 10-day strip is shown", (await panel.getByText("Last 10 days").count()) === 1);
check("a count is shown", (await panel.getByText(/\d+ logged/).count()) === 1);

/* ---- nothing is ever filled in on the user's behalf ----
   The panel used to fall back to a check-in the data provider generated, which
   meant the scales could already be set and Save could already be live for a day
   nobody had rated. Save offering to commit values the user never chose is the
   part that actually mattered, so that is what is pinned here. */
check("no scale is pre-selected today", (await panel.locator('[aria-pressed="true"]').count()) === 0);
check(
  "Save is disabled until something is rated",
  await panel.getByRole("button", { name: "Save", exact: true }).isDisabled(),
);
check("today is not shown as logged", (await panel.getByText("Update", { exact: true }).count()) === 0);

/* ---- no streak or guilt language ---- */
const body = (await panel.innerText()).toLowerCase();
for (const word of ["streak", "day in a row", "consecutive", "missed", "days since", "keep it up"]) {
  check(`no "${word}" language`, !body.includes(word));
}

/* ---- log today ---- */
await panel.getByRole("button", { name: "Mood 4 of 5" }).click();
await panel.getByRole("button", { name: "Energy 5 of 5" }).click();
await page.waitForTimeout(200);
check("Save enabled once something is rated", await panel.getByRole("button", { name: "Save", exact: true }).isEnabled());
await panel.getByRole("button", { name: "Save", exact: true }).click();
await page.waitForTimeout(500);
check("saved indicator appears", (await panel.getByText("Saved").count()) > 0);
check("button becomes Update", (await panel.getByRole("button", { name: "Update", exact: true }).count()) === 1);
check(
  "today persisted with the right values",
  await page.evaluate((d) => {
    const s = JSON.parse(localStorage.getItem("personaos:checkins") ?? "{}");
    const e = (s.entries ?? []).find((x) => x.date === d);
    return e && e.mood === 4 && e.energy === 5 && e.soreness === 0;
  }, localDayKey()),
);
check("count went up", (await panel.getByText(/\d+ logged/).innerText()).trim() !== "8 logged");

/* ---- THE REGRESSION: a second save must not erase the first ---- */
await panel.getByRole("button", { name: "Mood 2 of 5" }).click();
await panel.getByRole("button", { name: "Update", exact: true }).click();
await page.waitForTimeout(400);
check(
  "one entry per day after re-saving",
  await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem("personaos:checkins") ?? "{}");
    const dates = (s.entries ?? []).map((e) => e.date);
    return new Set(dates).size === dates.length;
  }),
);
check(
  "the update replaced the day rather than adding one",
  await page.evaluate((d) => {
    const s = JSON.parse(localStorage.getItem("personaos:checkins") ?? "{}");
    return (s.entries ?? []).filter((e) => e.date === d).length === 1;
  }, localDayKey()),
);
check("history survives a reload", await (async () => {
  await page.reload({ waitUntil: "load" });
  await page.waitForTimeout(1200);
  return page.evaluate((d) => {
    const s = JSON.parse(localStorage.getItem("personaos:checkins") ?? "{}");
    return (s.entries ?? []).some((e) => e.date === d);
  }, localDayKey());
})());

/* ---- tapping an active rating clears it ---- */
await panel.getByRole("button", { name: "Mood 2 of 5" }).click();
await page.waitForTimeout(150);
check("tapping the active rating clears it", (await panel.getByRole("button", { name: "Mood 2 of 5" }).getAttribute("aria-pressed")) === "false");

/* ---- clearing every scale removes the day ---- */
for (const label of ["Energy", "Mood", "Soreness"]) {
  const on = await panel.getByRole("button", { name: new RegExp(`^${label} \\d of 5$`) }).evaluateAll((els) =>
    els.filter((e) => e.getAttribute("aria-pressed") === "true").map((e) => e.getAttribute("aria-label")),
  );
  for (const aria of on) {
    await panel.getByRole("button", { name: aria }).click();
    await page.waitForTimeout(80);
  }
}
await panel.getByRole("button", { name: "Update", exact: true }).click();
await page.waitForTimeout(500);
check(
  "clearing every scale removes the day",
  await page.evaluate((d) => {
    const s = JSON.parse(localStorage.getItem("personaos:checkins") ?? "{}");
    return !(s.entries ?? []).some((e) => e.date === d);
  }, localDayKey()),
);
check("Clear today is gone once removed", (await panel.getByText("Clear today").count()) === 0);

/* ---- explicit delete path ---- */
await panel.getByRole("button", { name: "Mood 3 of 5" }).click();
await panel.getByRole("button", { name: "Save", exact: true }).click();
await page.waitForTimeout(400);
check("Clear today appears", (await panel.getByText("Clear today").count()) === 1);
await panel.getByText("Clear today").click();
await page.waitForTimeout(400);
check(
  "Clear today removes it",
  await page.evaluate((d) => {
    const s = JSON.parse(localStorage.getItem("personaos:checkins") ?? "{}");
    return !(s.entries ?? []).some((e) => e.date === d);
  }, localDayKey()),
);

/* ---- legacy single-slot check-in carries over ---- */
const today = localDayKey();
await page.evaluate((d) => {
  localStorage.setItem(
    "personaos:journal",
    JSON.stringify({ date: d, energy: 2, mood: 5, soreness: 3, note: "old text", tags: [] }),
  );
  localStorage.removeItem("personaos:checkins");
}, today);
await page.reload({ waitUntil: "load" });
await page.waitForTimeout(1400);
check(
  "legacy scales carried into the log",
  await page.evaluate((d) => {
    const s = JSON.parse(localStorage.getItem("personaos:checkins") ?? "{}");
    const e = (s.entries ?? []).find((x) => x.date === d);
    return !!e && e.mood === 5 && e.energy === 2 && e.soreness === 3;
  }, localDayKey()),
);
check("legacy note text did not leak into the scales", (await page.locator("body").innerText()).includes("old text") === false);

/* ---- corrupt data must not crash or invent entries ---- */
const days = { d0: localDayKey(), dm1: localDayKey(-1), dm2: localDayKey(-2) };
await page.evaluate((d) => {
  localStorage.setItem(
    "personaos:checkins",
    JSON.stringify({
      seeded: true,
      entries: [
        { date: "nope", energy: 3, mood: 3, soreness: 3 },
        { date: d.d0, energy: 0, mood: 0, soreness: 0 },
        { date: d.dm1, energy: 4, mood: 4, soreness: 2 },
        { date: d.dm1, energy: 1, mood: 1, soreness: 1 },
        { date: d.dm2, energy: 99, mood: -7, soreness: 3 },
        { date: "2099-01-01", energy: 3, mood: 3, soreness: 3 },
        null,
        42,
      ],
    }),
  );
}, days);
await page.reload({ waitUntil: "load" });
await page.waitForTimeout(1400);
const clean = await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem("personaos:checkins") ?? "{}");
  return s.entries ?? [];
});
check("bad date dropped", clean.every((e) => /^\d{4}-\d{2}-\d{2}$/.test(e.date)));
check("empty entry dropped", clean.every((e) => e.energy || e.mood || e.soreness));
check("scales stay within 0-5", clean.every((e) => [e.energy, e.mood, e.soreness].every((v) => Number.isInteger(v) && v >= 0 && v <= 5)));
check("duplicate day collapsed", clean.filter((e) => e.date === localDayKey(-1)).length === 1);
check("future day dropped", clean.every((e) => e.date <= localDayKey()));
check("no crash from hostile data", errors.length === 0, errors.join(" | ") || "none");

/* ---- clear all ---- */
await panel.getByText("Clear all check-ins").click();
await page.waitForTimeout(400);
check(
  "clear all empties the log",
  await page.evaluate(() => (JSON.parse(localStorage.getItem("personaos:checkins") ?? "{}").entries ?? []).length === 0),
);

/* ---- the two stores stay separate ---- */
await page.evaluate(() => localStorage.setItem("personaos:notes", JSON.stringify({ seeded: true, entries: [{ date: "2020-01-01", note: "A note.", tags: [] }] })));
await page.goto(BASE + "/notes", { waitUntil: "load" });
await page.waitForTimeout(1200);
check("Notes has no scales", (await page.getByRole("button", { name: /^Mood \d of 5$/ }).count()) === 0);
check("Notes archive intact", (await page.getByText("A note.").count()) > 0);

/* ---- responsive ---- */
await page.goto(BASE + "/vitals", { waitUntil: "load" });
await page.waitForTimeout(1000);
for (const [w, label] of [
  [390, "390px"],
  [1440, "1440px"],
]) {
  await page.setViewportSize({ width: w, height: 900 });
  await page.waitForTimeout(350);
  const o = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  check(`no overflow at ${label}`, !o);
}

check("console errors", errors.length === 0, errors.join(" | ") || "none");

await b.close();
console.log(failures ? `\n${failures} FAILING` : "\nall passing");
process.exit(failures ? 1 : 0);
