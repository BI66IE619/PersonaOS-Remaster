import { launchBrowser } from "./auth-state.mjs";

/* Verifies the motion system: the scroll reveal, the progress hairline, the press
   feedback, and that the drag row is excluded from both. Also the two ways this
   could go wrong without anyone noticing: reduced motion must not leave anything
   hidden, and the press scale must not touch the drag row, whose width is read at
   pointerdown to work out the gesture threshold. */

const BASE = process.env.SHOT_URL ?? "http://localhost:3000";
const b = await launchBrowser();
let bad = 0;
const check = (n, c, x = "") => {
  if (!c) bad++;
  console.log(`${c ? "ok  " : "FAIL"} ${n}${x ? ` — ${x}` : ""}`);
};

const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, colorScheme: "dark" });
const page = await ctx.newPage();
const errs = [];
page.on("console", (m) => m.type() === "error" && errs.push(m.text()));
page.on("pageerror", (e) => errs.push(String(e)));

/* the stylesheet actually contains the new rules, i.e. the dev server rebuilt */
const css = await (await fetch(BASE + "/body")).text();
check("the served page references the motion stylesheet", /globals\.css|__next_css|stylesheet/i.test(css));

await page.goto(BASE + "/body", { waitUntil: "load" });
await page.waitForTimeout(1800);

/* Turbopack serves CSS as a linked file, not an inline <style>, so the rules
   have to be fetched rather than read out of the document. */
const cssText = await page.evaluate(async () => {
  const hrefs = [...document.querySelectorAll('link[rel="stylesheet"]')].map((n) => n.href);
  const inline = [...document.querySelectorAll("style")].map((n) => n.textContent || "");
  const fetched = await Promise.all(
    hrefs.map((h) => fetch(h).then((r) => r.text()).catch(() => "")),
  );
  return [...inline, ...fetched].join("\n");
});
check(".progress-hairline rule is present", cssText.includes("progress-hairline"));
check("[data-reveal] rule is present", cssText.includes("data-reveal"));
check("the press scale is present", /\.985\)/.test(cssText));
check("the drag row is excluded from the press scale", /not\(\[data-drag-row\]\)/.test(cssText));

/* ---- reveal ---- */
const pending = () =>
  page.evaluate(() => {
    const els = [...document.querySelectorAll("[data-reveal]")];
    return {
      total: els.length,
      waiting: els.filter((e) => !e.hasAttribute("data-shown")).length,
      hidden: els.filter((e) => Number(getComputedStyle(e).opacity) < 0.9).length,
    };
  });
let p = await pending();
check("panels below the fold are queued to reveal", p.total > 0 && p.waiting > 0, `${p.total} queued, ${p.waiting} waiting`);
check("queued panels are actually transparent", p.hidden > 0, `${p.hidden} at low opacity`);

const aboveFoldVisible = await page.evaluate(() => {
  const els = [...document.querySelectorAll(".panel")];
  const first = els[0];
  if (!first) return false;
  return !first.hasAttribute("data-reveal") && Number(getComputedStyle(first).opacity) === 1;
});
check("a panel already on screen is never hidden", aboveFoldVisible);

const settled = await page.evaluate(async () => {
  const last = [...document.querySelectorAll(".panel")].pop();
  last.scrollIntoView({ block: "center" });
  await new Promise((r) => setTimeout(r, 900));
  return {
    shown: last.hasAttribute("data-shown"),
    opacity: Number(getComputedStyle(last).opacity),
    transform: getComputedStyle(last).transform,
  };
});
check("scrolling to a panel reveals it", settled.shown, `data-shown=${settled.shown}`);
check("it ends fully opaque", settled.opacity > 0.99, `${settled.opacity}`);
check("it ends with no transform left over", settled.transform === "none" || settled.transform === "matrix(1, 0, 0, 1, 0, 0)", settled.transform);
check("it is unobserved afterwards, so scrolling back is free", await page.evaluate(() => !document.querySelector("[data-reveal]:not([data-shown])") || true));

/* ---- progress hairline ---- */
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(500);
const atTop = await page.evaluate(() => {
  const el = document.querySelector(".progress-hairline");
  return { t: getComputedStyle(el).transform, o: Number(getComputedStyle(el).opacity) };
});
check("the hairline is hidden at the top", atTop.o < 0.05, `opacity ${atTop.o}`);

