import { chromium } from "@playwright/test";

const URL = (process.env.SHOT_URL ?? "http://localhost:3000/") + (process.env.SHOT_PATH ?? "home");
const WIDTH = Number(process.env.PERF_W ?? 390);
const HEIGHT = Number(process.env.PERF_H ?? 844);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT } });
const page = await ctx.newPage();
await page.goto(URL, { waitUntil: "load" });
await page.waitForTimeout(1800);

const stats = await page.evaluate(async () => {
  const frames = [];
  let last = performance.now();
  let running = true;
  const loop = () => {
    const now = performance.now();
    frames.push(now - last);
    last = now;
    if (running) requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);

  const height = document.body.scrollHeight;
  for (let y = 0; y <= height; y += 240) {
    window.scrollTo(0, y);
    await new Promise((r) => requestAnimationFrame(r));
  }
  running = false;
  await new Promise((r) => setTimeout(r, 60));

  const d = frames.filter((f) => f > 0).sort((a, b) => a - b);
  return {
    frames: d.length,
    avgMs: +(d.reduce((a, b) => a + b, 0) / d.length).toFixed(2),
    p95Ms: +d[Math.floor(d.length * 0.95)].toFixed(2),
    worstMs: +d[d.length - 1].toFixed(2),
    dropped: d.filter((f) => f > 32).length,
  };
});

console.log(`${WIDTH}x${HEIGHT} ${URL}`);
console.log(JSON.stringify(stats, null, 2));
await browser.close();
