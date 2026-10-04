import { chromium } from "@playwright/test";

const URL = process.env.SHOT_URL ?? "http://localhost:3000";
const targets = [
  { name: "mobile", width: 390, height: 844, dsf: 2 },
  { name: "desktop", width: 1440, height: 900, dsf: 1 },
];

const browser = await chromium.launch();
const problems = [];

for (const t of targets) {
  const ctx = await browser.newContext({
    viewport: { width: t.width, height: t.height },
    deviceScaleFactor: t.dsf,
    colorScheme: "dark",
  });
  const page = await ctx.newPage();
  page.on("console", (m) => {
    if (m.type() === "error") problems.push(`[${t.name}] console: ${m.text()}`);
  });
  page.on("pageerror", (e) => problems.push(`[${t.name}] pageerror: ${e.message}`));

  const res = await page.goto(URL, { waitUntil: "load", timeout: 60_000 });
  if (!res || res.status() >= 400) problems.push(`[${t.name}] http status ${res?.status()}`);

  // let the ring count-up and glow settle
  await page.waitForTimeout(1600);
  await page.screenshot({ path: `shots/${t.name}.png`, fullPage: true });
  console.log(`${t.name}: captured`);
  await ctx.close();
}

await browser.close();
console.log(problems.length ? `\nPROBLEMS:\n${problems.join("\n")}` : "\nno console errors");
