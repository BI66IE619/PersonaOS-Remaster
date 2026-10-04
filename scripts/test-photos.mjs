import { launchBrowser } from "./auth-state.mjs";

const BASE = process.env.SHOT_URL ?? "http://localhost:3000";
const URL = BASE + "/body";
const b = await launchBrowser();
const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
const p = await ctx.newPage();

const errors = [];
p.on("console", (m) => m.type() === "error" && errors.push(m.text()));
p.on("pageerror", (e) => errors.push(String(e)));
const log = (...a) => console.log(...a);

// Build a few distinct test images as real PNG buffers.
const pngs = await p.evaluate(async () => {
  const make = (r, g, bl) => {
    const c = document.createElement("canvas");
    c.width = 400;
    c.height = 300;
    const x = c.getContext("2d");
    x.fillStyle = `rgb(${r},${g},${bl})`;
    x.fillRect(0, 0, 400, 300);
    return new Promise((res) => c.toBlob(res, "image/png"));
  };
  const out = [];
  for (const [r, g, bl] of [[200, 40, 40], [40, 200, 40], [40, 40, 200]]) {
    const blob = await make(r, g, bl);
    out.push(Array.from(new Uint8Array(await blob.arrayBuffer())));
  }
  return out;
});
log("0. test images built:", pngs.length);

await p.goto(URL, { waitUntil: "load" });
await p.waitForTimeout(1500);
log("1. empty state:", (await p.getByText(/Nothing here yet/).count()) ? "shown" : "MISSING");

// upload all three through the real file input
await p.setInputFiles('input[type="file"]', [
  { name: "a.png", mimeType: "image/png", buffer: Buffer.from(pngs[0]) },
  { name: "b.png", mimeType: "image/png", buffer: Buffer.from(pngs[1]) },
  { name: "c.png", mimeType: "image/png", buffer: Buffer.from(pngs[2]) },
]);
await p.waitForTimeout(2500);
log("2. thumbnails rendered:", await p.locator('img[alt^="Progress photo taken"]').count());
log("3. size/count readout:", (await p.getByText(/KB|MB/).first().textContent())?.trim());

// images actually decoded by the browser (not broken)
const natural = await p.evaluate(() =>
  [...document.querySelectorAll('img[alt^="Progress photo taken"]')].map((i) => i.naturalWidth),
);
log("4. decoded natural widths:", natural);

// compare: select two
await p.locator('button[aria-label^="Select photo"]').nth(0).click();
await p.waitForTimeout(200);
await p.locator('button[aria-label^="Select photo"]').nth(2).click();
await p.waitForTimeout(400);
const figs = await p.locator("figure figcaption").allTextContents();
log("5. compare view captions:", figs);
const compareImgs = await p.locator("figure img").count();
log("6. compare images shown:", compareImgs);

// deselect one -> compare collapses
await p.locator('button[aria-label^="Select photo"]').nth(2).click();
await p.waitForTimeout(300);
log("7. compare collapses on deselect:", (await p.locator("figure").count()) === 0);

// survives reload (IndexedDB, not localStorage)
await p.reload({ waitUntil: "load" });
await p.waitForTimeout(2000);
log("8. after reload:", await p.locator('img[alt^="Progress photo taken"]').count(), "photos");

// delete one
await p.locator('button[aria-label^="Delete photo"]').first().click();
await p.waitForTimeout(800);
log("9. after delete:", await p.locator('img[alt^="Progress photo taken"]').count(), "photos");

// confirm localStorage was NOT used for blobs
const ls = await p.evaluate(() => JSON.stringify(Object.keys(localStorage)));
log("10. localStorage keys (no blobs expected):", ls);

const ox = await p.evaluate(
  () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
);
log("11. horizontal overflow:", ox);
log("12. console errors:", errors.length ? errors : "none");

await b.close();
