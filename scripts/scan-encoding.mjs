import { readFileSync } from "node:fs";

const files = process.argv.slice(2);
for (const f of files) {
  const src = readFileSync(f, "utf8");
  const bad = new Map();
  let i = 0;
  while (i < src.length) {
    const code = src.codePointAt(i);
    if (code > 127) {
      const ch = String.fromCodePoint(code);
      const line = src.slice(0, i).split("\n").length;
      if (!bad.has(ch)) bad.set(ch, []);
      if (bad.get(ch).length < 4) bad.get(ch).push(line);
    }
    i += ch_len(src, i);
  }
  console.log(`\n=== ${f} ===`);
  if (!bad.size) console.log("  (pure ASCII, no issues)");
  for (const [ch, lines] of bad) {
    const codes = [...ch].map((c) => "U+" + c.codePointAt(0).toString(16).toUpperCase().padStart(4, "0")).join(" ");
    console.log(`  ${JSON.stringify(ch)}  ${codes}  lines ${lines.join(", ")}`);
  }
}

function ch_len(src, i) {
  const c = src.codePointAt(i);
  return c > 0xffff ? 2 : 1;
}
