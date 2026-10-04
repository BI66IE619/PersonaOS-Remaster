/**
 * The mentor's money figures must be the user's real ledger, and the app must
 * say which kind of numbers it is looking at.
 *
 * This is a regression test for the bug where the mentor read from the seed
 * generator instead of the bank: it reported $1,563 of September spending
 * against a real account that had spent $99.90, and nothing failed. The failure
 * was silent because the placeholder path worked exactly as written — it just
 * stopped being true once an account was linked.
 *
 * The ledger is queried with `postgres` directly rather than through
 * @/lib/finance/money-data, which imports "server-only" — a Next alias bare Node
 * cannot resolve. The figures are then assembled the same way loadMoney does,
 * so what is checked is what the page would send.
 *
 * Run: node --env-file=.env.local scripts/test-mentor-money.mjs
 */
import postgres from "postgres";
import nextEnv from "@next/env";
import { buildBrief } from "../src/lib/mentor/brief.ts";
import { buildContext } from "../src/lib/mentor/prompt.ts";
import { buildMoneyView } from "../src/lib/finance/view.ts";
import { MockProvider } from "../src/lib/providers/mock.ts";
import { EMPTY_STATE } from "../src/lib/strength.ts";
import { monthKey } from "../src/lib/dates.ts";

/* @next/env is CommonJS, so the named import is not available under ESM. */
const { loadEnvConfig } = nextEnv;

loadEnvConfig(process.cwd());

let failures = 0;
function check(name, condition, detail = "") {
  if (condition) {
    console.log(`  ok    ${name}`);
  } else {
    failures++;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const month = monthKey(new Date());

/* Everything the brief needs that is not money. Empty on purpose: the other
   findings are not what this is about and only add noise to the context. */
const base = {
  today: `${month}-15`,
  /* Taken from the mock provider rather than hand-written, so the shape cannot
     drift from what buildBrief actually receives at runtime. */
  view: await new MockProvider().getToday(),
  habits: [],
  strength: EMPTY_STATE,
  checkIns: [],
  notes: [],
  weightLogs: {},
  sports: [],
  tasks: [],
  events: [],
  shareNotes: false,
  shareEvents: false,
};

console.log("\nmentor money: the brief carries real figures, and says so\n");

/* ---- 1. the real ledger ---- */
const sql = postgres(process.env.DATABASE_URL ?? "", { max: 1 });
try {
  const conn = await sql`
    select c.user_id, c.main_account_id
    from finance_connections c
    join profiles p on p.id = c.user_id
    order by p.updated_at desc nulls last
    limit 1`;

  if (!conn.length) {
    console.log("  skip  live ledger checks (no finance connection in the database)");
  } else {
    const mainId = conn[0].main_account_id;
    const userId = conn[0].user_id;
    /* day is selected as a formatted string, not a date. postgres.js hands a
       `date` column back as a JS Date, and String() on that is
       "Wed Oct 01 2025…" — which does not start with "YYYY-MM", so every row
       silently fell outside buildMoneyView's month filter and the view came back
       as all zeros. Passing the same characters the filter expects is what keeps
       this test honest about the figures rather than passing on empty ones. */
    const rows = await sql`
      select amount_cents, to_char(day, 'YYYY-MM-DD') as day, note, category_id, source_id
      from finance_transactions
      where user_id = ${userId}::uuid
        ${mainId ? sql`and account_id = ${mainId}` : sql``}
        and to_char(day, 'YYYY-MM') = ${month}
      order by day desc`;

    const account = mainId
      ? (await sql`select coalesce(available_balance_cents, balance_cents) as b
                   from finance_accounts
                   where user_id = ${userId}::uuid and account_id = ${mainId}
                   limit 1`)[0]
      : null;

    const transactions = rows.map((r) => ({
      id: r.source_id,
      amountCents: Number(r.amount_cents),
      date: r.day,
      note: r.note ?? "",
      categoryId: r.category_id ?? null,
      pending: false,
    }));

    const view = { ...buildMoneyView(transactions, month), balanceCents: Number(account?.b ?? 0) };
    const brief = buildBrief({ ...base, money: view, moneyIsReal: true });
    const finding = brief.findings.find((f) => f.key === "money");
    const context = buildContext(brief);
    const dollars = (c) => `$${(c / 100).toFixed(2)}`;

    check("real money is not labelled placeholder", !/placeholder/i.test(finding.label), finding.label);
    check("real money is marked sufficient", finding.sufficient === true);
    check("context reports the real balance", context.includes(dollars(view.balanceCents)));

    /* Guards the failure mode this file already had once. Every check above is a
       comparison between the brief and the view, so a view of all zeros makes
       every one of them pass while proving nothing. A month with rows in it must
       not produce a view of nothing. */
    check(
      "rows in the month produce non-zero figures",
      transactions.length === 0 || view.incomeCents !== 0 || view.spentCents !== 0,
      `${transactions.length} rows read as in ${view.incomeCents} out ${view.spentCents}`,
    );
    check(
      "every row landed in the month",
      transactions.every((t) => t.date.startsWith(month)),
      transactions.find((t) => !t.date.startsWith(month))?.date ?? "none",
    );

    /* The bug in one assertion: what the mentor says must be what the bank has. */
    check(
      "in/out figures come from the ledger",
      context.includes(dollars(view.incomeCents)) && context.includes(dollars(view.spentCents)),
      `expected in ${dollars(view.incomeCents)} out ${dollars(view.spentCents)}`,
    );
    check("context claims a linked account", /linked bank account/.test(context));
    check("placeholder warning is absent", !/NOT REAL/.test(context));
    console.log(
      `        (in ${dollars(view.incomeCents)}, out ${dollars(view.spentCents)}, net ${dollars(view.netCents)}, balance ${dollars(view.balanceCents)}, ${transactions.length} transactions)`,
    );
  }
} finally {
  await sql.end({ timeout: 5 }).catch(() => {});
}

/* ---- 2. placeholder money ---- */
/* The exact figures the mentor wrongly reported, so the test fails on the bug
   rather than on a slightly different invented number. */
const fake = {
  ...buildMoneyView([], month),
  incomeCents: 110850,
  spentCents: 156306,
  netCents: 110850 - 156306,
  balanceCents: 12345,
  byCategory: [{ label: "Food", cents: 66317 }],
};

const fakeBrief = buildBrief({ ...base, money: fake, moneyIsReal: false });
const fakeFinding = fakeBrief.findings.find((f) => f.key === "money");
const fakeContext = buildContext(fakeBrief);

check("placeholder money is marked insufficient", fakeFinding.sufficient === false);
check("placeholder label says placeholder", /placeholder/i.test(fakeFinding.label));
check("placeholder is called out as not real", /NOT REAL/.test(fakeContext));
check("placeholder does not claim a bank", !/linked bank account/.test(fakeContext));
check("placeholder sample marks itself generated", /generated/.test(fakeFinding.sample));

/* ---- 3. the two must not be confusable ---- */
const realCtx = buildContext(buildBrief({ ...base, money: fake, moneyIsReal: true }));
check("the same figures read differently when real", realCtx !== fakeContext);
check("real is not marked NOT REAL", !/NOT REAL/.test(realCtx));

console.log(`\n${failures === 0 ? "all passed" : `${failures} FAILED`}\n`);
process.exit(failures === 0 ? 0 : 1);