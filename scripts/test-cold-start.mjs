/**
 * Reproduces the cold-start intro without needing a session.
 *
 * The intro lives in the root layout, so it runs on "/" as well as "/home" — the
 * only thing /home adds is the panels behind it. Arming the cookie and loading
 * "/" therefore exercises BrandMorph, the flight, the hand-off and the release
 * with no auth at all, which is what makes this runnable when the browser is
 * already signed in.
 *
 * The regression being hunted is a renderer hang: "page stopped working" is
 * Chrome killing the tab, which is a loop or an allocation rather than a thrown
 * exception. So this watches for the tab surviving, not for console output.
 */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const TIMEOUT_MS = 20_000;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(`console: ${m.text()}`);
});
page.on("crash", () => errors.push("PAGE CRASHED (renderer killed)"));

/* Armed before any navigation, so the probe in <head> reads it on the very first
   frame — which is the condition that failed. Setting it afterwards would miss
   the pre-paint window entirely. */
await page.context().addCookies([
  {
    name: "personaos-intro",
    value: String(Date.now()),
    url: BASE,
    maxAge: 60,
  },
]);

console.log("armed personaos-intro, loading / ...");

let outcome = "completed with no error";
try {
  await page.goto(BASE + "/", { waitUntil: "load", timeout: TIMEOUT_MS });
  /* Long enough for the 0.68s flight, the assemble beat, and the 600ms settle
     timer, with margin for a slow first compile. */
  await page.waitForTimeout(6_000);
} catch (e) {
  outcome = `FAILED: ${e.message.split("\n")[0]}`;
}

const intro = await page
  .evaluate(() => document.documentElement.getAttribute("data-intro"))
  .catch(() => "<evaluate failed — page is gone>");

console.log(`outcome:  ${outcome}`);
console.log(`data-intro after settle: ${intro}`);
console.log(errors.length ? `errors:\n  ${errors.join("\n  ")}` : "errors: none");

await browser.close();
process.exit(outcome.startsWith("FAILED") || errors.length ? 1 : 0);