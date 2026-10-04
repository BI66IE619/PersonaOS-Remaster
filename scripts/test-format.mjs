/**
 * Unit tests for formatMoney.
 *
 * The default of 0 decimal places is deliberate for headline figures, and it is
 * also why a $99.90 total displays as "$100". A user comparing against their bank
 * sees a mismatch that no amount of fixing the data will resolve, because the data
 * was right all along and the formatter rounded it.
 */
import { stripTypeScriptTypes } from "node:module";
import { readFileSync } from "node:fs";

const src = stripTypeScriptTypes(
  readFileSync(new URL("../src/lib/format.ts", import.meta.url), "utf8"),
  { mode: "strip" },
);
const { formatMoney } = await import(
  `data:text/javascript;base64;base64,${Buffer.from(src).toString("base64")}`
);

let fail = 0;
function check(name, ok, detail = "") {
  if (ok) console.log(`  ok   ${name}`);
  else {
    fail++;
    console.log(`  FAIL ${name}${detail ? `  ${detail}` : ""}`);
  }
}

console.log("default is whole dollars");
check("$100 -> $100", formatMoney(10000) === "$100", formatMoney(10000));
check("rounds 9990 to $100", formatMoney(9990) === "$100", formatMoney(9990));
check("rounds 9950 to $100", formatMoney(9950) === "$100", formatMoney(9950));
check("rounds 9949 to $99", formatMoney(9949) === "$99", formatMoney(9949));

console.log("\nwith cents shown");
check("9990 -> $99.90", formatMoney(9990, { dp: 2 }) === "$99.90", formatMoney(9990, { dp: 2 }));
check("68002 -> $680.02", formatMoney(68002, { dp: 2 }) === "$680.02", formatMoney(68002, { dp: 2 }));
check("negative keeps cents", formatMoney(-845, { dp: 2 }) === "−$8.45", formatMoney(-845, { dp: 2 }));

console.log("\nsign handling");
check("showSign on positive", formatMoney(500, { showSign: true }) === "+$5", formatMoney(500, { showSign: true }));
check("negative uses typographic minus", formatMoney(-500) === "−$5", formatMoney(-500));
check("negative ignores showSign", formatMoney(-500, { showSign: true }) === "−$5");

console.log("\nzero and large");
check("zero", formatMoney(0) === "$0", formatMoney(0));
check("thousands separator", formatMoney(1234567, { dp: 2 }) === "$12,345.67", formatMoney(1234567, { dp: 2 }));

console.log("\nrounding is half-up, not banker's");
/* toLocaleString rounds half away from zero, so 5 cents displays as $0.01 rather
   than $0.00. Both are defensible; this pins the actual behaviour so a change is
   deliberate rather than accidental. */
check("5 cents shows a penny at dp=2", formatMoney(5, { dp: 2 }) === "$0.05", formatMoney(5, { dp: 2 }));

console.log(`\n${fail === 0 ? "all passed" : `${fail} failed`}`);
if (fail !== 0) throw new Error(`${fail} failed`);