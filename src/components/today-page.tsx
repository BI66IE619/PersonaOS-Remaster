import Link from "next/link";
import { PageShell } from "@/components/page-shell";
import { CheckInPanel } from "@/components/check-in-panel";
import { DayHeader } from "@/components/day-header";
import { HealthConnectCard } from "@/components/health-connect-card";
import { SleepStageBar } from "@/components/sleep-stage-bar";
import { SleepInsights } from "@/components/sleep-insights";
import { Sparkline } from "@/components/sparkline";
import { TodaySessions } from "@/components/sport-session-today";
import { SportWeekSummary } from "@/components/sport-week-summary";
import { formatClock } from "@/lib/format";
import type { TodayView } from "@/lib/types";

/**
 * The depth behind Home's verdict: the night that caused it, what today has
 * looked like so far, how it felt, and thirty days of context. The one-line
 * read and the readiness ring live on Home so there is only one verdict.
 */
export function TodayPage({ view }: { view: TodayView }) {
  const { lastNight, today, timezone } = view;
  const stepsPct = Math.min(100, (today.steps / today.stepGoal) * 100);

  return (
    <PageShell>
      <DayHeader date={view.date} timezone={view.timezone} freshness={view.freshness} />

      <main className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        {/* Only renders in the phone app; nothing on the web. */}
        <HealthConnectCard />

        {/* last night */}
        <section className="panel flex flex-col p-5 lg:col-span-7">
          <div className="mb-4 flex shrink-0 items-center justify-between gap-3">
            <span className="label-xs">Last night</span>
            <span className="num text-[11px] text-ink-3">
              {formatClock(lastNight.bedtime, timezone)} {"→"}{" "}
              {formatClock(lastNight.wakeTime, timezone)}
            </span>
          </div>
          <div className="flex min-h-0 flex-1 flex-col">
            <SleepStageBar
              stages={lastNight.stages}
              totalMin={lastNight.totalMin}
              efficiency={lastNight.efficiency}
              fill
            />
          </div>
        </section>

        {/* today */}
        <section className="panel p-5 lg:col-span-5">
          <span className="label-xs">Today</span>

          <div className="mt-4">
            <div className="flex items-baseline justify-between">
              <span className="num text-3xl font-semibold tracking-tight">
                {today.steps.toLocaleString("en-US")}
              </span>
              <span className="num text-xs text-ink-3">
                / {today.stepGoal.toLocaleString("en-US")}
              </span>
            </div>
            <div className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-inset">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${stepsPct}%`,
                  background: "linear-gradient(90deg, var(--color-accent-dim), var(--color-accent))",
                  boxShadow: "0 0 12px -2px #ffffff",
                }}
              />
            </div>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-3">
            <div className="tile px-3 py-2.5">
              <div className="label-xs">Active</div>
              <div className="num mt-1 text-lg font-medium">{today.activeMin}m</div>
            </div>
            <div className="tile px-3 py-2.5">
              <div className="label-xs">Burned</div>
              <div className="num mt-1 text-lg font-medium">
                {today.calories.total.toLocaleString("en-US")}
              </div>
            </div>
          </div>

          <div className="mt-4 space-y-2">
            <TodaySessions date={view.date} workouts={today.workouts} />
            <SportWeekSummary today={view.date} />
          </div>
        </section>

        {/* how the day actually felt */}
        <CheckInPanel today={view.date} />

        <SleepInsights series={view.sleepSeries} />

        {/* Sparks close the grid, so they take the full twelve columns. At seven
            they left the last five empty, which read as a hole beside the panel
            rather than a deliberate column. Home renders this same panel at
            twelve, and these are stacked sparklines either way, so full width is
            the arrangement the rest of the app already uses. */}
        <section className="panel p-5 lg:col-span-12">
          <div className="mb-4 flex items-center justify-between">
            <span className="label-xs">30 days</span>
            <span className="flex items-center gap-2 text-[10px] text-ink-3">
              <span className="inline-block h-px w-4 border-t border-dashed border-ink-3" />
              your mean
            </span>
          </div>
          <div className="space-y-4">
            {view.sparks.map((s) => {
              const last = s.points[s.points.length - 1]?.value ?? 0;
              const diff = last - s.baseline.mean;
              const bad = s.higherIsBetter ? diff < 0 : diff > 0;
              const color = bad ? "var(--color-low)" : "var(--color-good)";
              return (
                <div key={s.key}>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-xs text-ink-2">{s.label}</span>
                    <span className="num text-xs font-medium" style={{ color }}>
                      {last}
                      <span className="text-ink-3">{s.unit}</span>
                    </span>
                  </div>
                  <div className="mt-1.5">
                    <Sparkline
                      points={s.points}
                      mean={s.baseline.mean}
                      color={color}
                      height={38}
                      ariaLabel={`${s.label}, 30 day trend, currently ${last}${s.unit} against a mean of ${s.baseline.mean}`}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </main>

      <Link
        href="/body"
        className="panel mt-4 flex items-center justify-between gap-3 px-4 py-3.5 transition-colors hover:bg-white/[0.07]"
      >
        <span className="min-w-0">
          <span className="block text-sm font-medium">Body &amp; training</span>
          <span className="block text-[11px] text-ink-3">
            Weight, workouts, and photos
          </span>
        </span>
        <span className="num shrink-0 text-lg text-ink-3" aria-hidden>
          &rsaquo;
        </span>
      </Link>
    </PageShell>
  );
}
