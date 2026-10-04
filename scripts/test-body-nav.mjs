import { launchBrowser } from "./auth-state.mjs";

const BASE = process.env.SHOT_URL ?? "http://localhost:3000";
const b = await launchBrowser();
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, colorScheme: "dark" });
const page = await ctx.newPage();
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(String(e)));

/* This file used to log what it saw and exit 0 either way, so nothing here
   could ever fail. Body is where the Home workout habit sends you, so the route
   is worth actually holding down. */
let failures = 0;
const check = (name, cond, extra = "") => {
  if (!cond) failures++;
  console.log(`${cond ? "ok  " : "FAIL"} ${name}${extra ? ` — ${extra}` : ""}`);
};

// 1. entry button present on /vitals
await page.goto(BASE + "/vitals", { waitUntil: "load" });
await page.waitForTimeout(1000);
const entry = page.getByRole("link", { name: /Body & training/ });
check("entry button on /vitals", (await entry.count()) === 1);
check("no body panels on /vitals", (await page.locator("text=PROGRESS PHOTOS").count()) === 0);
check("no body fat on /vitals", (await page.locator("text=BODY FAT").count()) === 0);
check("nav has no Body item", (await page.getByRole("link", { name: "Body", exact: true }).count()) === 0);

// 2. click through
await entry.click();
await page.waitForURL("**/body");
await page.waitForTimeout(1000);
check("navigated to /body", new URL(page.url()).pathname === "/body", new URL(page.url()).pathname);
check("back button on /body", (await page.getByRole("link", { name: /Back to Vitality/ }).count()) === 1);
check("body panels present", (await page.locator("text=PROGRESS PHOTOS").count()) > 0);
check(
  "Vitality still marked current in nav",
  (await page.getByRole("link", { name: "Vitality", exact: true }).getAttribute("aria-current")) === "page",
);

/* The workout habit on Home links straight here, so a cold open of /body has to
   land on a usable page rather than a dead route. */
await page.goto(BASE + "/body", { waitUntil: "load" });
await page.waitForTimeout(1000);
check("/body opens directly", new URL(page.url()).pathname === "/body");
check("the strength log is there", (await page.getByText("Strength log").count()) > 0);
check("the weight log is there", (await page.getByText(/Weight log|Weigh/i).count()) > 0);

/* The two boxes that finish side by side have to finish at the same height. The
   grid gap does nothing about a difference in height, so an unequal pair leaves
   a hole beside the bottom of the taller one, and a hole reads as a panel that
   failed to render rather than as two columns of different lengths.

   Measured rather than asserted against a class name, because the whole thing is
   arithmetic on content heights — there is no class to check. The streak is given
   `flex-1` and grows to its neighbour's height, so the two edges should meet
   exactly; the tolerance is for subpixel rounding on the panel borders.

   Measured at desktop width because that is the only place it can go wrong.
   Below `lg` the grid is one column, so the panels stack and no pair of them
   ever shares a row — the alignment is a property of the two-column arrangement
   and nothing else. The viewport is put back afterwards, because the rest of this
   file is a phone. */
{
  const phone = page.viewportSize();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(400);
  const off = await page.evaluate(() => {
    const byLabel = (label) =>
      [...document.querySelectorAll(".panel")].find(
        (el) => el.querySelector(".label-xs")?.textContent?.trim() === label,
      );
    const streak = byLabel("Lifting streak");
    const bests = byLabel("Personal bests");
    if (!streak || !bests) return null;
    return Math.round(
      Math.abs(
        streak.getBoundingClientRect().bottom - bests.getBoundingClientRect().bottom,
      ),
    );
  });
  check(
    "the lifting streak stretches down to finish level with personal bests",
    off !== null && off <= 2,
    off === null ? "could not find both panels" : `${off}px apart`,
  );
  await page.setViewportSize(phone);
  await page.waitForTimeout(200);
}

// 3. back
await page.goto(BASE + "/body", { waitUntil: "load" });
await page.waitForTimeout(800);
await page.getByRole("link", { name: /Back to Vitality/ }).click();
await page.waitForURL((u) => new URL(u).pathname === "/vitals");
await page.waitForTimeout(1000);
check("returned to /vitals", new URL(page.url()).pathname === "/vitals");

// 4. no overflow on /body at both widths
for (const w of [390, 1440]) {
  await page.setViewportSize({ width: w, height: 900 });
  await page.goto(BASE + "/body", { waitUntil: "load" });
  await page.waitForTimeout(800);
  const o = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  check(`no overflow-x at ${w}px`, !o);
}

check("no console errors", errors.length === 0, errors.join(" / ") || "none");

/* ---- the server and the client have to be running the same code ----
   Editing a file while the dev server is up can leave it serving a stale
   module for SSR while the browser fetches the new one, and the only symptom is
   a hydration mismatch on one string. React recovers from it, so the page still
   works and the suite still passed, which is exactly why it needs pinning down:
   the server's HTML is compared against what the client renders for the text
   that only exists on one side of the boundary. */
for (const route of ["/body", "/", "/home", "/vitals", "/tasks", "/notes", "/money"]) {
  const res = await fetch(BASE + route).catch(() => null);
  const html = res ? await res.text() : "";
  errors.length = 0;
  await page.goto(BASE + route, { waitUntil: "load" });
  await page.waitForTimeout(1200);
  const hydration = errors.filter((e) => /hydrat|did not match|Text content/i.test(e));
  check(`no hydration error on ${route}`, hydration.length === 0, hydration.join(" / ") || "none");
  /* The strength panel's empty state is server-rendered, so a stale SSR chunk
     shows up here as the server carrying wording the client no longer has. */
  const stale = /then swipe one across/.test(html) && !/then drag one across/.test(html);
  check(`server HTML is not stale on ${route}`, !stale);
}

await b.close();
console.log(failures ? `\n${failures} FAILING` : "\nall passing");
process.exit(failures ? 1 : 0);
