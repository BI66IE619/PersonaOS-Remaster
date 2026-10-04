import { launchBrowser } from "./auth-state.mjs";
const BASE = process.env.SHOT_URL ?? "http://localhost:3000";
const b = await launchBrowser();
const page = await (await b.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(`${BASE}/home`, { waitUntil: "load" });
await page.waitForTimeout(1500);
const pill = page.locator('nav[aria-label="Primary"] span[aria-hidden]');
const nav = page.locator('nav[aria-label="Primary"]');

let failures = 0;
const check = (name, cond, extra = "") => {
  if (!cond) failures++;
  console.log(`${cond ? "ok  " : "FAIL"} ${name}${extra ? ` — ${extra}` : ""}`);
};

const clickAndSample = async (label) => {
  const xs = [];
  const p = (async () => {
    for (let i = 0; i < 30; i++) {
      /* A sample taken while React swaps the old nav out resolves to a
         detached node and reports a zero rect; it is not something a person
         can see, so ignore it. */
      const r = await pill.evaluate((el) => {
        const b = el.getBoundingClientRect();
        return { x: Math.round(b.x), w: Math.round(b.width) };
      });
      if (r.w > 0) xs.push(r.x);
      await page.waitForTimeout(25);
    }
  })();
  await nav.getByRole("link", { name: label }).click();
  await p;
  return xs;
};

const tidy = (xs) => {
  const out = [xs[0]];
  for (const x of xs) if (x !== out[out.length - 1]) out.push(x);
  return out;
};
const monotonic = (xs, dir) => {
  const t = tidy(xs);
  for (let i = 1; i < t.length; i++) {
    if (dir === "up" && t[i] < t[i - 1]) return false;
    if (dir === "down" && t[i] > t[i - 1]) return false;
  }
  return t.length >= 3;
};

const right = await clickAndSample("Money");
await page.waitForTimeout(400);
const left = await clickAndSample("Home");
await page.waitForTimeout(400);
const right2 = await clickAndSample("Notes");

console.log("right  Home->Money:", tidy(right).join(","));
console.log("left  Money->Home:", tidy(left).join(","));
console.log("right Home->Notes:", tidy(right2).join(","));

check("rightward move increases monotonically", monotonic(right, "up"));
check("leftward move decreases monotonically", monotonic(left, "down"));
check("leftward move never starts from the left edge", !tidy(left).includes(0), tidy(left).join(","));
check("rightward move never starts from the left edge", !tidy(right).includes(0), tidy(right).join(","));
check("no page errors", errors.length === 0, errors.join(" | ") || "none");

await b.close();
console.log(failures ? `\n${failures} FAILING` : "\nall passing");
process.exit(failures ? 1 : 0);
