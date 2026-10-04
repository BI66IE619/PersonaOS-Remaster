import { chromium } from "@playwright/test";

const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: 390, height: 844 } })).newPage();
await p.goto((process.env.SHOT_URL ?? "http://localhost:3000") + (process.env.SHOT_PATH ?? "/home"), {
  waitUntil: "load",
});
await p.waitForTimeout(2000);

const out = await p.evaluate(() => {
  const blurred = [...document.querySelectorAll("body *")].filter((el) => {
    const v = getComputedStyle(el).backdropFilter;
    return v && v !== "none";
  });

  const shape = (el) => `${el.tagName}.${String(el.className).slice(0, 60)}`;

  /* The mobile nav bar is the one sanctioned frosted surface. Anything blurred
     outside it is a regression, because frosted content panels wash out data
     and the particle field is the cheaper way to get depth. */
  return {
    total: blurred.length,
    inNav: blurred.filter((el) => el.closest("nav")).map(shape),
    stray: blurred.filter((el) => !el.closest("nav")).map(shape),
  };
});

console.log(`hits: ${out.total} (${out.inNav.length} in nav, ${out.stray.length} stray)`);
for (const h of out.inNav) console.log("  nav  |", h);
for (const h of out.stray) console.log("  STRAY |", h);
await b.close();
