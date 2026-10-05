import { CATEGORIES } from "./seed";
import { dayKey } from "@/lib/dates";
import type { MoneyView, Transaction } from "./types";

/** Pure aggregation. The one place a set of transactions becomes a month's view,
    so every caller — the page, the route and the screens — computes the same
    figures the same way. */
export function buildMoneyView(all: Transaction[], month: string): MoneyView {
  const inMonth = all.filter((t) => t.date.startsWith(month));

  let incomeCents = 0;
  let spentCents = 0;
  for (const t of inMonth) {
    if (t.amountCents > 0) incomeCents += t.amountCents;
    else spentCents += -t.amountCents;
  }

  const byCategory = CATEGORIES.filter((c) => c.kind === "expense")
    .map((c) => {
      let cents = 0;
      for (const t of inMonth) {
        if (t.categoryId === c.id && t.amountCents < 0) cents += -t.amountCents;
      }
      return {
        id: c.id,
        label: c.label,
        color: c.color,
        cents,
        pct: spentCents > 0 ? cents / spentCents : 0,
      };
    })
    .filter((c) => c.cents > 0)
    .sort((a, b) => b.cents - a.cents);

  // Running net across the calendar days actually present in the month.
  const days = [...new Set(inMonth.map((t) => t.date))].sort();
  let running = 0;
  const cumulative = days.map((date) => {
    for (const t of inMonth) if (t.date === date) running += t.amountCents;
    return { date, cents: running };
  });

  const byMerchant = new Map<string, number>();
  for (const t of inMonth) {
    if (t.amountCents < 0) byMerchant.set(t.note, (byMerchant.get(t.note) ?? 0) + -t.amountCents);
  }
  const topMerchants = [...byMerchant.entries()]
    .map(([label, cents]) => ({ label, cents }))
    .sort((a, b) => b.cents - a.cents)
    .slice(0, 5);

  const subscriptions = all
    .filter((t) => t.recurring && t.date <= monthLastDay(month))
    .reduce<Map<string, { cents: number; cadence: "monthly" | "yearly" }>>((acc, t) => {
      const prev = acc.get(t.note);
      acc.set(t.note, { cents: -t.amountCents, cadence: prev?.cadence ?? "monthly" });
      return acc;
    }, new Map());
  const subList = [...subscriptions.entries()]
    .map(([label, v]) => ({ label, cents: v.cents, cadence: v.cadence }))
    .sort((a, b) => b.cents - a.cents);

  let balanceCents = 0;
  for (const t of all) balanceCents += t.amountCents;

  return {
    month,
    incomeCents,
    spentCents,
    netCents: incomeCents - spentCents,
    /* Denominator for the category bars. Scales them against the biggest
       spender instead of a budget, so the bars still read as a comparison. */
    topCents: byCategory[0]?.cents ?? 0,
    byCategory,
    transactions: inMonth,
    cumulative,
    subscriptions: subList,
    topMerchants,
    balanceCents,
  };
}

function monthLastDay(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return `${month}-${String(new Date(y, m, 0).getDate()).padStart(2, "0")}`;
}

export { dayKey };
