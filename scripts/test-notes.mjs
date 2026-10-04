import { launchBrowser } from "./auth-state.mjs";

const BASE = process.env.SHOT_URL ?? "http://localhost:3000";
let failures = 0;
const log = (n, v) => console.log(`${n}. ${v}`);
const check = (n, cond, detail = "") => {
  if (!cond) failures++;
  log(n, `${cond ? "PASS" : "FAIL"}${detail ? ` — ${detail}` : ""}`);
};

/* The app's "today" is the server's local date, not UTC. */
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

await page.goto(BASE + "/notes", { waitUntil: "load" });
await page.waitForTimeout(1200);

/* ---- nav ---- */
check("nav has Notes", (await page.getByRole("link", { name: "Notes", exact: true }).count()) === 1);
check(
  "Notes marked current",
  (await page.getByRole("link", { name: "Notes", exact: true }).getAttribute("aria-current")) === "page",
);
  /* Both navs are in the DOM and one is always display:none, so count the visible
     one: brand + six tabs on desktop, home + four icons + mentor on mobile. */
  const visibleNav = page.locator("nav:visible");
  check(
    "six tabs in the nav",
    (await visibleNav.locator("a").count()) === 7,
  `${await visibleNav.locator("a").count()} links`,
);

/* ---- Notes is text only: the scales live in the Vitality check-in ---- */
for (const label of ["Energy", "Mood", "Soreness"]) {
  check(`no ${label} scale here`, (await page.getByRole("button", { name: new RegExp(`^${label} \\d of 5$`) }).count()) === 0);
}

/* ---- the archive seeded on first run ---- */
const archive = page.locator("section", { has: page.getByText("Archive", { exact: true }) });
check("archive seeded", (await archive.getByRole("button", { name: /^Open note for/ }).count()) >= 5);
check(
  "a count is shown",
  (await archive.getByText(/\d+ entries/).count()) === 1,
  await archive.getByText(/\d+ entries/).innerText(),
);

/* ---- no pressure surface anywhere on the page ---- */
const body = (await page.locator("body").innerText()).toLowerCase();
for (const word of ["streak", "day in a row", "consecutive", "missed", "days since", "keep it up"]) {
  check(`no "${word}" language`, !body.includes(word));
}

/* ---- write an entry ---- */
const composer = page.locator("section", { has: page.getByLabel("Note", { exact: true }) });
await page.getByLabel("Note", { exact: true }).fill("Wrote this from a test.");
await page.waitForTimeout(200);
await composer.getByRole("button", { name: "Save", exact: true }).click();
await page.waitForTimeout(400);
check("saved indicator appears", (await composer.getByText("Saved").count()) > 0);
check("entry lands in the archive", (await archive.getByText("Wrote this from a test.").count()) > 0);
check("button becomes Update", (await composer.getByRole("button", { name: "Update", exact: true }).count()) === 1);

/* ---- THE REGRESSION: writing another day must not destroy this one ---- */
/* Step back to a day the seed does not cover, so the button reads "Save"
   rather than "Update" (the archive seeds yesterday, 2, 4, 6, 9, and 13 back). */
for (let i = 0; i < 3; i++) {
  await page.getByRole("button", { name: "Previous day" }).click();
  await page.waitForTimeout(150);
}
check(
  "moved to an earlier day",
  (await page.getByRole("button", { name: "Back to today" }).count()) === 1,
);
await page.getByLabel("Note", { exact: true }).fill("A second day's note.");
await page.waitForTimeout(150);
check("unseeded day offers Save", (await composer.getByRole("button", { name: "Save", exact: true }).count()) === 1);
await composer.getByRole("button", { name: "Save", exact: true }).click();
await page.waitForTimeout(400);
check("second entry saved", (await archive.getByText("A second day's note.").count()) > 0);

await page.reload({ waitUntil: "load" });
await page.waitForTimeout(1200);
check(
  "first entry survived the second write",
  (await archive.getByText("Wrote this from a test.").count()) > 0,
);
check(
  "second entry survived the reload",
  (await archive.getByText("A second day's note.").count()) > 0,
);
check(
  "both written days are in storage",
  await page.evaluate((dates) => {
    const s = JSON.parse(localStorage.getItem("personaos:notes") ?? "{}");
    const set = new Set((s.entries ?? []).map((e) => e.date));
    return dates.every((d) => set.has(d));
  }, [localDayKey(), localDayKey(-3)]),
);

/* ---- search ---- */
/* A hit on a later line must show that line. The seed note about the essay puts
   "counter-argument" at the end of a long single line, so the first-line
   preview would never contain it. */
