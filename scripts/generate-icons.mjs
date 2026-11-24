/**
 * Generates the app icon from one vector source.
 *
 * The brand on the splash is a light "P" on the near-black page, so the icon is the
 * same letter, same colour, and nothing else — legible at 16px and recognisable
 * next to the other apps. Run with: node scripts/generate-icons.mjs
 *
 * Writes:
 *   src/app/icon.svg            the web favicon (and Next's icon link)
 *   src/app/apple-icon.png      180px touch icon
 *   android .../mipmap-<density>    legacy + adaptive launcher icons
 *
 * Only paths, no text: sharp rasterises through librsvg, and a font reference would
 * depend on whichever fonts happen to be installed on the machine that runs this.
 */
import sharp from "sharp";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const BASE = "#07080a";
const INK = "#ffffff";

/* A stroked P: stem up the left, across the top, a semicircle bowl, and back to the
   stem. The bowl's left side is the stem, so the strokes join cleanly. */
const P = `<path d="M144 396 V120 H268 A92 92 0 0 1 268 304 H144" fill="none" stroke="${INK}" stroke-width="54" stroke-linecap="round" stroke-linejoin="round"/>`;

const svg = (body, width = 512) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${width}" viewBox="0 0 512 512">${body}</svg>`;

const square = svg(`<rect width="512" height="512" rx="112" fill="${BASE}"/>${P}`);
const circle = svg(`<circle cx="256" cy="256" r="256" fill="${BASE}"/>${P}`);
/* Adaptive foreground: transparent, because the background colour is its own layer. */
const foreground = svg(P);

async function png(source, size, out) {
  await mkdir(dirname(out), { recursive: true });
  await sharp(Buffer.from(source)).resize(size, size).png().toFile(out);
}

const densities = [
  ["mdpi", 48, 108],
  ["hdpi", 72, 162],
  ["xhdpi", 96, 216],
  ["xxhdpi", 144, 324],
  ["xxxhdpi", 192, 432],
];
const res = "android/app/src/main/res";

await mkdir("src/app", { recursive: true });
await writeFile("src/app/icon.svg", square);
await png(square, 180, "src/app/apple-icon.png");

for (const [d, iconPx, fgPx] of densities) {
  const dir = join(res, `mipmap-${d}`);
  await png(square, iconPx, join(dir, "ic_launcher.png"));
  await png(circle, iconPx, join(dir, "ic_launcher_round.png"));
  await png(foreground, fgPx, join(dir, "ic_launcher_foreground.png"));
}

console.log("icons written");
