/**
 * Loads /home with the intro armed and the tab watched for a crash.
 *
 * Separate from test-cold-start.mjs because this one needs a session, and the
 * browser that has one is the user's own — this cannot run headless without
 * storage state. What it does do that the cold-start test cannot is exercise the
 * panels and the stores behind them, which is where the difference between /
 * (works, verified) and /home (crashes) actually lives.
 *
 * Paste the printed storage state into a .env file or set STORAGE_STATE to a
 * JSON file exported from the working browser profile if you want this to run
 * unattended. Without it, it loads the sign-in card and says so.
 */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const statePath = process.env.STORAGE_STATE;

const browser = await chromium.launch();
const options = { viewport: { width: 1280, height: 900 } };
if (statePath) {
  options.storageState = JSON.parse(readFileSync(statePath, "utf8"));
}
const page = await browser.newPage(options);

const problems = [];
page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
page.on("console", (m) => {
  if (m.type() === "error") problems.push(`console: ${m.text()}`);
});
page.on("crash", () => problems.push("PAGE CRASHED (renderer killed)"));

await page.context().addCookies([
  { name: "personaos-intro", value: String(Date.now()), url: BASE, maxAge: 60 },
]);

await page.goto(BASE + "/home", { waitUntil: "load", timeout: 20_000 }).catch((e) => {
  problems.push(`goto: ${e.message.split("\n")[0]}`);
});

/* Checked on the URL, not the status: goto follows redirects, so the response
   handed back is the final one and its status says nothing about whether /home
   ever rendered. Landing on "/" means the proxy sent us to the sign-in card and
   nothing about Home was exercised. */
const landed = new URL(page.url()).pathname;
if (landed !== "/home") {
  console.log(`landed on ${landed} — no session, so /home never rendered. Nothing was tested.`);
} else {
  await page.waitForTimeout(6_000).catch(() => {});
  const intro = await page
    .evaluate(() => document.documentElement.getAttribute("data-intro"))
    .catch(() => "<gone>");
  console.log(`data-intro after settle: ${intro}`);
}

console.log(problems.length ? `problems:\n  ${problems.join("\n  ")}` : "problems: none");
await browser.close();