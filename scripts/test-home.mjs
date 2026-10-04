import { launchBrowser } from "./auth-state.mjs";

/* Kept in step with NICKNAME in src/lib/persona.ts. Asserted as a literal on
   purpose: if the greeting copy drifts from the persona constant, this should
   fail rather than quietly follow it. */
const NICKNAME = "Biggie";

/* Kept in step with WELCOMES in src/lib/welcomes.ts. If the app's copy changes
   and this does not, "welcome is one of the known greetings" fails loudly —
   which is the point. */
const WELCOME_SET = [
  `Welcome back, ${NICKNAME}`,
  `Good to see you, ${NICKNAME}`,
  `Howdy, ${NICKNAME}`,
  `Let's get after it, ${NICKNAME}`,
  `Back at it, ${NICKNAME}`,
  `Ready when you are, ${NICKNAME}`,
  `Nice to see you, ${NICKNAME}`,
  `Hey ${NICKNAME}, let's go`,
];

const BASE = process.env.SHOT_URL ?? "http://localhost:3000";

/* The app's "today" is the server's local date, not UTC. */
const localDayKey = (offset = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

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

/* ---- "/" is the opening, not a page ---- */
await page.goto(BASE + "/", { waitUntil: "load" });
await page.waitForTimeout(350);
  /* The P on its own, deliberately. The wordmark used to sit under it here and
     then had to vanish so the same word could assemble in the corner, which is
     exactly the seam the intro is meant to not have. */
  check("opening shows the P", (await page.locator("[data-splash-p]").count()) === 1);
  check("opening shows no wordmark, which assembles at the end instead", (await page.locator("[data-nav-brand]").count()) === 0);
check("opening is not the dashboard", (await page.locator("main .panel").count()) === 0);
await page.waitForURL("**/home", { timeout: 15000 });
check("opening routes to /home", new URL(page.url()).pathname === "/home");
await page.waitForTimeout(1800);

/* ---- the daily overview ---- */
check("verdict is on Home", (await page.getByText("Today's read", { exact: true }).count()) === 1);
check("readiness ring is on Home", (await page.locator('[role="img"][aria-label^="Readiness"]').count()) === 1);

/* ---- the welcome ---- */
check("welcome heading is present", (await page.getByRole("heading", { level: 1 }).count()) === 1);
const welcome = page.locator("header").first();
const heading = await page.getByRole("heading", { level: 1 }).innerText();
check("welcome is one of the known greetings", WELCOME_SET.includes(heading), heading);
check("welcome names the user", heading.includes(NICKNAME), heading);
/* The greeting must not depend on the clock. It used to, and that meant the
   server and browser could disagree, which needed a hydration warning to hide. */
check("greeting is clock-independent", !/good (morning|afternoon|evening)/i.test(heading), heading);
check("greeting is a single line", (await welcome.locator("p").count()) === 0);
/* Nothing in the greeting may comment on how the last stretch went. "Welcome
   back" is fine — it only means the app was opened again. */
const welcomeText = heading.toLowerCase();
for (const w of ["streak", "missed", "again", "you haven't", "consistent", "proud", "keep it up"]) {
  check(`welcome has no "${w}" language`, !welcomeText.includes(w));
}

/* A reload should actually feel different. The pick happens on the server, so
   this is also the check that Home is still force-dynamic rather than baked
   into the build. */
const seen = new Set([heading]);
for (let i = 0; i < 11; i++) {
  await page.reload({ waitUntil: "load" });
  await page.waitForTimeout(250);
  seen.add((await page.getByRole("heading", { level: 1 }).innerText()).trim());
}
check("welcome varies across reloads", seen.size > 1, `${seen.size} distinct in 12 loads`);
check("every reload stayed in the set", [...seen].every((w) => WELCOME_SET.includes(w)), [...seen].join(" | "));
check("the rotation is not a single repeating line", seen.size >= 3, `${seen.size} distinct in 12 loads`);

for (const t of ["Up next", "Habits today", "Money today", "Logged today"]) {
  check(`"${t}" panel`, (await page.getByText(t, { exact: true }).count()) === 1);
}

/* ---- it is a rollup, not a second health page ---- */
await page.goto(BASE + "/vitals", { waitUntil: "load" });
await page.waitForTimeout(1200);
check("verdict is NOT repeated on Vitality", (await page.getByText("Today's read", { exact: true }).count()) === 0);
check("Vitality keeps the depth", (await page.getByText("Last night", { exact: true }).count()) === 1);
check("Vitality keeps 30 days", (await page.getByText("30 days", { exact: true }).count()) === 1);
check("Vitality keeps the check-in", (await page.getByText("How'd today go", { exact: true }).count()) === 1);
const vitalsText = await page.locator("body").innerText();
check(
  "the welcome is Home only",
  !WELCOME_SET.some((w) => vitalsText.includes(w)),
  vitalsText.match(/(Welcome back|Good to see you|Howdy|Back at it|Ready when you are|Nice to see you)[^\n]*/)?.[0],
);
check("Vitality has no welcome header", (await page.locator("header h1").count()) === 0);

/* ---- agenda: seeded content and inline completion ---- */
await page.goto(BASE + "/home", { waitUntil: "load" });
await page.waitForTimeout(1800);

const agenda = page.locator("section", { has: page.getByText("Up next", { exact: true }) });
check("today's event is listed", (await agenda.getByText("Team training").count()) === 1);
check("the event shows a time", (await agenda.getByText(/5:00 PM/).count()) >= 1);
check("a due-today task is listed", (await agenda.getByText("Email coach about Thursday").count()) === 1);
check("an overdue task is flagged", (await agenda.getByText("2d ago").count()) === 1);
check("a someday task is NOT on the agenda", (await agenda.getByText("learn to make ramen").count()) === 0);
check("a done task is NOT on the agenda", (await agenda.getByText("Check in with Priya").count()) === 0);

/* Ticking a task removes it from the agenda — there is nothing left to read a
   tick from, so completion is verified by absence plus the stored record. */
const box1 = agenda.getByRole("checkbox", { name: "Mark Email coach about Thursday done" });
check("the due-today task starts unticked", (await box1.getAttribute("aria-checked")) === "false");
await box1.click();
await page.waitForTimeout(250);
check("task ticks inline and leaves the agenda", (await agenda.getByText("Email coach about Thursday").count()) === 0);

await page.reload({ waitUntil: "load" });
await page.waitForTimeout(1600);
check("the tick survives a reload", (await page.getByText("Email coach about Thursday").count()) === 0);
const stored = await page.evaluate(
  () => JSON.parse(localStorage.getItem("personaos:tasks") ?? "{}").tasks ?? [],
);
check("the tick is in storage", stored.some((t) => t.title === "Email coach about Thursday" && t.done));

/* ---- habits: inline completion ---- */
const habits = page.locator("section", { has: page.getByText("Habits today", { exact: true }) });
check("all four habits are listed", (await habits.getByRole("checkbox").count()) === 4);
const stretch = habits.getByRole("checkbox", { name: "Mark Stretch done for today" });
check("an unticked habit starts unticked", (await stretch.getAttribute("aria-checked")) === "false");
await stretch.click();
await page.waitForTimeout(250);
check("habit ticks inline", (await stretch.getAttribute("aria-checked")) === "true");
/* Out of five, not four: the derived workout row counts toward the same total. */
check("the habit counter moves", (await habits.getByText("3/5").count()) === 1);

/* ---- money ---- */
const money = page.locator("section", { has: page.getByText("Money today", { exact: true }) });
check("money shows the month total", (await money.getByText(/This month/).count()) === 1);
check("money shows a balance", (await money.getByText("Balance").count()) === 1);
/* Budgets are gone from the whole app; make sure one cannot creep back in. */
check("money panel has no budget", (await money.getByText(/budget/i).count()) === 0);

/* ---- logged today ---- */
const logged = page.locator("section", { has: page.getByText("Logged today", { exact: true }) });
check("the check-in row links to Vitality", (await logged.getByRole("link", { name: /How the day went/ }).count()) === 1);
/* Notes are scratch space, not a daily journal, so the panel must not nag
   about one. */
check("no daily note row", (await logged.getByRole("link", { name: /Today's note/ }).count()) === 0);

/* The check-in row used to be able to claim a rating the provider invented. It is
   only ever true when a check-in is actually in storage, so a day nobody rated
   must read as not rated even though sleep, HRV and workouts around it are
   generated. */
const storedCheckIn = await page.evaluate((d) => {
  const s = JSON.parse(localStorage.getItem("personaos:checkins") ?? "{}");
  return (s.entries ?? []).some((e) => e.date === d);
}, localDayKey());
check("today is not in the check-in store", !storedCheckIn);
check(
  "the check-in row is not marked done",
  (await logged.getByRole("link", { name: /How the day went/ }).innerText()).includes("Not rated yet"),
  (await logged.getByRole("link", { name: /How the day went/ }).innerText()).replace(/\n/g, " | "),
);

/* ---- the weigh-in prompt: a prompt, not a record ---- */
/* It is owed whenever a cadence has passed, and it leaves the moment it is done,
   so it never lingers as a row that has already been dealt with. */
const weighIn = () => logged.getByRole("link", { name: /Weigh in/ });
const logWeightDaysAgo = (n) =>
  page.evaluate((days) => {
    const d = new Date();
    d.setDate(d.getDate() - days);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const s = JSON.parse(localStorage.getItem("personaos:weight-log") ?? "{}");
    s[key] = 150;
    localStorage.setItem("personaos:weight-log", JSON.stringify(s));
  }, n);

check("the weigh-in is asked for when there is none", (await weighIn().count()) === 1);
check("it carries the overdue mark", (await logged.locator('[title="Weigh-in overdue"]').count()) === 1);
check(
  "it says so in words as well as colour",
  (await weighIn().innerText()).includes("No weigh-in yet"),
  (await weighIn().innerText()).replace(/\n/g, " | "),
);
check("it links to the body tab", (await weighIn().getAttribute("href")) === "/body");
check("the mark is not a nested control", (await weighIn().locator("button").count()) === 0);

await logWeightDaysAgo(0);
await page.reload({ waitUntil: "load" });
await page.waitForTimeout(1200);
check("it disappears once logged today", (await weighIn().count()) === 0);

await page.evaluate(() => localStorage.removeItem("personaos:weight-log"));
await logWeightDaysAgo(13);
await page.reload({ waitUntil: "load" });
await page.waitForTimeout(1200);
check("it stays hidden 13 days in, before the cadence", (await weighIn().count()) === 0);

await page.evaluate(() => localStorage.removeItem("personaos:weight-log"));
await logWeightDaysAgo(14);
await page.reload({ waitUntil: "load" });
await page.waitForTimeout(1200);
check("it comes back on day 14", (await weighIn().count()) === 1);
check(
  "it says how long it has been",
  (await weighIn().innerText()).includes("14 days ago"),
  (await weighIn().innerText()).replace(/\n/g, " | "),
);
await page.evaluate(() => localStorage.removeItem("personaos:weight-log"));
await page.reload({ waitUntil: "load" });
await page.waitForTimeout(1000);

/* ---- the mobile nav: two groups, icons only ---- */
/* Both navs are in the DOM, but one is always display:none, so only the visible
   one is ever exposed to assistive tech. Scope to it the way a user sees it. */
const nav = page.locator('nav[aria-label="Primary"]:visible');
check("one nav is exposed at a time", (await nav.count()) === 1);
  check("six destinations", (await nav.getByRole("link").count()) === 6);
  for (const n of ["Home", "Vitality", "Plan", "Notes", "Money", "Mentor"]) {
  check(`  ${n} has an accessible name`, (await nav.getByRole("link", { name: n, exact: true }).count()) === 1);
}
check("no text labels leak into the mobile bar", (await nav.getByText("Vitality", { exact: true }).count()) === 0);

const home = nav.getByRole("link", { name: "Home", exact: true });
const vitality = nav.getByRole("link", { name: "Vitality", exact: true });
const hb = await home.boundingBox();
const vb = await vitality.boundingBox();
check("home button is circular", Math.abs(hb.width - hb.height) <= 1, `${Math.round(hb.width)}x${Math.round(hb.height)}`);
check("home is left of the four", hb.x < vb.x);
check("home is not crowded against the four", vb.x - (hb.x + hb.width) >= 8, `${Math.round(vb.x - hb.x - hb.width)}px gap`);
  /* Two of the six are deliberately outside the pill. Home and Mentor are the
     two the user arrives at rather than goes to look at something, and giving
     them their own circular buttons keeps the four destinations from reading as
     one crowded row. */
  check("home and mentor stand outside the pill", (await nav.locator(":scope > div > a").count()) === 2);
  check("the four share one pill", (await nav.locator(":scope > div > div > a").count()) === 4);
  const mentor = nav.getByRole("link", { name: "Mentor", exact: true });
  const mb = await mentor.boundingBox();
  check("mentor is right of the pill", mb.x > vb.x);
  check("mentor button is circular", Math.abs(mb.width - mb.height) <= 1, `${Math.round(mb.width)}x${Math.round(mb.height)}`);
check("Home is marked current", (await home.getAttribute("aria-current")) === "page");
check("bar sits at the bottom", hb.y + hb.height > 844 - 80, `y=${Math.round(hb.y)}`);

/* ---- the nav is the only frosted thing ---- */
const blur = await page.evaluate(() => {
  const all = [...document.querySelectorAll("body *")];
  const b = all.filter((el) => {
    const v = getComputedStyle(el).backdropFilter;
    return v && v !== "none";
  });
  return { total: b.length, stray: b.filter((el) => !el.closest("nav")).length };
});
check("glass is confined to the nav", blur.stray === 0, `${blur.total} blurred, ${blur.stray} stray`);

/* ---- the last thing on the page must sit just clear of the floating bar ---- */
await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
await page.waitForTimeout(400);
const gap = await page.evaluate(() => {
  const bar = [...document.querySelectorAll('nav[aria-label="Primary"]')].find(
    (n) => getComputedStyle(n).position === "fixed" && getComputedStyle(n).display !== "none",
  );
  const container = [...document.querySelectorAll("div")].find((d) =>
    String(d.className).includes("max-w-6xl"),
  );
  const last = container.children[container.children.length - 1];
  return Math.round(bar.getBoundingClientRect().top - last.getBoundingClientRect().bottom);
});
/* Positive is "not covered", small is "not floating in dead space". A guessed
   constant used to leave ~130px of nothing here. */
check("content clears the bar", gap > 0, `${gap}px`);
check("the gap below the last panel is not dead space", gap <= 24, `${gap}px`);
await page.evaluate(() => window.scrollTo(0, 0));

/* ---- no overflow either way, and desktop is untouched ---- */
for (const w of [390, 1440]) {
  await page.setViewportSize({ width: w, height: 900 });
  await page.goto(BASE + "/home", { waitUntil: "load" });
  await page.waitForTimeout(900);
  const o = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  check(`no overflow at ${w}px`, !o);
}

await page.setViewportSize({ width: 1440, height: 900 });
await page.goto(BASE + "/home", { waitUntil: "load" });
await page.waitForTimeout(900);
const deskNav = page.locator('nav[aria-label="Primary"]:visible');
check("desktop nav is the visible one", (await deskNav.count()) === 1);
check("desktop shows text labels", (await deskNav.getByText("Vitality", { exact: true }).count()) === 1);
  /* The mobile bar separates Home and Mentor from the four; the desktop tabs
     mirror that, so both navigations describe the same six places in the same
     order. */
  const deskHome = deskNav.getByRole("link", { name: "Home", exact: true });
  check("desktop has a Home tab", (await deskHome.count()) === 1);
  check("desktop lists six tabs plus the brand", (await deskNav.getByRole("link").count()) === 7);
/* textContent, not innerText: the brand is deliberately two spans so the intro
   can send the P somewhere on its own, and innerText reports the flex children
   separately. What matters is that the nav still reads PersonaOS. */
const deskOrder = (await deskNav.getByRole("link").evaluateAll((els) => els.map((e) => e.textContent).join(" "))).replace(/\s+/g, " ");
  check("Home leads the tabs", deskOrder === "PersonaOS Home Vitality Plan Notes Money Mentor", deskOrder);
check("desktop Home is current on /home", (await deskHome.getAttribute("aria-current")) === "page");
const deskBrand = await deskNav.getByRole("link").first().boundingBox();
const deskHomeBox = await deskHome.boundingBox();
check("the brand still sits left of the tabs", deskBrand !== null && deskHomeBox !== null && deskBrand.x < deskHomeBox.x);

/* A display:none element still reports its computed backdrop-filter, so glass
   has to be counted by what is actually painted, not by style alone. */
const desk = await page.evaluate(() => {
  const navs = [...document.querySelectorAll('nav[aria-label="Primary"]')];
  const blurred = [...document.querySelectorAll("body *")].filter((el) => {
    const v = getComputedStyle(el).backdropFilter;
    if (!v || v === "none") return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  });
  return {
    shownNavs: navs.filter((n) => getComputedStyle(n).display !== "none").length,
    paintedGlass: blurred.length,
  };
});
check("only one nav is rendered on desktop", desk.shownNavs === 1);
check("desktop paints no glass", desk.paintedGlass === 0, `${desk.paintedGlass} painted`);

check("console errors", errors.length === 0, errors.join(" | ") || "none");

await b.close();
console.log(failures ? `\n${failures} FAILING` : "\nall passing");
process.exit(failures ? 1 : 0);
