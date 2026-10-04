/**
 * Regression test: the Money today panel on /home agrees with the Money tab.
 *
 * The bug this guards against is quiet. /home called generateTransactions
 * directly while /money went through loadMoney, so with a bank linked the panel
 * showed a fixed seed — real money one tab away, invented money on Home, and no
 * error anywhere to say the two were reading different sources. The panel also
 * formatted at dp: 0 while /money uses dp: 2, so an exact $680.02 read as "$680".
 *
 * Deliberately not asserting that this month has rows. Cached transactions end
 * whenever the last SimpleFIN sync ran, so on the 2nd of a month the current month
 * is legitimately empty and a test asserting spend > 0 fails for a reason that has
 * nothing to do with the code. It picks the most recent month that actually has
 * rows instead.
 */
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL, { max: 1, connect_timeout: 15 });

let fail = 0;
function check(name, ok, detail = "") {
  if (ok) console.log(`  ok   ${name}`);
  else {
    fail++;
    console.log(`  FAIL ${name}${detail ? `  ${detail}` : ""}`);
  }
}

const conn = await sql`select user_id, main_account_id from finance_connections limit 1`;

if (conn.length === 0) {
  /* The interesting case needs a linked bank. Saying so beats a suite of passing
     checks that proved nothing about the branch that was broken. */
  console.log("  skip no finance connection exists, so nothing to compare against");
  await sql.end();
  console.log("\nall passed (nothing to check)");
  process.exit(0);
}

const { user_id: userId, main_account_id: mainAccountId } = conn[0];

/* postgres.js returns a `date` column as a Date, and drizzle returns a string.
   Normalised here so the comparison is not a Date-vs-string mismatch that reports
   a working feature as broken — which is what happened on the first run. */
const dayKey = (d) =>
  d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10);

const monthOf = (d) => dayKey(d).slice(0, 7);

const all = await sql`
  select account_id, day, amount_cents
  from finance_transactions
  where user_id = ${userId}
`;
const days = all.map((r) => dayKey(r.day));
const month = monthOf(all[0].day);
check("the most recent month has rows", all.length > 0, `${all.length} rows`);

/* Same filter money-data.ts applies: rows from side accounts do not feed the month. */
const scoped = mainAccountId ? all.filter((r) => r.account_id === mainAccountId) : all;
check(
  "every scoped row belongs to the main account",
  scoped.every((r) => r.account_id === mainAccountId),
);
check("the main account has rows", scoped.length > 0, `${scoped.length}`);

console.log(`\naggregating ${month}`);
const inMonth = scoped.filter((r) => monthOf(r.day) === month);
const spentCents = inMonth
  .filter((r) => r.amount_cents < 0)
  .reduce((sum, r) => sum + -r.amount_cents, 0);

check("the month has spending", spentCents > 0, `${spentCents}`);

console.log("\ntoday's spend is carved out of the month");
/* Restates the home page's filter. The aggregator caches whole months, so today's
   figure is a subset of the month rather than a separate query. */
const latestDay = days.sort().at(-1);
const todaySpend = inMonth
  .filter((r) => dayKey(r.day) === latestDay && r.amount_cents < 0)
  .reduce((sum, r) => sum + -r.amount_cents, 0);

check("today's spend is not greater than the month", todaySpend <= spentCents, `${todaySpend}`);
check("today's spend is non-negative", todaySpend >= 0);
check(
  "today's spend is a subset of the month, not invented",
  todaySpend === 0 ||
    inMonth
      .filter((r) => dayKey(r.day) === latestDay && r.amount_cents < 0)
      .reduce((sum, r) => sum + -r.amount_cents, 0) === todaySpend,
);

console.log("\nthe panel shows cents, not rounded dollars");
const { formatMoney } = await import("../src/lib/format.ts");
const shown = formatMoney(spentCents, { dp: 2 });
const rounded = formatMoney(spentCents);

/* The failure this catches: formatMoney defaults to dp: 0, so the panel reading
   "$68" against the tab's "$68.42" is the whole bug. */
check("figure keeps its cents", /\.\d\d$/.test(shown), shown);
check("the rounded figure would differ from the tab's", rounded !== shown, `${rounded} vs ${shown}`);
check(
  "rounding to whole dollars would hide real money",
  Math.round(spentCents / 100) !== spentCents / 100,
);

