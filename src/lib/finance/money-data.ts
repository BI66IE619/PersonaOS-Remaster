/**
 * The one place that turns cached finance rows into a MoneyView.
 *
 * This exists because the data is needed in two places: the API route, which the
 * client refetches after connecting or syncing, and the money page, which renders
 * on the server. When those were separate, the page's version had to be kept in
 * step with the route's by hand, and the page had no way to know the screen had a
 * fetch that already answered the same question — so the screen refetched
 * everything it had just been given, on every visit.
 *
 * Server-only: it reads the encrypted credential's presence and the database.
 */
import "server-only";

import { and, eq, gte, lte } from "drizzle-orm";
import { db } from "@/db";
import * as schema from "@/db/schema";
import { isConnected } from "@/lib/finance/simplefin";
import { buildMoneyView } from "@/lib/finance/view";
import { monthKey } from "@/lib/dates";
import type { MoneyView, Transaction } from "@/lib/finance/types";

export type MoneyAccount = {
  accountId: string;
  name: string;
  org: string;
  balanceCents: number;
  /** Ledger balance, kept for accounts the user is not spending from. */
  ledgerCents: number;
  /** False for the side accounts whose transactions do not feed the month. */
  isMain: boolean;
};

export type MoneyData = {
  month: string;
  linked: boolean;
  /** null when no bank is linked. Distinct from an empty view. */
  view: MoneyView | null;
  accounts: MoneyAccount[];
  /** The account driving the month, or null when none has been chosen yet. */
  mainAccountId: string | null;
};

export async function loadMoney(userId: string, rawMonth: string | null): Promise<MoneyData> {
  const month = normalizeMonth(rawMonth);

  if (!(await isConnected(userId))) {
    /* Explicitly `linked: false` rather than an empty view, so the screen can tell
       "no bank yet" from "a bank that returned nothing this month". Those are very
       different things to show a person, and an empty screen with no explanation
       reads as a bug in the app rather than a missing connection. */
    return { month, linked: false, view: null, accounts: [], mainAccountId: null };
  }

  const [start, end] = monthBounds(month);

  const [connRow, txRowsAll, accountsRaw] = await Promise.all([
    db
      .select({ mainAccountId: schema.financeConnections.mainAccountId })
      .from(schema.financeConnections)
      .where(eq(schema.financeConnections.userId, userId))
      .limit(1),
    db
      .select({
        sourceId: schema.financeTransactions.sourceId,
        accountId: schema.financeTransactions.accountId,
        day: schema.financeTransactions.day,
        amountCents: schema.financeTransactions.amountCents,
        note: schema.financeTransactions.note,
        categoryId: schema.financeTransactions.categoryId,
      })
      .from(schema.financeTransactions)
      .where(
        and(
          eq(schema.financeTransactions.userId, userId),
          gte(schema.financeTransactions.day, start),
          lte(schema.financeTransactions.day, end),
        ),
      ),
    db
      .select({
        accountId: schema.financeAccounts.accountId,
        name: schema.financeAccounts.name,
        org: schema.financeAccounts.org,
        balanceCents: schema.financeAccounts.balanceCents,
        availableBalanceCents: schema.financeAccounts.availableBalanceCents,
      })
      .from(schema.financeAccounts)
      .where(eq(schema.financeAccounts.userId, userId)),
  ]);

  /* Which account the month is computed from.
     Null when the user has not chosen one, in which case every account contributes.
     That fallback is the behaviour from before this option existed, so an existing
     connection keeps producing the same numbers rather than an empty month. */
  const mainAccountId = connRow[0]?.mainAccountId ?? null;

  /* Rows from the side accounts are left out of the month entirely, so a savings
     account's quarterly dividend does not read as income and its transfers do not
     read as spending. The account is still listed and still has its balance shown;
     only the flow figures ignore it.

     When the chosen account has no rows for this month the result is an empty month
     rather than a silent fallback to all accounts. Falling back would put numbers on
     screen that do not correspond to the account the user picked, which is worse
     than showing nothing and saying why. */
const txRows = mainAccountId
    ? txRowsAll.filter((r) => r.accountId === mainAccountId)
    : txRowsAll;

  /* Mapped into the app's own Transaction type, so buildMoneyView does not need to
     know that rows come from Postgres. categoryId is nullable in the database and
     the view expects a string, so an uncategorised row gets the same "other" bucket
     the seed uses — visible as a category rather than silently dropped from the
     category bars while still counting toward the total. */
  const transactions: Transaction[] = txRows.map((r) => ({
    id: `${r.accountId}:${r.sourceId}`,
    date: r.day,
    amountCents: r.amountCents,
    categoryId: r.categoryId ?? "other",
    note: r.note,
    recurring: false,
  }));

  /* Spendable balance, falling back to the ledger figure per account.
     A credit union share account can hold a larger ledger balance than the user can
     actually spend, because part of it is committed to pending authorisations. The
     number they see in their banking app is the spendable one, so a ledger figure
     reads high by exactly the held amount.

     Falls back to 0 nowhere on purpose: a server that omits available-balance shows
     the ledger balance, which is what happened before this column existed, whereas
     defaulting to 0 would render as an emptied account. */
  const spendable = (a: (typeof accountsRaw)[number]) =>
    a.availableBalanceCents ?? a.balanceCents;

  const accounts: MoneyAccount[] = accountsRaw.map((a) => ({
    accountId: a.accountId,
    name: a.name,
    org: a.org,
    balanceCents: spendable(a),
    ledgerCents: a.balanceCents,
    isMain: a.accountId === mainAccountId,
  }));

  /* The headline balance is the main account's alone, so the number a person
     compares against their banking app is the one they nominated. With no account
     chosen yet, everything sums as it did before. */
  const balanceCents = mainAccountId
    ? accounts
        .filter((a) => a.isMain)
        .reduce((sum, a) => sum + a.balanceCents, 0)
    : accounts.reduce((sum, a) => sum + a.balanceCents, 0);

  return {
    month,
    linked: true,
    view: { ...buildMoneyView(transactions, month), balanceCents },
    accounts,
    mainAccountId,
  };
}

/** YYYY-MM, or the current month when absent or malformed. */
export function normalizeMonth(raw: string | null): string {
  if (raw && /^\d{4}-\d{2}$/.test(raw)) return raw;
  return monthKey(new Date());
}

/** Inclusive first and last day of the month. */
function monthBounds(month: string): [string, string] {
  const [y, m] = month.split("-").map(Number);
  /* Day 0 of the next month is the last day of this one. Doing it that way rather
     than hardcoding 30/31 means February and the leap years need no special case. */
  const last = new Date(y, m, 0).getDate();
  return [`${month}-01`, `${month}-${String(last).padStart(2, "0")}`];
}