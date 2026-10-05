"use client";

import Link from "next/link";
import { useEffect } from "react";
import { PageShell } from "@/components/page-shell";
import { DayHeader } from "@/components/day-header";
import { DriverChip } from "@/components/driver-chip";
import { RadialStat } from "@/components/radial-stat";
import { AgendaPanel } from "@/components/home/agenda-panel";
import { HabitsTodayPanel } from "@/components/home/habits-today-panel";
import { LoggedTodayPanel } from "@/components/home/logged-today-panel";
import { MoneyTodayPanel, type TodayMoney } from "@/components/home/money-today-panel";
import { VitalityTrendPanel } from "@/components/vitality-trend-panel";
import { seedStrength } from "@/lib/strength";
import type { TodayView } from "@/lib/types";

const BAND_WORD = { high: "Primed", mid: "Steady", low: "Recover" } as const;

/**
 * The text arrives already chosen. See @/lib/welcomes for why the picking
 * happens on the server rather than here.
 */
function Welcome({ welcome }: { welcome: string }) {
  return (
    <header className="pt-7 pb-2">
      <h1 className="text-[27px] leading-[1.1] font-semibold tracking-tight">{welcome}</h1>
    </header>
  );
}

/**
 * The one screen that answers "what does my day look like". Health gets a
 * verdict and a score because that is the day's read, not a chart; everything
 * below it is a cross-domain rollup that no single tab could show on its own.
 *
 * Vitality keeps the depth — sleep stages, activity, trends, the check-in.
 */
export function HomeScreen({
  view,
  money,
  welcome,
}: {
  view: TodayView;
  money: TodayMoney;
  welcome: string;
}) {
  /* The lifting programme installs itself on first run — that is app setup, not
     sample data. Everything else starts empty: no invented tasks, no invented
     habits, no invented anything. */
  useEffect(() => {
    seedStrength();
  }, []);

  return (
    <PageShell>
      <Welcome welcome={welcome} />

      <DayHeader date={view.date} timezone={view.timezone} freshness={view.freshness} />

      <main className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        {/* verdict — the reason to open the app */}
        <section className="panel relative overflow-hidden p-5 lg:col-span-8 sm:p-6">
          <div
            className="pointer-events-none absolute -top-24 -right-16 h-64 w-64 rounded-full opacity-60"
            style={{
              background:
                "radial-gradient(circle, color-mix(in oklab, var(--color-accent) 9%, transparent) 0%, transparent 70%)",
            }}
          />
          <div className="label-xs">Today&apos;s read</div>
          <p className="glow-text relative mt-3 max-w-[42ch] text-[26px] leading-[1.15] font-semibold tracking-tight text-balance sm:text-[32px]">
            {view.verdict}
          </p>
          <div className="relative mt-6 flex flex-col gap-2 sm:flex-row">
            {view.drivers.map((d) => (
              <DriverChip key={d.label} driver={d} />
            ))}
          </div>
        </section>

        {/* readiness ring */}
        <section className="panel flex flex-col items-center justify-center gap-4 p-5 lg:col-span-4">
          <RadialStat
            value={view.readiness.score}
            caption={BAND_WORD[view.readiness.band]}
            ariaLabel={`Readiness ${view.readiness.score} of 100, ${BAND_WORD[view.readiness.band]}`}
          />
        </section>

        <AgendaPanel today={view.date} />
        <HabitsTodayPanel today={view.date} />
        <VitalityTrendPanel sparks={view.sparks} />
        <MoneyTodayPanel {...money} />
        <LoggedTodayPanel today={view.date} workouts={view.today.workouts} />
      </main>

      <Link
        href="/vitals"
        className="panel mt-4 flex items-center justify-between gap-3 px-4 py-3.5 transition-colors hover:bg-white/[0.07]"
      >
        <span className="min-w-0">
          <span className="block text-sm font-medium">Vitality in detail</span>
          <span className="block text-[11px] text-ink-3">
            Sleep, activity, the check-in, and 30 days
          </span>
        </span>
        <span className="num shrink-0 text-lg text-ink-3" aria-hidden>
          &rsaquo;
        </span>
      </Link>
    </PageShell>
  );
}
