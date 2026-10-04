import { launchBrowser } from "./auth-state.mjs";

/* Desktop nav pill: it must exist, sit on the active link, and slide when the
   route changes. */
const BASE = process.env.SHOT_URL ?? "http://localhost:3000";
const b = await launchBrowser();
const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });
const page = await ctx.newPage();
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(String(e)));

let failures = 0;
const check = (name, cond, extra = "") => {
  if (!cond) failures++;
  console.log(`${cond ? "ok  " : "FAIL"} ${name}${extra ? ` — ${extra}` : ""}`);
};

await page.goto(`${BASE}/home`, { waitUntil: "load" });
await page.waitForTimeout(1500);

const pill = page.locator('nav[aria-label="Primary"] span[aria-hidden]');
check("pill exists", (await pill.count()) === 1);
const before = await pill.evaluate((el) => el.getBoundingClientRect().x);
const homeLink = page.getByRole("link", { name: "Home", exact: true }).last();
const linkX = await homeLink.evaluate((el) => el.getBoundingClientRect().x);
check("pill sits on the active link", Math.abs(before - linkX) < 2, `pill ${before} vs link ${linkX}`);

await page.getByRole("link", { name: "Notes", exact: true }).click();
/* Poll through the transition: a slide passes through positions strictly
   between the two tabs; a teleport never does. */
const samples = [];
for (let i = 0; i < 25; i++) {
  samples.push(await pill.evaluate((el) => el.getBoundingClientRect().x));
  await page.waitForTimeout(40);
}
const after = samples[samples.length - 1];
const notesX = await page.getByRole("link", { name: "Notes", exact: true }).evaluate((el) => el.getBoundingClientRect().x);
check("pill moved with the route", after !== before, `${before} -> ${after}`);
check("pill landed on Notes", Math.abs(after - notesX) < 2, `pill ${after} vs link ${notesX}`);
const lo = Math.min(before, after) + 1;
const hi = Math.max(before, after) - 1;
check(
  "it slid rather than teleported",
  samples.some((x) => x > lo && x < hi),
  `samples ${samples.map((x) => Math.round(x)).join(",")}`,
);
check(
  /* Pinned deliberately. The pill is matched to --dur-page so the highlight and
     the page fade land together, and this is what stops them drifting apart
     again: shortening one without the other is the exact regression this caught
     the first time, when a 200ms pill outlived a 160ms fade.

     The token is compared in milliseconds rather than as written, because a
     custom property holding a time comes back computed — 160ms arrives as
     ".16s" — and pinning the exact string would make this a test of the
     browser's serialisation instead of of the duration. */
  "a slide transition is actually applied, and matches the page fade",
  (await pill.evaluate((el) => getComputedStyle(el).transitionDuration)) === "0.14s" &&
    (await page
      .locator("[data-page-fade]")
      .evaluate((el) => {
        const v = getComputedStyle(el).getPropertyValue("--dur-page").trim();
        return v.endsWith("ms") ? parseFloat(v) : parseFloat(v) * 1000;
      })) === 160,
);
check("no hydration errors", errors.filter((e) => /hydration/i.test(e)).length === 0, errors.join(" | ") || "none");

await b.close();
console.log(failures ? `\n${failures} FAILING` : "\nall passing");
process.exit(failures ? 1 : 0);
