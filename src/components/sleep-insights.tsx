"use client";

import { useSyncExternalStore } from "react";
import { Sparkline } from "@/components/sparkline";
import { getSnapshot, subscribe, getServerSnapshot } from "@/lib/checkins";
import { sleepDebt, sleepVsEnergy } from "@/lib/insights";
import type { SleepPoint } from "@/lib/insights";

const EMPTY_CHECKINS = { entries: [] };

/**
 * The two things a night's sleep tells you that a single night's sleep cannot:
 * what you owe, and whether it actually moves your day. Both stay quiet until
 * there is enough behind them — a debt off two nights, or a "sleep changes
 * your energy" claim off three, would just be noise dressed as insight.
 *
 * The line is the title made literal. It was called "Sleep, over time" while
 * showing only the two readings, which left the panel half empty in a grid row
 * sized by the check-in beside it; the trend is also the one thing the two
 * readings cannot show on their own.
 */
export function SleepInsights({ series }: { series: SleepPoint[] }) {
  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const checkIns = state?.entries ?? EMPTY_CHECKINS.entries;

  const debt = sleepDebt(series);
  const link = sleepVsEnergy(series, checkIns);

  /* Hours, to match the median printed above the line. */
  const points = series.map((p) => ({ date: p.date, value: p.totalMin / 60 }));
  const last = points[points.length - 1]?.value ?? 0;
  const mean = debt.enough
    ? debt.medianMin / 60
    : points.length
      ? points.reduce((sum, p) => sum + p.value, 0) / points.length
      : 0;
  /* More sleep is better, so a night under your own usual is the "low" case —
     the opposite of the readiness sparklines, which read high as good. */
  const diff = last - mean;
  const under = debt.enough && last < mean;
  const color = debt.enough
    ? under
      ? "var(--color-low)"
      : "var(--color-good)"
    : "var(--color-ink-3)";

  return (
    <section className="panel flex flex-col p-5 lg:col-span-7">
      <div className="mb-4 flex shrink-0 items-center justify-between gap-3">
        <span className="label-xs">Sleep, over time</span>
        {debt.enough && (
          <span className="num text-[11px] text-ink-3">usually {fmtH(debt.medianMin)}</span>
        )}
      </div>

      {points.length >= 2 ? (
        <div className="mb-4">
          <Sparkline
            points={points}
            mean={mean}
            color={color}
            height={96}
            ariaLabel={`How many hours you slept each night over the last ${points.length} nights. Last night ${last.toFixed(1)} hours, your usual night ${mean.toFixed(1)} hours.`}
          />
          {/* Plain words for what the line means. A sparkline with a dashed
              reference asks the reader to work out which line is which and what
              direction is good; this says it outright. */}
          <div className="mt-2 flex items-baseline justify-between gap-3">
            <span className="text-[11px] text-ink-3">Each night you slept, newest on the right.</span>
            {debt.enough ? (
              <span className="num shrink-0 text-xs font-medium" style={{ color }}>
                {diff >= 0 ? "+" : "−"}
                {Math.abs(diff).toFixed(1)}h vs usual
              </span>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="mt-auto space-y-3">
        <Read
          title="Sleep debt"
          body={debt.verdict}
          muted={!debt.enough}
          stat={
            debt.enough && debt.debtMin > 0 ? fmtH(debt.debtMin) : debt.enough ? "clear" : "—"
          }
          statGood={debt.enough && debt.debtMin === 0}
        />
        <Read title="Sleep and your energy" body={link.verdict} muted={!link.enough} />
      </div>
    </section>
  );
}

function fmtH(min: number) {
  return `${(Math.round((min / 60) * 10) / 10).toString()}h`;
}

function Read({
  title,
  body,
  muted,
  stat,
  statGood,
}: {
  title: string;
  body: string;
  muted?: boolean;
  stat?: string;
  statGood?: boolean;
}) {
  return (
    <div className="tile px-3.5 py-3">
      <div className="flex items-baseline justify-between gap-3">
        <span className="label-xs">{title}</span>
        {stat && (
          <span
            className="num shrink-0 text-sm font-medium"
            style={{ color: statGood ? "var(--color-good)" : "var(--color-ink-2, inherit)" }}
          >
            {stat}
          </span>
        )}
      </div>
      <p className={`mt-1.5 text-xs leading-relaxed ${muted ? "text-ink-3" : "text-ink-2"}`}>
        {body}
      </p>
    </div>
  );
}
