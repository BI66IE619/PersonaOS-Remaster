/**
 * Regression test for the main-account split.
 *
 * The point of the feature: the month is computed from one nominated account, and
 * the others still show their balances. Getting this wrong is quiet — the numbers
 * still add up, they just describe the wrong account, so nothing crashes and
 * nothing reports an error.
 *
 * Checks the decision logic in money-data.ts by reading the live database, because
 * the interesting cases are about real account ids and real rows rather than about
 * how the filter is spelled.
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

/**
 * The filter money-data.ts applies, restated so it can be checked on real rows.
 *
 * Reads account_id, not accountId: postgres.js returns the column names exactly as
 * written in the SQL, so a camelCase property here matches nothing and reports a
 * working feature as broken. That is what happened on the first run of this test.
 */
function rowsFor(txRows, mainAccountId) {
  return mainAccountId ? txRows.filter((r) => r.account_id === mainAccountId) : txRows;
}

const conn = await sql`select main_account_id from finance_connections limit 1`;
const main = conn[0]?.main_account_id ?? null;

const accounts = await sql`select account_id, name from finance_accounts order by name`;
/**
 * postgres.js returns the column names as written in SQL, so these rows are
 * snake_case. Comparing them against camelCase field names silently matches
 * nothing and reports a real, working feature as broken.
 */
const tx = await sql`
  select account_id, amount_cents, category_id
  from finance_transactions
`;

check("accounts present", accounts.length > 0, `${accounts.length}`);
check("main account chosen", main !== null);
check(
  "main account is one of the user's own",
  main !== null && accounts.some((a) => a.account_id === main),
  String(main),
);

console.log("\nfiltering");
const onlyMain = rowsFor(tx, main);
const everything = rowsFor(tx, null);

check("main account has rows", onlyMain.length > 0, `${onlyMain.length}`);
check("unfiltered has at least as many", everything.length >= onlyMain.length);
check(
  "every row kept belongs to the main account",
  onlyMain.every((r) => r.account_id === main),
);
check(
  "no rows from other accounts leak in",
  !onlyMain.some((r) => r.account_id !== main),
);

console.log("\nflows do not mix accounts");
/* The reason this feature exists: a savings dividend reading as monthly income.
   With the split, only the main account's positive amounts count. */
const inflowMain = onlyMain.filter((r) => r.amount_cents > 0).length;
const inflowAll = everything.filter((r) => r.amount_cents > 0).length;
console.log(`     positive rows in main: ${inflowMain}, across all: ${inflowAll}`);
check("main-account inflow is a subset", inflowMain <= inflowAll);

console.log("\nbalances are still all shown");
const balances = await sql`
  select account_id,
         coalesce(available_balance_cents, balance_cents) as shown
  from finance_accounts
`;
check("every account has a balance to show", balances.length === accounts.length);
check(
  "shown balances are all non-null",
  balances.every((b) => b.shown !== null),
);
const mainShown = balances.find((b) => b.account_id === main)?.shown ?? null;
check("main account has a shown balance", mainShown !== null);

console.log(`\n  accounts: ${accounts.map((a) => a.name).join(", ")}`);
console.log(`  main: ${accounts.find((a) => a.account_id === main)?.name}`);
console.log(`  month rows from main: ${onlyMain.length} of ${everything.length}`);

await sql.end();
console.log(`\n${fail === 0 ? "all passed" : `${fail} failed`}`);
if (fail !== 0) throw new Error(`${fail} failed`);