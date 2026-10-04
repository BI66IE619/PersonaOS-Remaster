import { chromium } from "@playwright/test";

const browser = await chromium.launch();
const page = await (
  await browser.newContext({ viewport: { width: 390, height: 844 } })
).newPage();
await page.goto((process.env.SHOT_URL ?? "http://localhost:3000") + (process.env.SHOT_PATH ?? "/home"), {
  waitUntil: "load",
});
await page.waitForTimeout(2500);

const out = await page.evaluate(() => {
  const all = [...document.querySelectorAll("body *")];
  const blurred = all.filter((el) => {
    const v = getComputedStyle(el).backdropFilter;
    return v && v !== "none";
  });

  /* Frost is only allowed on the mobile nav bar, which is pinned and therefore
     costs one fixed blur instead of a recomposite per scroll frame. Both navs
     are in the DOM, so match any nav rather than the first one. */
  const strayBlur = blurred
    .filter((el) => !el.closest("nav"))
    .map((el) => `${el.tagName}.${String(el.className).slice(0, 40)}`);

  const shape = (el) => `${el.tagName}.${String(el.className).slice(0, 40)}`;
  const navGlass = blurred.filter((el) => el.closest("nav")).map(shape);

  const canvas = document.querySelector("canvas");
  let painted = 0;
  if (canvas) {
    const c = canvas.getContext("2d");
    const { data } = c.getImageData(0, 0, canvas.width, canvas.height);
    for (let i = 3; i < data.length; i += 4) if (data[i] > 0) painted++;
  }

  return {
    backdropFilterElements: blurred.length,
    navGlass,
    strayBlur,
    canvasPresent: Boolean(canvas),
    canvasSize: canvas ? `${canvas.width}x${canvas.height}` : null,
    litPixels: painted,
    panels: document.querySelectorAll("main .panel").length,
  };
});

console.log(JSON.stringify(out, null, 2));
await browser.close();
