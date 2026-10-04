import { chromium } from "@playwright/test";

const browser = await chromium.launch();
const PATHNAME = process.env.SHOT_PATH ?? "/home";

for (const vp of [
  { name: "mobile", width: 390, height: 844 },
  { name: "desktop", width: 1440, height: 900 },
]) {
  const ctx = await browser.newContext({ viewport: vp, colorScheme: "dark" });
  const page = await ctx.newPage();
  await page.goto((process.env.SHOT_URL ?? "http://localhost:3000") + PATHNAME, {
    waitUntil: "load",
  });
  await page.waitForTimeout(1500);

  const out = await page.evaluate(() => {
    const de = document.documentElement;
    const panel = document.querySelector("main .panel");
    const cs = panel ? getComputedStyle(panel) : null;
    return {
      header: document.querySelector("header")?.innerText,
      overflowX: de.scrollWidth > de.clientWidth,
      scrollWidth: de.scrollWidth,
      clientWidth: de.clientWidth,
      glass: cs
        ? {
            backdrop: cs.backdropFilter || cs.webkitBackdropFilter,
            border: cs.borderTopColor,
            radius: cs.borderTopLeftRadius,
          }
        : null,
      sections: [...document.querySelectorAll("main > section")].map((s) =>
        s.innerText.replace(/\n+/g, " | "),
      ),
      /* Grid items stretch to the tallest in their row. Any panel with more slack
         than the padding baseline has a content/height mismatch worth seeing. */
      panelSlack: (() => {
        const pads = [...document.querySelectorAll("main > section")].map((s) => {
          const panel = s.querySelector(".panel") ?? s;
          return parseFloat(getComputedStyle(panel).paddingBottom) || 0;
        });
        return [...document.querySelectorAll("main > section")].map((s, i) => {
          const panel = s.querySelector(".panel") ?? s;
          const pr = panel.getBoundingClientRect();
          let lowest = pr.top;
          for (const c of panel.children) {
            const cr = c.getBoundingClientRect();
            if (cr.height > 0) lowest = Math.max(lowest, cr.bottom);
          }
          return {
            span: s.className.match(/col-span-\d+/)?.[0] ?? "-",
            slack: Math.round(pr.bottom - lowest),
            padding: Math.round(pads[i]),
          };
        });
      })(),
      ringLabel: document.querySelector('[role="img"]')?.getAttribute("aria-label"),
    };
  });

  console.log(`\n===== ${vp.name} (${vp.width}px) =====`);
  console.log(`header: ${out.header}`);
  console.log(
    `overflow-x: ${out.overflowX} (scroll ${out.scrollWidth} / client ${out.clientWidth})`,
  );
  console.log(`glass: ${JSON.stringify(out.glass)}`);
  console.log(`ring: ${out.ringLabel}`);
  for (const p of out.panelSlack) {
    const extra = p.slack - p.padding;
    const flag = extra > 8 ? `  <-- ${extra}px void` : "";
    console.log(`  ${p.span}  slack ${p.slack}px (padding ${p.padding}px)${flag}`);
  }
  out.sections.forEach((s, i) => console.log(`\n[${i}] ${s}`));
  await ctx.close();
}

await browser.close();
