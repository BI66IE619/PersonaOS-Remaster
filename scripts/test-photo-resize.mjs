import { launchBrowser } from "./auth-state.mjs";

const BASE = process.env.SHOT_URL ?? "http://localhost:3000";
const URL = BASE + "/body";
const b = await launchBrowser();
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
const p = await ctx.newPage();
const errors = [];
p.on("pageerror", (e) => errors.push(String(e)));
p.on("console", (m) => m.type() === "error" && errors.push(m.text()));
const log = (...a) => console.log(...a);

// A genuinely large image, like a phone camera would produce.
const big = await p.evaluate(async () => {
  const c = document.createElement("canvas");
  c.width = 3000;
  c.height = 2000;
  const x = c.getContext("2d");
  const grad = x.createLinearGradient(0, 0, 3000, 2000);
  for (let i = 0; i <= 20; i++) {
    grad.addColorStop(i / 20, `hsl(${i * 18} 70% ${20 + (i % 5) * 10}%)`);
  }
  x.fillStyle = grad;
  x.fillRect(0, 0, 3000, 2000);
  const blob = await new Promise((r) => c.toBlob(r, "image/png"));
  return { bytes: Array.from(new Uint8Array(await blob.arrayBuffer())), size: blob.size };
});
log("source image:", (big.size / (1024 * 1024)).toFixed(2), "MB at 3000x2000");

await p.goto(URL, { waitUntil: "load" });
await p.waitForTimeout(1500);
await p.setInputFiles('input[type="file"]', [
  { name: "big.png", mimeType: "image/png", buffer: Buffer.from(big.bytes) },
]);
await p.waitForTimeout(3500);

const dims = await p.evaluate(() =>
  [...document.querySelectorAll('img[alt^="Progress photo taken"]')].map((i) => [i.naturalWidth, i.naturalHeight]),
);
log("stored dimensions:", JSON.stringify(dims), "(expect 1400x933)");
log("stored size readout:", (await p.getByText(/KB|MB/).first().textContent())?.trim());
log("downscale applied:", dims[0]?.[0] === 1400);

// non-image upload must be ignored, not crash
await p.setInputFiles('input[type="file"]', [
  { name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("not an image") },
]);
await p.waitForTimeout(1200);
const after = await p.locator('img[alt^="Progress photo taken"]').count();
log("non-image ignored:", after === 1 ? "yes" : `NO (count ${after})`);
log("error shown:", (await p.getByText(/Could not read that image/).count()) ? "yes" : "no (skipped cleanly)");
log("errors:", errors.length ? errors : "none");

await b.close();
