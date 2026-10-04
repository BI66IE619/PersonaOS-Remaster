"use client";

import { useSyncExternalStore } from "react";
import { Sparkline } from "@/components/sparkline";
import { kgToLb, signed } from "@/lib/format";
import { EMPTY_LOGS, getServerSnapshot, getSnapshot, logsOf, subscribe } from "@/lib/weight-log";
import { daysBetween } from "@/lib/dates";
import type { TodayView } from "@/lib/types";

type Body = TodayView["body"];

const WINDOW_DAYS = 30;

/**
 * The Body card used to be a server component reading the seeded kg-based
 * series and nothing else, so it kept showing the same number no matter what you
 * logged — the page carried two current weights, and the one you had just edited
 * was the one the card ignored.
 *
 * It now prefers your own log. That log is in pounds and lives in the browser,
 * so it cannot come from the server-rendered `body` prop; it is read here, and
 * the seeded series is the fallback for the first run before any weigh-in.
 *
 * Body fat is still the seeded estimate, because nothing in the app logs it.
 */
export function BodyPanel({
  body,
  date,
  className = "",
}: {
  body: Body;
  date: string;
  className?: string;
}) {
  const logs = logsOf(useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)) ?? EMPTY_LOGS;

  /* Only the window the card claims to cover, and never a future-dated entry. */
  const own = Object.keys(logs)
    .filter((d) => d <= date && daysBetween(d, date) <= WINDOW_DAYS)
    .sort();

  const ownLatest = own.length ? logs[own[own.length - 1]] : null;
  const useOwn = ownLatest !== null;

  const weightLb = useOwn ? ownLatest : kgToLb(body.weightKg);
  /* With one weigh-in in the window there is no change to report, so the figure
     is withheld rather than shown as a flat zero, which reads as "held steady". */
  const deltaLb = useOwn
    ? own.length > 1
      ? logs[own[0]] - ownLatest
      : null
    : kgToLb(body.weightDeltaKg);

  const points = useOwn ? own.map((d) => ({ date: d, value: logs[d] })) : body.points;
  const mean = useOwn
    ? own.reduce((sum, d) => sum + logs[d], 0) / own.length
    : body.mean;

  const source = useOwn ? "your weigh-ins" : "estimated";

  return (
    <section className={`panel p-5 ${className}`}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <span className="label-xs">Body</span>
        <span className="text-[10px] text-ink-3">30 days</span>
      </div>

      <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:gap-8">
        <div className="shrink-0">
          <div className="flex items-baseline gap-3">
            <span className="num text-3xl font-semibold tracking-tight">
              {weightLb.toFixed(1)}
              <span className="ml-1 text-base font-normal text-ink-3">lb</span>
            </span>
            {deltaLb !== null ? (
              <span className="num text-xs text-ink-2">{signed(deltaLb, " lb", 1)}</span>
            ) : null}
          </div>

          <div className="mt-4">
            <div className="label-xs">Body fat</div>
            <div className="num mt-1 text-lg font-medium">
              {body.bodyFatPct.toFixed(1)}%
            </div>
          </div>
        </div>

        <div className="min-w-0 flex-1">
          <Sparkline
            points={points}
            mean={mean}
            color="var(--color-accent-dim)"
            height={38}
            ariaLabel={`Body weight, 30 day trend from ${source}, currently ${weightLb.toFixed(1)} pounds against a mean of ${mean.toFixed(1)}`}
          />
        </div>
      </div>
    </section>
  );
}
