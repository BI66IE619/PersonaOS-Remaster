"use client";

import { useState, useSyncExternalStore } from "react";
import { addDays, shortDayLabel } from "@/lib/dates";
import {
  byDate,
  clearCheckIns,
  getServerSnapshot,
  getSnapshot,
  removeCheckIn,
  saveCheckIn,
  subscribe,
} from "@/lib/checkins";
import type { CheckIn } from "@/lib/types";

const SCALES = [
  { key: "energy", label: "Energy" },
  { key: "mood", label: "Mood" },
  { key: "soreness", label: "Soreness" },
] as const;

type ScaleKey = (typeof SCALES)[number]["key"];

/** Ten days of history, so the row reads as a rhythm rather than a ledger. */
const TRACKED = 10;

const DOT: Record<number, string> = {
  1: "bg-[var(--color-low)]",
  2: "bg-[var(--color-mid)]",
  3: "bg-[var(--color-base)]",
  4: "bg-[var(--color-high)]",
  5: "bg-[var(--color-high)]",
};

export function CheckInPanel({ today }: { today: string }) {
  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const [draft, setDraft] = useState<CheckIn | null>(null);
  const [saved, setSaved] = useState(false);

  const stored = byDate(state.entries, today);
  /* Nothing is ever filled in for the user. The scales start blank on a day they
     have not logged, which also means Save stays disabled until something is
     genuinely rated rather than offering to commit values on their behalf. */
  const entry = draft ?? stored;

  const rate = (key: ScaleKey, n: number) => {
    setSaved(false);
    const base = entry ?? { date: today, energy: 0, mood: 0, soreness: 0 };
    const current = base[key] ?? 0;
    /* 0 means "not rated", so tapping the active rating has to clear it again
       or a mis-tap can never be undone. */
    setDraft({ ...base, date: today, [key]: current === n ? 0 : n });
  };

  const save = () => {
    if (!entry) return;
    saveCheckIn(today, { energy: entry.energy, mood: entry.mood, soreness: entry.soreness });
    setDraft(null);
    setSaved(true);
  };

  const rated = !!entry && (!!entry.energy || !!entry.mood || !!entry.soreness);
  /* An existing day can be emptied out to delete it, so keep the button live
     when there is something stored to clear. Otherwise clearing every scale
     would disable the only control that could remove the row. */
  const canSave = rated || !!stored;

  const days = Array.from({ length: TRACKED }, (_, i) => addDays(today, -i));
  const byDay = (d: string) => byDate(state.entries, d);

  return (
    <section className="panel p-5 lg:col-span-5" aria-labelledby="checkin-heading">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="checkin-heading" className="panel-title">
          How&apos;d today go
        </h2>
        {saved ? <span className="text-[11px] text-ink-3">Saved</span> : null}
      </div>

      <div className="mt-4 space-y-3">
        {SCALES.map((s) => (
          <div key={s.key} className="flex items-center justify-between gap-3">
            <span className="w-14 shrink-0 text-[11px] text-ink-3">{s.label}</span>
            <div className="flex flex-1 items-center gap-1.5" role="group" aria-label={s.label}>
              {[1, 2, 3, 4, 5].map((n) => {
                const on = (entry?.[s.key] ?? 0) === n;
                return (
                  <button
                    key={n}
                    type="button"
                    onClick={() => rate(s.key, n)}
                    aria-pressed={on}
                    aria-label={`${s.label} ${n} of 5`}
                    className={`num h-8 flex-1 rounded-md border text-[11px] transition-colors ${
                      on
                        ? "border-[var(--color-accent)] bg-white/[0.10] text-ink"
                        : "border-hairline text-ink-3 hover:border-[var(--color-accent)] hover:text-ink-2"
                    }`}
                  >
                    {n}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={!canSave}
          className="rounded-md border border-hairline px-2.5 py-1 text-[11px] text-ink-2 transition-colors hover:border-[var(--color-accent)] disabled:opacity-40"
        >
          {stored ? "Update" : "Save"}
        </button>
        {stored ? (
          <button
            type="button"
            onClick={() => {
              removeCheckIn(today);
              setDraft(null);
              setSaved(false);
            }}
            className="text-[11px] text-ink-3 transition-colors hover:text-[var(--color-low)]"
          >
            Clear today
          </button>
        ) : null}
      </div>

      {state.entries.length ? (
        <div className="mt-5 border-t border-hairline pt-4">
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-ink-3">Last {TRACKED} days</span>
            <span className="text-[10px] text-ink-3">
              {state.entries.length} logged
            </span>
          </div>
          <ul className="mt-2.5 flex gap-1.5">
            {days.map((d) => {
              const e = byDay(d);
              return (
                <li key={d} className="flex-1 text-center">
                  <span className="block text-[9px] text-ink-3">{shortDayLabel(d).slice(0, 1)}</span>
                  <span
                    title={e ? `${shortDayLabel(d)}: mood ${e.mood || "–"}, energy ${e.energy || "–"}, soreness ${e.soreness || "–"}` : `${shortDayLabel(d)}: not logged`}
                    className={`mt-1 block h-1.5 rounded-full ${e?.mood ? DOT[e.mood] : "bg-white/[0.07]"}`}
                  />
                </li>
              );
            })}
          </ul>
          {state.entries.length ? (
            <button
              type="button"
              onClick={clearCheckIns}
              className="mt-3 self-start text-[11px] text-ink-3 transition-colors hover:text-[var(--color-low)]"
            >
              Clear all check-ins
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
