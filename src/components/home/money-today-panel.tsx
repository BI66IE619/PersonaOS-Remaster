import { formatMoney } from "@/lib/format";

export type TodayMoney = {
  /** False when no bank is linked, so the figures can be labelled as sample. */
  linked: boolean;
  /** Spend dated today, as positive cents. */
  todaySpendCents: number;
  spentCents: number;
  balanceCents: number;
  /** Every day of the month, zero-filled, so the bars keep their spacing. */
  dailySpend: { day: string; cents: number }[];
  today: string;
  /** YYYY-MM, for labelling the axis. */
  month: string;
};

/**
 * Money's contribution to a day: what has gone out today, how the month is
 * shaped, and where the account stands. Read-only, because the Money tab owns editing.
 *
 * Deliberately no budget and no pace bar. Budgets are a household instrument:
 * they assume you pay rent and buy the food. Tracking your own spend is
 * useful at any age; being measured against a target you did not set is not.
 * The bars scale to the biggest day instead, so they compare days against each
 * other rather than against a number nobody chose.
 */
export function MoneyTodayPanel({
  linked,
  todaySpendCents,
  spentCents,
  balanceCents,
  dailySpend,
  today,
}: TodayMoney) {
  /* Cents, and the same dp: 2 the Money tab uses. At dp: 0 an exact $680.02 read
     as "$680" here and "$680.02" one tab away, which looks like the two screens
     were reading different data — they were, but only over rounding. Anything a
     person reconciles against a banking app wants the full figure, because that
     is the comparison being made. */
  const cents = (c: number) => formatMoney(c, { dp: 2 });

  /* The tallest bar sets the scale. Guarded against a zero maximum, which is what
     an untouched month actually produces: without it every bar would divide by
     zero and the row would collapse to nothing rather than drawing a flat line. */
  const peak = dailySpend.reduce((max, d) => Math.max(max, d.cents), 0);

  /* Days after today have no spending yet, which is not the same as spending
     nothing. They are drawn as absent so the month's shape reads as "so far"
     rather than as a fortnight of genuinely quiet days. */
  const elapsed = dailySpend.filter((d) => d.day <= today);

  const busiest = dailySpend.reduce(
    (best, d) => (d.cents > best.cents ? d : best),
    { day: "", cents: 0 },
  );

  return (
    <section className="panel flex flex-col p-5 lg:col-span-5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="label-xs shrink-0">Money today</span>
        {!linked && (
          <span className="num shrink-0 text-[10px] text-ink-3">sample</span>
        )}
      </div>

      <div className="mt-3 flex items-baseline justify-between gap-3">
        <span className="num text-[42px] leading-none font-semibold tracking-tight">
          {cents(todaySpendCents)}
        </span>
        <span className="num shrink-0 text-xs text-ink-3">
          {!linked ? "sample" : todaySpendCents === 0 ? "nothing spent" : "spent today"}
        </span>
      </div>

      {/* Spend per day across the month. Occupies the space the panel used to
          leave blank, and answers the question the headline cannot: not just how
          much, but whether today was ordinary or out of line. */}
      <div className="mt-5">
        <div className="flex items-baseline justify-between gap-3">
          <span className="label-xs">Day by day</span>
          {peak > 0 && busiest.day ? (
            <span className="num shrink-0 text-[10px] text-ink-3">
              biggest {cents(busiest.cents)}
            </span>
          ) : null}
        </div>

        <div
          className="mt-2.5 flex h-12 items-end gap-[3px]"
          role="img"
          aria-label={
            peak > 0
              ? `Spending per day this month. Busiest day ${formatMoney(busiest.cents, { dp: 2 })}, out of ${formatMoney(spentCents, { dp: 2 })} so far.`
              : "No spending recorded this month yet."
          }
        >
          {dailySpend.map((d) => {
            const future = d.day > today;
            const height = peak > 0 && d.cents > 0 ? (d.cents / peak) * 100 : 0;
            const isToday = d.day === today;

            return (
              <div
                key={d.day}
                className="flex-1"
                style={{ height: "100%" }}
                title={`${d.day} · ${formatMoney(d.cents, { dp: 2 })}`}
              >
                <div
                  className="w-full rounded-t-[2px] transition-[height] duration-500"
                  style={{
                    height: future ? "0%" : `${Math.max(height, 2)}%`,
                    background: isToday
                      ? "var(--color-accent)"
                      : d.cents > 0
                        ? "var(--color-ink-3)"
                        : "var(--color-hairline-strong)",
                    opacity: future ? 0.25 : 1,
                    boxShadow: isToday && d.cents > 0 ? "0 0 9px -2px var(--color-accent)" : "none",
                  }}
                />
              </div>
            );
          })}
        </div>

        {/* Only meaningful once the month has some shape in it. "Busiest $40" for a
            month with a single transaction is a fact about one purchase, not about
            the person's habits. */}
        <p className="mt-2.5 text-[11px] leading-relaxed text-ink-3">
          {peak === 0
            ? "Nothing recorded this month yet."
            : elapsed.length <= 1
              ? "One day in, so there is no shape to read yet."
              : `Out of ${cents(spentCents)} across ${daysSpent(dailySpend, today)} ${daysSpent(dailySpend, today) === 1 ? "day" : "days"} so far.`}
        </p>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 lg:mt-auto">
        <div className="tile px-3 py-2.5">
          <div className="text-[10px] text-ink-3">
            {linked ? "This month" : "This month · sample"}
          </div>
          <div className="num mt-1 text-[15px] font-medium">{cents(spentCents)}</div>
        </div>
        <div className="tile px-3 py-2.5">
          <div className="text-[10px] text-ink-3">{linked ? "Balance" : "Balance · sample"}</div>
          <div className="num mt-1 text-[15px] font-medium">{cents(balanceCents)}</div>
        </div>
      </div>
    </section>
  );
}

/** Days so far this month with spending on them. */
function daysSpent(dailySpend: { day: string; cents: number }[], today: string): number {
  return dailySpend.filter((d) => d.day <= today && d.cents > 0).length;
}