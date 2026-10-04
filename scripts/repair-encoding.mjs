import { readdirSync, statSync, readFileSync, writeFileSync } from "node:fs";
import { join, extname } from "node:path";

/* PowerShell 5.1 read the file as Windows-1252 and wrote it back as UTF-8, so
   every byte above 0x7F became one or more Latin-1 characters and a BOM was
   prepended. Reverse both.

   This originally only knew about the em dash, because the em dash is what such
   a round trip does to nearly every file in this project. That was not enough: a
   round trip also turns a middle dot into "A<middle-dot>", a multiplication sign
   into "A<times>", and U+2039 into "a<euro><one>", none of which it would touch.
   All of those actually happened here, to a component that then rendered three
   stray glyphs in place of one character, and nothing failed until a test
   happened to compare the text.

   So it now reverses the whole Windows-1252 high range generically, and refuses
   to touch a file unless the reversal is provably the right one.

   ESCAPES ONLY, never a literal. This script must stay pure ASCII, because the
   failure it repairs is a non-ASCII character being mangled, and a script that
   contained the characters it repairs could be mangled the same way.

   Usage: node scripts/repair-encoding.mjs [--check] <file-or-dir>... */

const BOM = "\ufeff";

/* The only place CP1252 differs from latin-1: 0x80-0x9F. Node has no
   windows-1252 codec, so it is spelled out. 0x8B is U+2039, the character that
   got mangled in the strength log. */
const HIGH = {
  0x80: "\u20ac", 0x82: "\u201a", 0x83: "\u0192", 0x84: "\u201e",
  0x85: "\u2026", 0x86: "\u2020", 0x87: "\u2021", 0x88: "\u02c6",
  0x89: "\u2030", 0x8a: "\u0160", 0x8b: "\u2039", 0x8c: "\u0152",
  0x8e: "\u017d", 0x91: "\u2018", 0x92: "\u2019", 0x93: "\u201c",
  0x94: "\u201d", 0x95: "\u2022", 0x96: "\u2013", 0x97: "\u2014",
  0x98: "\u02dc", 0x99: "\u2122", 0x9a: "\u0161", 0x9b: "\u203a",
  0x9c: "\u0153", 0x9e: "\u017e", 0x9f: "\u0178",
};
const TO_BYTE = new Map(Object.entries(HIGH).map(([b, c]) => [c, Number(b)]));

/* Tells that this is genuinely mojibake rather than a file that simply contains
   a non-ASCII character: U+00E2 followed by U+20AC opens almost every 3-byte
   sequence decoded as CP1252, and U+00C2 is the same idea for the 2-byte ones,
   which is what a middle dot or a multiplication sign turns into. */
const TELLS = ["\u00e2\u20ac", "\u00c2"];
const REPLACEMENT = "\ufffd";

const cp1252Bytes = (s) => {
  const out = [];
  for (const ch of s) {
    const code = ch.codePointAt(0);
    if (code < 0x80 || (code >= 0xa0 && code <= 0xff)) out.push(code);
    else if (TO_BYTE.has(ch)) out.push(TO_BYTE.get(ch));
    else return null; /* not representable in CP1252, so not our mojibake */
  }
  return Buffer.from(out);
};

const CODE = /\.(ts|tsx|mjs|js|css|json|md)$/;

const expand = (target, acc = []) => {
  if (statSync(target).isDirectory()) {
    for (const entry of readdirSync(target)) {
      const p = join(target, entry);
      if (statSync(p).isDirectory()) expand(p, acc);
      else if (CODE.test(extname(p))) acc.push(p);
    }
  } else acc.push(target);
  return acc;
};

const args = process.argv.slice(2);
const checkOnly = args.includes("--check");
const targets = args.filter((a) => a !== "--check");

if (!targets.length) {
  console.log("usage: node scripts/repair-encoding.mjs [--check] <file-or-dir>...");
  process.exit(2);
}

const files = targets.flatMap((t) => expand(t));
let repaired = 0;
let pending = 0;
let corrupt = 0;
let stripped = 0;

for (const file of files) {
  const raw = readFileSync(file);
  const hadBom = raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf;
  const before = raw.toString("utf8").replace(BOM, "");

  if (!TELLS.some((t) => before.includes(t))) {
    if (hadBom) {
      if (checkOnly) {
        stripped++;
        console.log(`${file}: would strip a stray BOM`);
      } else {
        writeFileSync(file, before, "utf8");
        stripped++;
        console.log(`${file}: stripped a stray BOM`);
      }
    }
    continue;
  }

  const bytes = cp1252Bytes(before);
  const after = bytes ? bytes.toString("utf8") : null;

  /* Only accept a reversal that decodes cleanly and actually changes the text.
     A healthy file that merely contains real non-ASCII characters reverses to
     invalid UTF-8, which is what stops this from mangling files that are fine. */
  if (after === null || after === before || after.includes(REPLACEMENT)) {
    console.log(`${file}: LOOKS CORRUPT but the reversal is not safe, left alone`);
    corrupt++;
    continue;
  }
  if (checkOnly) {
    pending++;
    console.log(`${file}: would repair ${before.length} -> ${after.length} chars`);
    continue;
  }
  writeFileSync(file, after, "utf8");
  repaired++;
  console.log(`${file}: repaired${hadBom ? ", BOM stripped" : ""}`);
}

const pendingTotal = pending + stripped;
console.log(
  corrupt
    ? `\n${corrupt} file(s) need a human${pendingTotal ? `, ${pendingTotal} would be repaired` : ""}`
    : checkOnly && pendingTotal
      ? `\n${pendingTotal} file(s) would be repaired (${files.length} checked, dry run)`
      : repaired || stripped
        ? `\n${repaired} file(s) repaired${stripped ? `, ${stripped} stray BOM(s) stripped` : ""}`
        : `\nnothing to repair (${files.length} file(s) checked)`,
);
process.exit(corrupt ? 1 : 0);