const noteRows = () => archive.getByRole("button", { name: /^Open note for/ });
const search = page.getByLabel("Search notes");
const allCount = await noteRows().count();

await search.fill("counter-argument");
await page.waitForTimeout(350);
check("search narrows to the hit", (await noteRows().count()) === 1, `${await noteRows().count()} of ${allCount}`);
check("the snippet shows the matching words", (await noteRows().first().innerText()).includes("counter-argument"));
check("the snippet is windowed, not the first line", (await noteRows().first().innerText()).includes("…"));
check("the count reads N of M", (await archive.getByText(`1 of ${allCount}`).count()) === 1);

await search.fill("COUNTER-ARGUMENT");
await page.waitForTimeout(300);
check("search ignores case", (await noteRows().count()) === 1);

await search.fill("zzz-no-such-text");
await page.waitForTimeout(300);
check("no-match state appears", (await archive.getByText("Nothing matches that.").count()) === 1);
check("no-match count is 0", (await archive.getByText(`0 of ${allCount}`).count()) === 1);

await page.getByLabel("Clear search and filter").click();
await page.waitForTimeout(300);
check("clear restores the archive", (await noteRows().count()) === allCount);

/* ---- tags ---- */
await noteRows().first().click();
await page.waitForTimeout(300);
for (const t of ["Essay", "School"]) {
  await page.getByLabel("Add a tag").fill(t);
  await page.getByLabel("Add a tag").press("Enter");
  await page.waitForTimeout(200);
}
check("two tag chips appear", (await page.locator('button[aria-label^="Remove tag"]').count()) === 2);

await page.getByLabel("Add a tag").fill("essay");
await page.getByLabel("Add a tag").press("Enter");
await page.waitForTimeout(250);
check("a tag is not duplicated case-insensitively", (await page.locator('button[aria-label^="Remove tag"]').count()) === 2);

await composer.getByRole("button", { name: "Update", exact: true }).click();
await page.waitForTimeout(400);
check(
  "tags are stored",
  await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem("personaos:notes") ?? "{}");
    return JSON.stringify(s.entries?.[0]?.tags) === JSON.stringify(["Essay", "School"]);
  }),
  await page.evaluate(() => JSON.stringify(JSON.parse(localStorage.getItem("personaos:notes")).entries[0].tags)),
);

/* The cap is enforced in the store, not just hidden in the UI, so hand-edited
   storage cannot smuggle a ninth tag through either. */
for (const t of ["t3", "t4", "t5", "t6", "t7", "t8", "t9"]) {
  const input = page.getByLabel("Add a tag");
  if (await input.isDisabled()) break;
  await input.fill(t);
  await input.press("Enter");
  await page.waitForTimeout(120);
}
check("the tag input locks at the cap", await page.getByLabel("Add a tag").isDisabled());
check("the cap is eight", (await page.locator('button[aria-label^="Remove tag"]').count()) === 8);
await composer.getByRole("button", { name: "Update", exact: true }).click();
await page.waitForTimeout(400);
check(
  "only eight tags reach storage",
  await page.evaluate(
    () => (JSON.parse(localStorage.getItem("personaos:notes")).entries[0].tags ?? []).length === 8,
  ),
);

/* Filtering by a tag, and clearing it. */
const essayChip = archive.locator('button[aria-pressed]', { hasText: "Essay" }).first();
check("used tags appear as filter chips", (await archive.locator("button[aria-pressed]").count()) > 0);
await essayChip.click();
await page.waitForTimeout(350);
check("tag filter narrows the list", (await noteRows().count()) === 1, `${await noteRows().count()} entries`);
check("the active chip is pressed", (await essayChip.getAttribute("aria-pressed")) === "true");
await page.getByLabel("Clear search and filter").click();
await page.waitForTimeout(300);
check("clearing the filter restores the list", (await noteRows().count()) === allCount, `${await noteRows().count()} of ${allCount}`);

/* Chips in a row are read-only text, not buttons: a row is already a button and
   a button cannot be nested inside another. */
check(
  "archive rows expose no nested tag buttons",
  await noteRows().first().evaluate((el) => el.querySelectorAll("button").length === 0),
);

await page.reload({ waitUntil: "load" });
await page.waitForTimeout(1200);
check(
  "tags survive a reload",
  await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem("personaos:notes") ?? "{}");
    return (s.entries?.[0]?.tags ?? []).includes("Essay");
  }),
);

/* opening an archived day loads it into the composer. The newest entry is
   today, so pick the one after it to land on a past day. */
await archive.getByRole("button", { name: /Open note for/ }).nth(1).click();
await page.waitForTimeout(300);
check("archive entry opens in the composer", (await page.getByLabel("Note", { exact: true }).inputValue()).length > 0);
check("a past day shows Back to today", (await page.getByRole("button", { name: "Back to today" }).count()) === 1);

