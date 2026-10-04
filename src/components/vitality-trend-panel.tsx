"use client";

import { Sparkline } from "@/components/sparkline";
import { vitalityTrend } from "@/lib/insights";
import type { Spark } from "@/lib/types";

/**
 * The month-long line, deliberately not a number for today.
 *
 * Readiness already judges today, and judging it again here would only give
 * two numbers to disagree. What this catches is drift: every night a little
 * worse than the last, with no single day bad enough to notice on its own. That
 * is the failure mode a daily score is worst at seeing, and the reason this
 * exists as a line.
 */
export function VitalityTrendPanel({ sparks }: { sparks: Spark[] }) {
  const trend = vitalityTrend(sparks);
  const points = trend.points.map((p) => ({ date: p.date, value: p.value }));
  const color =
    trend.direction === "down"
      ? "var(--color-low)"
      : trend.direction === "up"
        ? "var(--color-good)"
        : "var(--color-ink-2, currentColor)";

  return (
    <section className="panel p-5 lg:col-span-12">
      <div className="mb-3 flex items-center justify-between gap-3">
        <span className="label-xs">The last month, all together</span>
        {trend.enough && (
          <span className="num text-[11px]" style={{ color }}>
            {trend.current}
            {trend.change !== null && (
              <span className="text-ink-3">
                {" "}
                ({trend.change > 0 ? "+" : ""}
                {trend.change})
              </span>
            )}
          </span>
        )}
      </div>

      {points.length >= 2 ? (
        <Sparkline
          points={points}
          mean={50}
          color={color}
          height={54}
          ariaLabel={`Overall vitality over the last month, currently ${trend.current}, ${trend.change !== null && trend.change >= 0 ? "up" : "down"} ${Math.abs(trend.change ?? 0)} points`}
        />
      ) : null}

      <p className={`mt-3 text-xs leading-relaxed ${trend.enough ? "text-ink-2" : "text-ink-3"}`}>
        {trend.verdict}
      </p>

      {trend.enough && (
        <p className="mt-2 text-[11px] leading-relaxed text-ink-3">
          Night and recovery {trend.night >= 0 ? "+" : ""}
          {trend.night}, training load {trend.training >= 0 ? "+" : ""}
          {trend.training} against your own normal.
        </p>
      )}
    </section>
  );
}
