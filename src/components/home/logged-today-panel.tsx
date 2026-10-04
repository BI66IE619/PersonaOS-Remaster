"use client";

import Link from "next/link";
import type { Route } from "next";
import { useSyncExternalStore } from "react";
import { byDate as checkInByDate, getServerSnapshot as ciServer, getSnapshot as ciSnapshot, subscribe as ciSub } from "@/lib/checkins";
import { getServerSnapshot as weightServer, getSnapshot as weightSnapshot, logsOf, subscribe as weightSub, weightDue } from "@/lib/weight-log";
import { SportSessionRow } from "@/components/home/sport-session-row";
import type { TodayView } from "@/lib/types";

/** One slot per day, so the two rows never disagree about what "today" is. */
/** A plain span, never a button: this sits inside a Link and a button cannot be
 *  nested in one. Colour carries the urgency and the text says it outright. */
function OverdueMark({ title }: { title: string }) {
  return (
    <span
      className="num shrink-0 text-[11px] font-semibold"
      style={{ color: "var(--color-low)" }}
      title={title}
    >
      !
    </span>
  );
}

function State({
  href,
  label,
  done,
  detail,
  cta,
  mark,
}: {
  href: Route;
  label: string;
  done: boolean;
  detail: string;
  cta: string;
  mark?: string;
}) {
  return (
    <Link
      href={href}
      className="tile flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-white/[0.07]"
    >
      <span
        className="h-2 w-2 shrink-0 rounded-full"
        style={{
          background: done ? "var(--color-good)" : "var(--color-hairline-strong)",
          boxShadow: done ? "0 0 8px var(--color-good)" : "none",
        }}
      />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{label}</span>
        <span className="block truncate text-[11px] text-ink-3">{detail}</span>
      </span>
      {mark ? <OverdueMark title={mark} /> : null}
      <span className="shrink-0 text-[11px] text-ink-3">{cta}</span>
      <span className="num shrink-0 text-lg text-ink-3" aria-hidden>
        &rsaquo;
      </span>
    </Link>
  );
}

/**
 * Whether today has been written down, not the writing itself. The check-in
 * stays on Vitality — this only says whether it is still empty, so a day can
 * be closed without hunting for it. Notes are deliberately absent: they are
 * scratch space, not a daily journal, so a missing note is not a gap.
 */
export function LoggedTodayPanel({ today, workouts }: { today: string; workouts?: TodayView["today"]["workouts"] }) {
  const checkIns = useSyncExternalStore(ciSub, ciSnapshot, ciServer);
  const weights = logsOf(useSyncExternalStore(weightSub, weightSnapshot, weightServer));

  const ci = checkInByDate(checkIns.entries, today);

  const rated = ci ? [ci.energy, ci.mood, ci.soreness].filter((v) => v > 0).length : 0;
  /* Only a check-in the user actually saved counts. A provider is free to
     invent sleep and heart rate, but not to say they rated their own mood. */
  const ciDone = Boolean(ci);

  /* The weigh-in is a prompt, not a record: it only earns a place here while it
     is outstanding, so it appears the day it comes due and leaves the moment it
     is done. Sharing the cadence with the log keeps the two in step. */
  const weighIn = weightDue(weights, today);
  const weighInDetail =
    weighIn.daysSince === null
      ? "No weigh-in yet"
      : weighIn.daysSince === 1
        ? "Last one 1 day ago"
        : `Last one ${weighIn.daysSince} days ago`;

  return (
    <section className="panel flex flex-col p-5 lg:col-span-7">
      <span className="label-xs shrink-0">Logged today</span>
      <div className="mt-4 flex flex-1 flex-col justify-center gap-2">
        <State
          href="/vitals"
          label="How the day went"
          done={ciDone}
          detail={
            ciDone
              ? rated > 0
                ? `${rated} of 3 rated`
                : "rated"
              : "Not rated yet"
          }
          cta="Vitality"
          mark={ciDone ? undefined : "Not logged yet"}
        />
        <SportSessionRow today={today} workouts={workouts} />
        {weighIn.due ? (
          <State
            href="/body"
            label="Weigh in"
            done={false}
            detail={weighInDetail}
            cta="Body"
            mark="Weigh-in overdue"
          />
        ) : null}
      </div>
    </section>
  );
}