/* the future is not writable */
await page.getByRole("button", { name: "Back to today" }).click();
await page.waitForTimeout(300);
check("cannot go past today", await page.getByRole("button", { name: "Next day" }).isDisabled());

/* ---- the old single-entry store must be carried over, not orphaned ---- */
await page.evaluate(() => {
  localStorage.setItem(
    "personaos:journal",
    JSON.stringify({ date: "2020-05-04", energy: 5, mood: 4, soreness: 1, note: "From the old check-in.", tags: [] }),
  );
  localStorage.removeItem("personaos:notes");
});
await page.reload({ waitUntil: "load" });
await page.waitForTimeout(1200);
check("legacy check-in carried over", (await archive.getByText("From the old check-in.").count()) > 0);
check("legacy key still readable", await page.evaluate(() => !!localStorage.getItem("personaos:journal")));

/* ---- corrupt and hostile data must not crash or invent entries ---- */
const days = { d0: localDayKey(), dm1: localDayKey(-1), dm2: localDayKey(-2), dm3: localDayKey(-3) };
await page.evaluate((d) => {
  localStorage.setItem(
    "personaos:notes",
    JSON.stringify({
      seeded: true,
      entries: [
        { date: "not-a-date", note: "bad date" },
        { date: d.d0, note: "" },
        { date: d.d0, note: "Valid one." },
        { date: d.dm1, note: "Valid two." },
        /* the same day twice, which must collapse to a single entry */
        { date: d.dm2, note: "Dup first." },
        { date: d.dm2, note: "Dup second." },
        { date: d.dm3, note: "Multi\nline note." },
        null,
        "nonsense",
      ],
    }),
  );
}, days);
await page.reload({ waitUntil: "load" });
await page.waitForTimeout(1200);
check("valid entry kept", (await archive.getByText("Valid one.").count()) > 0);
check("second valid entry kept", (await archive.getByText("Valid two.").count()) > 0);
check("multi-line entry kept", (await archive.getByText(/Multi/).count()) > 0);
check("bad date dropped", (await archive.getByText("bad date").count()) === 0);
check("duplicate day kept once", (await archive.getByText("Dup first.").count()) === 1);
check("duplicate day dropped the other", (await archive.getByText("Dup second.").count()) === 0);
check("no empty notes survive", await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem("personaos:notes") ?? "{}");
  return (s.entries ?? []).every((e) => e.note.trim().length > 0);
}));
check("no scale fields left in storage", await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem("personaos:notes") ?? "{}");
  return (s.entries ?? []).every((e) => !("energy" in e) && !("mood" in e) && !("soreness" in e));
}));
check("no duplicate dates in storage", await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem("personaos:notes") ?? "{}");
  const list = (s.entries ?? []).map((e) => e.date);
  return new Set(list).size === list.length;
}));
check("archive is newest first", await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem("personaos:notes") ?? "{}");
  const list = (s.entries ?? []).map((e) => e.date);
  return list.every((d, i) => i === 0 || list[i - 1] > d);
}));
check("no crash from hostile data", errors.length === 0, errors.join(" | ") || "none");

/* ---- clearing the text removes the day instead of leaving a ghost ---- */
await page.evaluate((d) => {
  localStorage.setItem(
    "personaos:notes",
    JSON.stringify({ seeded: true, entries: [{ date: d, note: "to be emptied", tags: [] }] }),
  );
}, days.dm1);
await page.reload({ waitUntil: "load" });
await page.waitForTimeout(1200);
await archive.getByRole("button", { name: /Open note for/ }).first().click();
await page.waitForTimeout(300);
await page.getByLabel("Note", { exact: true }).fill("");
check("emptying keeps Update live so the day can go", await composer.getByRole("button", { name: "Update", exact: true }).isEnabled());
await composer.getByRole("button", { name: "Update", exact: true }).click();
await page.waitForTimeout(400);
check(
  "emptied day is removed",
  await page.evaluate(() => JSON.parse(localStorage.getItem("personaos:notes") ?? "{}").entries?.length === 0),
);

/* ---- the check-in now lives on Vitality, and it is not a Notes thing ---- */
check("Notes has no check-in panel", (await page.getByText("How'd today go").count()) === 0);
check("Notes never touches the check-in store", await page.evaluate(() => !localStorage.getItem("personaos:checkins")));
  check("Vitality nav still has six tabs", (await page.locator("nav:visible a").count()) === 7);

/* ---- responsive ---- */
await page.goto(BASE + "/notes", { waitUntil: "load" });
await page.waitForTimeout(800);
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