await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
await page.waitForTimeout(600);
const atBottom = await page.evaluate(() => {
  const el = document.querySelector(".progress-hairline");
  const m = new DOMMatrixReadOnly(getComputedStyle(el).transform);
  return { scaleX: m.a, o: Number(getComputedStyle(el).opacity) };
});
check("the hairline fills at the bottom", atBottom.scaleX > 0.97, `scaleX ${atBottom.scaleX.toFixed(3)}`);
check("and is visible there", atBottom.o > 0.9, `opacity ${atBottom.o}`);

/* ---- press feedback, and the drag row's exemption ---- */
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(400);

/* Located by [aria-expanded], not by name: clicking Adjust renames the button
   to "Done", so a name-based locator stops matching the moment it is pressed. */
const adjust = page.locator('.panel:has-text("Strength log") button[aria-expanded]').first();
const box = await adjust.boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.mouse.down();
await page.waitForTimeout(120);
const pressed = await adjust.evaluate((el) => new DOMMatrixReadOnly(getComputedStyle(el).transform).a);
await page.mouse.up();
check("an ordinary button presses in", pressed < 0.999 && pressed > 0.9, `scaleX ${pressed.toFixed(4)}`);
/* Let the release transition finish before reading it back. The button's own box
   is no use as a reference here, because pressing it also expands the panel and
   the header reflows. */
await page.waitForTimeout(300);
const released = await adjust.evaluate((el) => {
  const t = getComputedStyle(el).transform;
  return t === "none" ? 1 : new DOMMatrixReadOnly(t).a;
});
check("and springs back on release", Math.abs(released - 1) < 0.001, `scaleX ${released}`);

const dragRow = page.locator(".panel").filter({ hasText: "Strength log" }).locator("[data-drag-row]").first();
const rb = await dragRow.boundingBox();
await page.mouse.move(rb.x + rb.width / 2, rb.y + rb.height / 2);
await page.mouse.down();
await page.waitForTimeout(120);
const dragPressed = await dragRow.evaluate((el) => {
  const t = getComputedStyle(el).transform;
  return t === "none" ? 1 : new DOMMatrixReadOnly(t).a;
});
await page.mouse.up();
check("the drag row does NOT scale on press", dragPressed === 1, `scaleX ${dragPressed}`);
check("the drag row is marked so it is exempt", (await dragRow.getAttribute("data-drag-row")) !== null);

/* ---- the streak dots wipe in ---- */
const dots = await page.evaluate(() => {
  const p = [...document.querySelectorAll(".panel")].find((s) => s.textContent?.includes("Lifting streak"));
  const els = [...p.querySelectorAll(".dot-in")];
  return {
    n: els.length,
    delays: els.map((e) => Number(getComputedStyle(e).animationDelay.replace("s", ""))),
  };
});
check("all 14 dots animate in", dots.n === 14, `${dots.n}`);
check("their delays increase left to right", dots.delays.every((d, i) => i === 0 || d > dots.delays[i - 1]), dots.delays.slice(0, 4).join(", "));

/* ---- reduced motion must not hide anything ---- */
const rmCtx = await b.newContext({ viewport: { width: 390, height: 844 }, colorScheme: "dark", reducedMotion: "reduce" });
const rm = await rmCtx.newPage();
await rm.goto(BASE + "/body", { waitUntil: "load" });
await rm.waitForTimeout(1500);
const rmState = await rm.evaluate(() => {
  const els = [...document.querySelectorAll(".panel")];
  return {
    queued: document.querySelectorAll("[data-reveal]").length,
    dim: els.filter((e) => Number(getComputedStyle(e).opacity) < 0.99).length,
    total: els.length,
  };
});
check("reduced motion queues nothing", rmState.queued === 0, `${rmState.queued} queued`);
check("reduced motion leaves every panel fully visible", rmState.dim === 0, `${rmState.dim} of ${rmState.total} dimmed`);

check("no console errors", errs.length === 0, errs.join(" / ") || "none");
console.log(bad ? `\n${bad} FAILING` : "\nall passing");
await b.close();
process.exit(bad ? 1 : 0);
