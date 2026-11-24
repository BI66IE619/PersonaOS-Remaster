"use client";

import { useState, useSyncExternalStore } from "react";
import { Sparkline } from "@/components/sparkline";
import { getSnapshot, logSleep, subscribe, getServerSnapshot } from "@/lib/checkins";
import { shortDayLabel } from "@/lib/dates";
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
export function SleepInsights({ series, today }: { series: SleepPoint[]; today: string }) {
  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const checkIns = state?.entries ?? EMPTY_CHECKINS.entries;
  const [sleepDate, setSleepDate] = useState(today);
  const [sleepHours, setSleepHours] = useState("");

  /* Hand-entered nights fill in where the watch had nothing; a measured night always
     wins for the same day. Readiness is untouched by these — it is computed on the
     server and deliberately only scores nights with a window and stages. */
  const manual = new Map(
    checkIns.filter((c) => c.sleepMin > 0).map((c) => [c.date, c.sleepMin] as const),
  );
  const merged: SleepPoint[] = series.map((p) => ({ ...p }));
  for (const [date, minutes] of manual) {
    if (!merged.some((p) => p.date === date)) merged.push({ date, totalMin: minutes });
  }
  merged.sort((a, b) => a.date.localeCompare(b.date));

  const debt = sleepDebt(merged);
  const link = sleepVsEnergy(merged, checkIns);

  const manualEntries = checkIns
    .filter((c) => c.sleepMin > 0)
    .sort((a, b) => b.date.localeCompare(a.date));

  const saveSleep = () => {
    const h = Number(sleepHours);
    if (!Number.isFinite(h) || h <= 0) return;
    logSleep(sleepDate, Math.round(h * 60));
    setSleepHours("");
  };

  /* Hours, to match the median printed above the line. */
  const points = merged.map((p) => ({ date: p.date, value: p.totalMin / 60 }));
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
        <div className="mb-4 flex min-h-0 flex-1 flex-col">
          <div className="relative min-h-[96px] flex-1">
            <Sparkline
              points={points}
              mean={mean}
              color={color}
              height={96}
              fill
              ariaLabel={`How many hours you slept each night over the last ${points.length} nights. Last night ${last.toFixed(1)} hours, your usual night ${mean.toFixed(1)} hours.`}
            />
          </div>
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

      {/* The trend above takes the spare height (it is flex-1), so the panel is
          filled rather than split: the line gets taller and the readings follow it
          at the bottom, with no gap to open up when the check-in box beside it
          grows. */}
      <div className="shrink-0 space-y-3">
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

      {/* Watch off for a night. Entered against the wake day and folded into the
          line above; readiness deliberately ignores it. */}
      <div className="mt-4 shrink-0 border-t border-hairline pt-3">
        <span className="text-[10px] tracking-wider text-ink-3 uppercase">
          Log a missed night
        </span>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <input
            type="date"
            value={sleepDate}
            onChange={(e) => setSleepDate(e.target.value)}
            aria-label="Night"
            className="num rounded border border-hairline bg-white/[0.07] px-2 py-1 text-xs text-ink focus:border-[var(--color-accent)] focus:outline-none"
          />
          <input
            type="number"
            inputMode="decimal"
            min={0}
            step={0.1}
            value={sleepHours}
            onChange={(e) => setSleepHours(e.target.value)}
            placeholder="hours"
            aria-label="Hours slept"
            className="num w-16 rounded border border-hairline bg-white/[0.07] px-2 py-1 text-xs text-ink placeholder:text-ink-3 focus:border-[var(--color-accent)] focus:outline-none"
          />
          <button
            type="button"
            onClick={saveSleep}
            disabled={!sleepHours || Number(sleepHours) <= 0}
            className="rounded border border-hairline px-2 py-1 text-[10px] text-ink-2 transition-colors hover:border-[var(--color-accent)] disabled:opacity-40"
          >
            Add
          </button>
        </div>
        {manualEntries.length ? (
          <ul className="mt-2 space-y-1">
            {manualEntries.map((c) => (
              <li key={c.date} className="flex items-center justify-between gap-3">
                <span className="num text-[11px] text-ink-3">{shortDayLabel(c.date)}</span>
                <span className="num text-[11px] text-ink-2">{fmtH(c.sleepMin)}</span>
                <button
                  type="button"
                  onClick={() => logSleep(c.date, 0)}
                  aria-label={`Remove hand-logged sleep for ${shortDayLabel(c.date)}`}
                  className="shrink-0 rounded px-1 text-[11px] text-ink-3 transition-colors hover:text-[var(--color-low)]"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-[10px] text-ink-3">
            Only for nights the watch missed. It feeds the trend, not readiness.
          </p>
        )}
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