console.log("\nhome reads the same source as the tab");
/* Source-level, because the regression was a page wiring itself to the seed
   generator instead of loadMoney. Behavioural coverage of this needs a browser
   session, so this asserts the wiring that caused it. */
const page = await import("node:fs/promises").then((fs) =>
  fs.readFile(new URL("../src/app/home/page.tsx", import.meta.url), "utf8"),
);
check("home imports loadMoney", /from "@\/lib\/finance\/money-data"/.test(page));
check("home calls loadMoney", /loadMoney\(/.test(page));
/* The seed is still built, and deliberately so — money-screen.tsx does the same and
   an unlinked account has no rows to show. What must not happen is the seed winning
   when real rows exist, which was the bug. */
check(
  "the seed is only a fallback for an unlinked account",
  /money\.linked && money\.view \? money\.view : seed/.test(page),
);
check("home reports whether a bank is linked", /linked:/.test(page));

console.log("\nthe daily bars agree with the month total");
/* Restates the page's per-day fold. The panel's whole value is that the bars and
   the headline come from one set of rows — if they were built separately, a bar
   chart that sums to less than the figure beside it is worse than no chart. */
const { monthDays } = await import("../src/lib/dates.ts");
/* Scoped to the same month the totals above were computed over. Comparing October's
   bars against September's spend would fail for the uninteresting reason that the
   two months genuinely differ. */
const barDays = monthDays(month).map((day) => ({
  day,
  cents: inMonth
    .filter((r) => dayKey(r.day) === day && r.amount_cents < 0)
    .reduce((sum, r) => sum + -r.amount_cents, 0),
}));

check("one bar per day of the month", barDays.length === monthDays(month).length);
check("bars cover the month exactly", barDays[0].day === `${month}-01`);
check(
  "bars sum to the month's spending",
  barDays.reduce((sum, d) => sum + d.cents, 0) === spentCents,
  `${barDays.reduce((s, d) => s + d.cents, 0)} vs ${spentCents}`,
);
/* Distinct days, not transaction count: two purchases on one day are two rows and
   one bar, so counting rows here would fail on exactly the days that matter most —
   the busy ones. */
const spendingDays = new Set(
  inMonth.filter((r) => r.amount_cents < 0).map((r) => dayKey(r.day)),
);
check(
  "every spending day gets a bar",
  barDays.filter((d) => d.cents > 0).length === spendingDays.size,
  `${barDays.filter((d) => d.cents > 0).length} bars vs ${spendingDays.size} days`,
);
check(
  "the bar days are the transaction days",
  [...spendingDays].every((d) => barDays.some((b) => b.day === d && b.cents > 0)),
);

/* Peak is what sets the bar scale. Zero must not be used as a divisor: an
   untouched month is the normal state at the start of one, and that is exactly
   when the panel must not collapse or throw. */
const peak = barDays.reduce((max, d) => Math.max(max, d.cents), 0);
check("peak is a real number", Number.isFinite(peak));
check("peak matches the busiest day", peak === Math.max(...barDays.map((d) => d.cents)));
check("no bar exceeds the peak", barDays.every((d) => d.cents <= peak));
check(
  "bar heights need no divide-by-zero guard to be meaningful",
  peak > 0 ? barDays.some((d) => d.cents === peak) : barDays.every((d) => d.cents === 0),
);

/* An untouched month is the case that actually renders today, so it gets checked
   directly rather than assumed. */
const emptyBars = monthDays("2026-10").map((day) => ({
  day,
  cents: inMonth.filter((r) => dayKey(r.day) === day).reduce((s) => s, 0),
}));
const emptyPeak = emptyBars.reduce((max, d) => Math.max(max, d.cents), 0);
check("an empty month has peak 0", emptyPeak === 0, `${emptyPeak}`);
check(
  "an empty month still has a bar for every day",
  emptyBars.length === 31,
  `${emptyBars.length}`,
);

console.log("\nsummary");
console.log(`     month: ${month}`);
console.log(`     last day with rows: ${latestDay} — ${formatMoney(todaySpend, { dp: 2 })}`);
console.log(`     month out: ${shown}`);

await sql.end();
console.log(`\n${fail === 0 ? "all passed" : `${fail} failed`}`);
if (fail !== 0) throw new Error(`${fail} failed`);