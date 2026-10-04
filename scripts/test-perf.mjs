import { launchBrowser } from "./auth-state.mjs";

/* Frame budget, measured rather than asserted by eye.

   Run this against a PRODUCTION build, not the dev server:
     npm run build && npx next start -p 3210
     $env:SHOT_URL = "http://localhost:3210"; node scripts/test-perf.mjs
   Against `next dev` the same code measures 20-40 dropped frames per page, all
   of it unminified React and StrictMode's double render. That is not what runs
   on a phone, and tuning against it means tuning against noise.

   The claim under test is that the motion does not cost smoothness. The second
   run below forces prefers-reduced-motion, which switches the motion off
   without changing the code, and is the baseline to compare against. The app
   already animates a canvas of particles, so the only fair question is whether
   the new work is worse than what was already there.

   Absolute gates, because the A/B difference on a shared machine is itself
   noisy: a dropped frame here and there is not jank, a burst of them is. What
   must never happen is a long task, or a frame bad enough to read as a hitch. */

const BASE = process.env.SHOT_URL ?? "http://localhost:3000";
const ROUTES = ["/body", "/vitals", "/home", "/notes"];
const b = await launchBrowser();

const install = (page) =>
  page.evaluate(() => {
    window.__perf = { deltas: [], long: [] };
    try {
      new PerformanceObserver((l) => {
        for (const e of l.getEntries()) window.__perf.long.push(Math.round(e.duration));
      }).observe({ entryTypes: ["longtask"] });
    } catch {
      /* longtask unsupported: the frame deltas below still carry the signal */
    }
    let last = performance.now();
    let run = true;
    const tick = (t) => {
      if (!run) return;
      window.__perf.deltas.push(t - last);
      last = t;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    window.__perfStop = () => {
      run = false;
    };
  });

const read = (page) =>
  page.evaluate(() => {
    const d = window.__perf.deltas.slice(2);
    const sorted = [...d].sort((a, b) => a - b);
    return {
      frames: d.length,
      median: +(sorted[Math.floor(sorted.length / 2)] || 0).toFixed(1),
      p95: +(sorted[Math.floor(sorted.length * 0.95)] || 0).toFixed(1),
      max: +(sorted[sorted.length - 1] || 0).toFixed(1),
      over32: d.filter((x) => x > 32).length,
      over50: d.filter((x) => x > 50).length,
      long: window.__perf.long,
    };
  });

async function run(reduced) {
  const ctx = await b.newContext({
    viewport: { width: 390, height: 844 },
    colorScheme: "dark",
    reducedMotion: reduced ? "reduce" : "no-preference",
  });
  const out = {};
  for (const route of ROUTES) {
    const page = await ctx.newPage();
    await page.goto(BASE + route, { waitUntil: "load" });
    await page.waitForTimeout(2000);
    await install(page);
    /* Real wheel scrolling, top to bottom and back, which is what triggers the
       IntersectionObserver reveals and the progress hairline. */
    for (let i = 0; i < 26; i++) {
      await page.mouse.wheel(0, 220);
      await page.waitForTimeout(45);
    }
    for (let i = 0; i < 20; i++) {
      await page.mouse.wheel(0, -260);
      await page.waitForTimeout(45);
    }
    await page.waitForTimeout(400);
    out[route] = await read(page);
    /* Guard the measurement itself. An earlier version of the reveal left
       panels stranded at opacity 0 under StrictMode, which made every frame look
       free because there was nothing left to paint. If a panel is still hidden
       once the whole page has been scrolled through, the timings below are
       measuring an empty page and mean nothing. */
    out[route].stranded = await page.evaluate(() =>
      [...document.querySelectorAll(".panel")].filter(
        (e) => e.hasAttribute("data-reveal") && !e.hasAttribute("data-shown"),
      ).length,
    );
    out[route].panels = await page.evaluate(() => document.querySelectorAll(".panel").length);
    await page.evaluate(() => window.__perfStop());
    await page.close();
  }
  await ctx.close();
  return out;
}

const motion = await run(false);
const baseline = await run(true);

let bad = 0;
const check = (n, c, x = "") => {
  if (!c) bad++;
  console.log(`${c ? "ok  " : "FAIL"} ${n}${x ? ` — ${x}` : ""}`);
};

console.log("route     metric        motion     reduced-motion");
for (const route of ROUTES) {
  const m = motion[route];
  const r = baseline[route];
  console.log(
    `${route.padEnd(9)} median       ${String(m.median).padStart(6)}ms   ${String(r.median).padStart(6)}ms` +
      `\n${"".padEnd(9)} p95          ${String(m.p95).padStart(6)}ms   ${String(r.p95).padStart(6)}ms` +
      `\n${"".padEnd(9)} worst frame  ${String(m.max).padStart(6)}ms   ${String(r.max).padStart(6)}ms` +
      `\n${"".padEnd(9)} frames >32ms ${String(m.over32).padStart(6)}     ${String(r.over32).padStart(6)}` +
      `\n${"".padEnd(9)} frames >50ms ${String(m.over50).padStart(6)}     ${String(r.over50).padStart(6)}` +
      `\n${"".padEnd(9)} long tasks   ${String(m.long.length).padStart(6)}     ${String(r.long.length).padStart(6)}`,
  );
  console.log("");
}

for (const route of ROUTES) {
  const m = motion[route];
  const r = baseline[route];
  check(
    `${route}: every panel ended up visible`,
    m.stranded === 0,
    `${m.stranded} of ${m.panels} stranded hidden`,
  );
  check(`${route}: no long task while scrolling`, m.long.length === 0, m.long.join(",") || "none");
  check(
    `${route}: median frame is a smooth 60fps-ish`,
    m.median < 22,
    `${m.median}ms`,
  );
  check(
    `${route}: 95% of frames are 60fps`,
    m.p95 < 25,
    `p95 ${m.p95}ms`,
  );
  /* Two vsync intervals is a dropped frame; three is the point where it starts
     reading as a stutter rather than a blip. */
  check(
    `${route}: no frame is worse than a stutter`,
    m.max < 50,
    `worst ${m.max}ms`,
  );
  check(
    `${route}: under 5% of frames dropped`,
    m.over32 / Math.max(1, m.frames) < 0.05,
    `${m.over32} of ${m.frames}`,
  );
  check(
    `${route}: no worse than the no-motion baseline`,
    m.p95 <= r.p95 + 10,
    `p95 ${m.p95}ms vs ${r.p95}ms`,
  );
}

console.log(bad ? `\n${bad} FAILING` : "\nall passing");
await b.close();
process.exit(bad ? 1 : 0);
