/* The page fade, asserted rather than assumed.
 *
 * The bug this guards is a quiet one: a fade that works in a storybook and
 * never fires in the app because the component it lives in is remounted by
 * every navigation, and a remount looks exactly like a first load. So this drives
 * a real nav click and watches the animation, and it also loads a page cold to
 * prove the fade is *not* there — a fade on first paint is the other failure,
 * because the server render has to be the real page and not a transparent one. */

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

const fade = page.locator("[data-page-fade]");

/* ---- cold load: the page is simply there ---- */
await page.goto(`${BASE}/home`, { waitUntil: "load" });
await page.waitForTimeout(1000);
check("there is a fade wrapper to watch", (await fade.count()) === 1, String(await fade.count()));
check("which is the real page, not a transparent one", Number(await fade.evaluate((el) => getComputedStyle(el).opacity)) === 1, await fade.evaluate((el) => getComputedStyle(el).opacity));
check("and no fade ran on the first load", (await fade.getAttribute("data-entering")) === null, String(await fade.getAttribute("data-entering")));
check("Home rendered", (await page.getByText(/Logged today/).count()) === 1);

/* ---- the navigation that matters ----
   Click the nav rather than calling the router, so this goes through whatever
   the user actually touches. The animation name is read mid-flight: reading it
   afterwards would only prove the attribute was set at some point. */
/* The wrapper lives in the root layout, so it is the same DOM node before and
   after a navigation — which is the whole reason the fade can be watched from
   the outside at all, and worth asserting rather than assuming. Marked with an
   attribute, because a handle cannot be carried across an evaluate. */
/* Sampling a fixed number of milliseconds after the click is how this test
   first reported a fade that had plainly played: in dev the route compiles on
   demand, so 120ms can land before the navigation has even committed. So the
   opacity is sampled every frame across the whole window instead, and the
   assertion is on the lowest value seen — which is the real question anyway.
   A fade that started and finished between two polls is still a fade. */
await fade.evaluate((el) => el.setAttribute("data-fade-watch", "1"));
await page.evaluate(() => {
  window.__fades = [];
  window.__minOpacity = 1;
  document.addEventListener(
    "animationstart",
    (e) => {
      if (e.target instanceof HTMLElement && e.target.hasAttribute("data-page-fade")) {
        window.__fades.push(e.animationName);
      }
    },
    true,
  );
  const sample = () => {
    const el = document.querySelector("[data-page-fade]");
    if (el) window.__minOpacity = Math.min(window.__minOpacity, Number(getComputedStyle(el).opacity));
    window.__raf = requestAnimationFrame(sample);
  };
  window.__raf = requestAnimationFrame(sample);
});

/** Click a nav link, sample the fade, and wait for it to settle. */
const navigate = async (name) => {
  await page.evaluate(() => {
    window.__fades = [];
    window.__minOpacity = 1;
  });
  await page.getByRole("link", { name, exact: true }).first().click();
  await page.waitForFunction(() => (window.__fades ?? []).length > 0, null, { timeout: 15000 });
  await page.waitForFunction(
    () => Number(getComputedStyle(document.querySelector("[data-page-fade]")).opacity) === 1,
    null,
    { timeout: 15000 },
  );
  return {
    fades: await page.evaluate(() => window.__fades ?? []),
    minOpacity: await page.evaluate(() => window.__minOpacity),
  };
};

const first = await navigate("Plan");
check("the route changed", new URL(page.url()).pathname === "/tasks", new URL(page.url()).pathname);
check("and it is the same wrapper element, not a fresh mount", (await fade.getAttribute("data-fade-watch")) === "1");
check("a fade actually played on the navigation", first.fades.length > 0, JSON.stringify(first.fades));
check("it was the page fade, not some other animation", first.fades.includes("page-in"), JSON.stringify(first.fades));
check("the page really did dim, rather than snapping straight to full", first.minOpacity < 1, `lowest opacity ${first.minOpacity}`);
check("and it settles fully opaque", Number(await fade.evaluate((el) => getComputedStyle(el).opacity)) === 1, await fade.evaluate((el) => getComputedStyle(el).opacity));
check("with the attribute cleared, so the next one can play", (await fade.getAttribute("data-entering")) === null);
check("the arrived page is readable", (await page.getByRole("heading", { name: "Plan", exact: true }).count()) === 1);

/* ---- twice more, because a fade that only works the first time is the
   specific failure the clear-and-re-arm is there to prevent ---- */
for (const [name, path] of [["Vitality", "/vitals"], ["Notes", "/notes"]]) {
  const n = await navigate(name);
  check(`a second navigation fades too — ${name}`, n.fades.includes("page-in"), JSON.stringify(n.fades));
  check(`and it dims there as well — ${name}`, n.minOpacity < 1, `lowest opacity ${n.minOpacity}`);
  check(`and lands on ${path}`, new URL(page.url()).pathname === path, new URL(page.url()).pathname);
  check(`staying fully opaque on ${path}`, Number(await fade.evaluate((el) => getComputedStyle(el).opacity)) === 1);
}

/* ---- back navigation ----
   Home -> Plan -> Vitality -> Notes, so back lands on Vitality. */
await page.evaluate(() => {
  window.__fades = [];
  window.__minOpacity = 1;
});
await page.goBack();
await page.waitForFunction(() => (window.__fades ?? []).length > 0, null, { timeout: 15000 });
await page.waitForFunction(
  () => Number(getComputedStyle(document.querySelector("[data-page-fade]")).opacity) === 1,
  null,
  { timeout: 15000 },
);
const back = await page.evaluate(() => window.__fades ?? []);
check("going back fades as well", back.length > 0, JSON.stringify(back));
check("and lands on the page it came from", new URL(page.url()).pathname === "/vitals", new URL(page.url()).pathname);
check("fully opaque after a back navigation", Number(await fade.evaluate((el) => getComputedStyle(el).opacity)) === 1);

/* ---- reduced motion ----
   The fade is the one thing that must not move when the system has asked for
   stillness, so the rule is asserted directly rather than inferred from a
   passing visual check. */
await ctx.close();
const reduced = await b.newContext({
  viewport: { width: 390, height: 844 },
  colorScheme: "dark",
  reducedMotion: "reduce",
});
const rp = await reduced.newPage();
await rp.goto(`${BASE}/home`, { waitUntil: "load" });
await rp.waitForTimeout(600);
await rp.getByRole("link", { name: "Plan" }).first().click();
await rp.waitForTimeout(1200);
check("with reduced motion the page is still opaque", Number(await rp.locator("[data-page-fade]").evaluate((el) => getComputedStyle(el).opacity)) === 1);
check("and the fade is turned off", (await rp.locator("[data-page-fade]").evaluate((el) => getComputedStyle(el).animationName)) === "none", await rp.locator("[data-page-fade]").evaluate((el) => getComputedStyle(el).animationName));
check("the page still arrived", new URL(rp.url()).pathname === "/tasks", new URL(rp.url()).pathname);

check("console errors", errors.length === 0, errors.join(" / "));
console.log(failures ? `\n${failures} FAILING` : "\nall passing");
await b.close();
process.exit(failures ? 1 : 0);
