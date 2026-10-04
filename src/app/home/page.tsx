import { HomeScreen } from "@/components/home-screen";
import { JournalSync } from "@/components/journal-sync";
import { getProvider } from "@/lib/providers";
import { buildMoneyView } from "@/lib/finance/view";
import { generateTransactions } from "@/lib/finance/seed";
import { loadMoney } from "@/lib/finance/money-data";
import { requireUserId } from "@/lib/dal";
import { monthDays, monthKey } from "@/lib/dates";
import { randomWelcome } from "@/lib/welcomes";

// Reads "now", so it must never be prerendered into a frozen day at build time.
export const dynamic = "force-dynamic";

export default async function Home() {
  const now = new Date();
  const [view, userId] = await Promise.all([getProvider().getToday(), requireUserId()]);
  const money = await loadMoney(userId, null);
  const welcome = randomWelcome();

  /* Same source as the Money tab, via the same loadMoney call, so the two cannot
     drift apart. It used to call generateTransactions directly, which meant the
     panel showed a fixed seed whether or not a bank was connected — real money on
     one screen and invented money on the other, side by side. */

  /* The seed stands in only when no bank is linked, and only as a labelled sample.
     Never blended with real rows: a figure that might be either reads as a bug
     rather than as an unlinked account. */
  const seed = buildMoneyView(generateTransactions(now), monthKey(now));
  const shown = money.linked && money.view ? money.view : seed;

  /* Today's spend is carved out of the month view rather than asked for as a day,
     because the aggregator only caches whole months and does not have a day. */
  const todaySpendCents = shown.transactions
    .filter((t) => t.date === view.date && t.amountCents < 0)
    .reduce((sum, t) => sum + -t.amountCents, 0);

  /* One entry per day of the month, zero-filled.
     Passed rather than recomputed in the panel so the bars are drawn from the same
     transaction rows the totals above come from — a bar chart and a headline
     derived separately can disagree, and then the panel contradicts itself. */
  const dailySpend = monthDays(monthKey(now)).map((day) => ({
    day,
    cents: shown.transactions
      .filter((t) => t.date === day && t.amountCents < 0)
      .reduce((sum, t) => sum + -t.amountCents, 0),
  }));

  return (
    <>
      {/* Home reads the check-in and weigh-in stores for its Logged today panel,
          so bind them to the account before it renders. */}
      <JournalSync userId={userId} />
      <HomeScreen
        view={view}
        welcome={welcome}
        money={{
          linked: money.linked,
          todaySpendCents,
          spentCents: shown.spentCents,
          balanceCents: shown.balanceCents,
          dailySpend,
          today: view.date,
          month: monthKey(now),
        }}
      />
    </>
  );
}
