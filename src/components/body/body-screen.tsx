"use client";

import Link from "next/link";
import { PageShell } from "@/components/page-shell";
import { BodyPanel } from "@/components/body/body-panel";
import { ProgressPhotos } from "@/components/progress-photos";
import { StrengthLog } from "@/components/strength-log";
import { StrengthProgress } from "@/components/strength-progress";
import { StrengthStreak } from "@/components/strength-streak";
import { WeightLog } from "@/components/weight-log";
import { TrainingInsights } from "@/components/training-insights";
import type { TodayView } from "@/lib/types";

export function BodyScreen({ view, userId }: { view: TodayView; userId: string }) {
  return (
    /* Body is a sub-page of Vitality, not a top-level destination, so the
       nav still marks Vitality current and navigation happens via the back
       button below. */
    <PageShell>
        <div className="py-4">
          <Link
            href="/vitals"
            className="inline-flex items-center gap-1.5 rounded-full border border-hairline bg-white/[0.06] px-3 py-1.5 text-xs text-ink-2 transition-colors hover:bg-white/[0.1]"
          >
            <span aria-hidden>&larr;</span>
            Back to Vitality
          </Link>
        </div>

        {/* No items-start: the two columns are deliberately allowed to differ in
            height, and the shorter one stretches so the panels beside each other
            can finish level. Only the log row has two columns in it, so this
            changes nothing for the full-width panels above and below — they are
            alone in their row and their height is their own content. */}
        <main className="grid grid-cols-1 gap-4 lg:grid-cols-12">
          <BodyPanel body={view.body} date={view.date} className="lg:col-span-12" />

          <TrainingInsights date={view.date} />

          {/* Both columns are flex, because the grid gap only applies between
              grid items and these panels stack inside one section — without it
              they come out flush against each other with no space at all.

              Personal bests sits with the strength log rather than with the
              streak because of what the columns weighed. It was the third
              panel in the right-hand stack, which left that column 486px tall
              against the log's 288px, and the grid gap does nothing about a
              difference in height: it put a 198px hole down the left of the
              lower half of Lifting streak and all of Personal bests, which read
              as a panel that had failed to render rather than as two columns of
              different lengths. Moving it across balances the columns to within
              about 40px of each other, which is ordinary raggedness.

              It is also where it belongs on the merits: the log is the record of
              what was lifted, and the bests are what that record produced. The
              streak is a different kind of claim — a run of sessions rather than
              a weight — and it belongs beside the weight log. */}
          <section className="flex flex-col gap-4 lg:col-span-6">
            <StrengthLog date={view.date} />
            <StrengthProgress date={view.date} />
          </section>

          <section className="flex flex-col gap-4 lg:col-span-6">
            <WeightLog date={view.date} />
            {/* flex-1 so the streak grows to the height of the column beside it
                and its bottom edge lines up with Personal bests, rather than
                stopping short and leaving the two boxes visibly unlevel. */}
            <StrengthStreak date={view.date} className="flex-1" />
          </section>

          <section className="lg:col-span-12">
            <ProgressPhotos date={view.date} userId={userId} />
          </section>
        </main>
    </PageShell>
  );
}
