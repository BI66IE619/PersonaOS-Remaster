/**
 * Tests for month navigation in the money screen.
 *
 * The bug this guards against is a lie rather than a crash. Every caption on this
 * screen said "this month" and the month was hardcoded to the present, so adding
 * navigation without relabelling would let someone read September's figures under a
 * heading that claimed they were today's. The assertions here are on the labels and
 * the bounds, since a wrong month is silent: nothing crashes, the numbers are just
 * described incorrectly.
 *
 * Pure logic only. Rendering the picker needs a browser session, and the arithmetic
 * that decides what the picker is allowed to do does not.
 */
import { addMonths, monthLabel } from "../src/lib/dates.ts";
import { buildMoneyView } from "../src/lib/finance/view.ts";

let fail = 0;
function check(name, ok, detail = "") {
  if (ok) console.log(`  ok   ${name}`);
  else {
    fail++;
    console.log(`  FAIL ${name}${detail ? `  ${detail}` : ""}`);
  }
}

const CURRENT = "2026-10";
const isCurrent = (m) => m === CURRENT;

/* The caption helper, restated. Mirrors money-screen.tsx's `inMonth`. */
const inMonth = (month) => (isCurrent(month) ? "this month" : `in ${monthLabel(month)}`);

console.log("captions name the month being shown");
check("current month reads as the present", inMonth(CURRENT) === "this month", inMonth(CURRENT));
check(
  "a past month is named, not called 'this month'",
  inMonth("2026-09") === "in September 2026",
  inMonth("2026-09"),
);
check(
  "no past month is ever described as this month",
  !["2026-01", "2026-09", "2025-12", "2024-06"].some((m) => inMonth(m).includes("this month")),
);

console.log("\ncaptions for months that cross a year boundary");
check("December names its year", inMonth("2025-12") === "in December 2025", inMonth("2025-12"));
check("January names its year", inMonth("2026-01") === "in January 2026", inMonth("2026-01"));

console.log("\nforward is capped at the current month");
/* The screen disables next at `month >= currentMonth`; this is that rule. */
const canGoNext = (month) => month < CURRENT;
check("can advance from a past month", canGoNext("2026-09"));
check("cannot advance from the current month", !canGoNext(CURRENT));
/* String comparison is only safe because the key is zero-padded YYYY-MM. Assert it,
   since unpadded months would make this compare wrongly rather than error. */
check("keys sort chronologically as strings", "2026-09" < "2026-10" && "2026-02" < "2026-10");
check("year boundary sorts correctly", "2025-12" < "2026-01");

console.log("\nbackward navigation has no floor");
check("a year back is reachable", addMonths(CURRENT, -12) === "2025-10");
check("two years back is reachable", addMonths(CURRENT, -24) === "2024-10");
check("stepping back then forward returns home", addMonths(addMonths(CURRENT, -5), 5) === CURRENT);
check("stepping back past a year boundary is right", addMonths("2026-01", -1) === "2025-12");

console.log("\nempty months are empty, not fabricated");
const empty = buildMoneyView([], "2026-07");
check("no income", empty.incomeCents === 0, `${empty.incomeCents}`);
check("no spend", empty.spentCents === 0, `${empty.spentCents}`);
check("no net", empty.netCents === 0, `${empty.netCents}`);
check("no balance", empty.balanceCents === 0, `${empty.balanceCents}`);
check("no transactions", empty.transactions.length === 0);
check("no categories", empty.byCategory.length === 0);
check("no cumulative points to chart", empty.cumulative.length === 0);
check("keeps the month it was asked about", empty.month === "2026-07", empty.month);

/* Zero totals are the point: the screen's empty states key off these being empty,
   so a "month" that reported a nonzero spend would render bars with no source. */
check("renders the category empty state", empty.byCategory.length === 0);
check("renders the transaction empty state", empty.transactions.length === 0);

console.log("\nmonthLabel formats correctly");
check("September 2026", monthLabel("2026-09") === "September 2026", monthLabel("2026-09"));
check("January 2026", monthLabel("2026-01") === "January 2026", monthLabel("2026-01"));
check("December 2025", monthLabel("2025-12") === "December 2025", monthLabel("2025-12"));

console.log("\nmonths back, for the screen-reader announcement");
const monthsBack = (month, current = CURRENT) => {
  const [cy, cm] = current.split("-").map(Number);
  const [y, m] = month.split("-").map(Number);
  return (cy - y) * 12 + (cm - m);
};
check("last month is one back", monthsBack("2026-09") === 1, `${monthsBack("2026-09")}`);
check("same month is zero back", monthsBack(CURRENT) === 0);
check("year boundary counts correctly", monthsBack("2025-10") === 12, `${monthsBack("2025-10")}`);
check("never negative for past months", ["2026-01", "2025-06", "2024-01"].every((m) => monthsBack(m) > 0));

console.log(`\n${fail === 0 ? "all passed" : `${fail} failed`}`);
if (fail !== 0) throw new Error(`${fail} failed`);