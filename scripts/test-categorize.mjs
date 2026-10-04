/**
 * Unit tests for the rules-based categoriser.
 *
 * The failure mode worth guarding is over-eager matching: a pattern short enough
 * to look reasonable in a list turns out to be a substring of something unrelated
 * and files every transaction under it. "ro" in a health list matches "Frontier";
 * "roblox" in a games list must not be swallowed by an earlier generic rule.
 */
import { stripTypeScriptTypes } from "node:module";
import { readFileSync } from "node:fs";

const src = stripTypeScriptTypes(
  readFileSync(new URL("../src/lib/finance/categorize.ts", import.meta.url), "utf8"),
  { mode: "strip" },
);
const { categorize } = await import(
  `data:text/javascript;base64,${Buffer.from(src).toString("base64")}`
);

let fail = 0;
function check(name, ok) {
  if (ok) console.log(`  ok   ${name}`);
  else {
    fail++;
    console.log(`  FAIL ${name}`);
  }
}

console.log("real payees");
check("Starbucks -> food", categorize("STARBUCKS STORE 1234 SEATTLE WA", -845) === "food");
check("AMC Theatres -> other (no rule)", categorize("AMC Theatres #2210", -1969) === null);
check("OpenAI -> subs", categorize("OPENAI *CHATGPT SUBSCR", -500) === "subs");
check("Wetzel's Pretzels -> food", categorize("WETZEL'S PRETZELS 0142", -1365) === "food");
check("Raising Cane's -> food", categorize("RAISING CANES 0932", -1260) === "food");
check("Round1 -> other", categorize("ROUND1 0044", -431) === null);

console.log("\ncategory conflicts");
/* Game stores sell subscriptions too, but a Steam purchase is a game purchase.
   Whichever list is checked first wins, so this pins the intended precedence. */
check("Steam -> games, not subs", categorize("STEAMGAME.COM 4259", -999) === "games");
check("PlayStation -> games", categorize("PLAYSTATION STORE", -2499) === "games");
check("Netflix -> subs", categorize("NETFLIX.COM 800-585-2494", -1599) === "subs");
check("Amazon Prime -> subs", categorize("AMAZON PRIME*2H4KJ", -1499) === "subs");

console.log("\nover-eager patterns");
/* "ro" and "bp " are too short. If either comes back the rule set needs trimming. */
check("Frontier is not health", categorize("FRONTIER COMMUNICATIONS", -8999) !== "health");
check("Corner store is not health", categorize("THE CORNER MARKET", -500) !== "health");
check("Dropbox word not matched by 'rop'", categorize("DROPBOX", -1199) === "subs");
check("bp gas station -> transport", categorize("BP GAS STATION 4471", -5200) === "transport");

console.log("\nincome is not an expense");
check("deposit is income", categorize("BRANCH DEPOSIT", 30000) === "job");
check("dividend is income", categorize("DIVIDEND PAYMENT", 1) === "job");
check("payroll is income", categorize("DIRECT DEPOSIT PAYROLL", 48000) === "job");
check("refund is income even from a shop", categorize("TARGET REFUND", 500) === "job");
/* A negative amount is a spend no matter what it says. */
check("negative deposit is not income", categorize("BRANCH DEPOSIT", -500) !== "job");

console.log("\ngeneral merchants");
check("walmart stays unassigned", categorize("WALMART SUPERCENTER #2841", -4211) === null);
check("target stays unassigned", categorize("TARGET 00012345", -3099) === null);
check("amazon stays unassigned", categorize("AMAZON.COM*RT4GH", -4499) === null);

console.log("\nempty and edge cases");
check("empty note -> null", categorize("", -100) === null);
check("whitespace note -> null", categorize("   ", -100) === null);
check("unknown merchant -> null", categorize("ZZQQ MECHANICAL LLC", -1234) === null);

console.log("\ncase insensitivity");
check("lowercase matches", categorize("starbucks", -500) === "food");
check("mixed case matches", categorize("StarBucks", -500) === "food");

console.log(`\n${fail === 0 ? "all passed" : `${fail} failed`}`);
if (fail !== 0) throw new Error(`${fail} failed`);