"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
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
import { solid } from "@/lib/theme";
import type { CheckIn } from "@/lib/types";

const SCALES = [
  { key: "energy", label: "Energy" },
  { key: "mood", label: "Mood" },
  { key: "soreness", label: "Soreness" },
] as const;

type ScaleKey = (typeof SCALES)[number]["key"];

/** A week of history, so the row reads as a rhythm rather than a ledger. */
const TRACKED = 7;

/**
 * How the day went overall, as one of three bands.
 *
 * Soreness is inverted: it is the one scale where higher is worse, so a good day is
 * high energy and mood with low soreness, which is what someone means by a good day.
 * Without the flip a back-to-front rating would colour as the best kind of day.
 *
 * Averaged over the scales actually rated, so a day rated only for energy is not
 * dragged toward the middle by two blanks — and a day with nothing rated has no band
 * at all, which the row draws grey rather than guessing.
 */
function dayTone(e: CheckIn): "good" | "mid" | "low" {
  const parts: number[] = [];
  if (e.energy) parts.push(e.energy);
  if (e.mood) parts.push(e.mood);
  if (e.soreness) parts.push(6 - e.soreness);
  const avg = parts.reduce((a, b) => a + b, 0) / parts.length;
  if (avg >= 4) return "good";
  if (avg <= 2) return "low";
  return "mid";
}

const TONE_COLOR = {
  good: "var(--color-good)",
  mid: "var(--color-mid)",
  low: "var(--color-low)",
} as const;

/** "Thursday", for the heading while a past day is being shown. */
function weekdayName(date: string): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    timeZone: "UTC",
  }).format(new Date(`${date}T12:00:00Z`));
}

/**
 * The confirmation in front of wiping every check-in.
 *
 * Clearing is a bulk, irreversible delete: it takes the whole history the trend row
 * is drawn from, and there is nothing left to rebuild it from. So it asks first,
 * names how many days are about to go, and starts focus on the safe choice — "Keep
 * them" — so a stray Enter keeps the record rather than throwing it away. Same
 * shape as the habit delete dialog, so the two bulk actions in the app behave alike.
 */
function ConfirmClearCheckIns({
  count,
  onCancel,
  onConfirm,
}: {
  count: number;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const keep = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    keep.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center p-4"
      style={solid.overlay}
      role="dialog"
      aria-modal="true"
      aria-label="Clear all check-ins"
    >
      <div className="w-full max-w-sm p-5" style={solid.card}>
        <span className="label-xs">Are you sure?</span>

        <p className="mt-3 text-sm text-ink">
          Clear all {count} check-in{count === 1 ? "" : "s"}?
        </p>

        <p className="mt-2 text-[11px] leading-relaxed text-ink-3">
          That removes every rated day — the energy, mood and soreness history, and the
          win you wrote for each — the row above is drawn from. There is no undo.
        </p>

        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            ref={keep}
            type="button"
            onClick={onCancel}
            className="rounded-md border border-hairline px-3 py-1.5 text-[11px] text-ink-3 transition-colors hover:border-[var(--color-accent)]"
          >
            Keep them
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-md border px-3 py-1.5 text-[11px] font-medium text-ink transition-colors"
            style={{ borderColor: "var(--color-low)" }}
          >
            Clear all
          </button>
        </div>
      </div>
    </div>
  );
}

export function CheckInPanel({ today }: { today: string }) {
  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const [draft, setDraft] = useState<CheckIn | null>(null);
  const [saved, setSaved] = useState(false);
  const [askingClear, setAskingClear] = useState(false);

  /* Stable, so the dialog's focus and Escape listener are not torn down and set up
     again on every keystroke anywhere above it. */
  const cancelClear = useCallback(() => setAskingClear(false), []);
  const confirmClear = useCallback(() => {
    clearCheckIns();
    setAskingClear(false);
  }, []);

  /* Which day the scales are editing. Starts on today and follows a tap on the
     history row, so a past day can be read — and corrected — without deleting and
     recreating it. The parent keys this component on the date, so a day rollover
     remounts it back on the new today rather than leaving the old one selected. */
  const [selected, setSelected] = useState(today);
  const select = (d: string) => {
    if (d === selected) return;
    setSelected(d);
    setDraft(null);
    setSaved(false);
  };

  const stored = byDate(state.entries, selected);
  /* Nothing is ever filled in for the user. The scales start blank on a day they
     have not logged, which also means Save stays disabled until something is
     genuinely rated rather than offering to commit values on their behalf. */
  const entry = draft ?? stored;

  const rate = (key: ScaleKey, n: number) => {
    setSaved(false);
    const base = entry ?? { date: selected, energy: 0, mood: 0, soreness: 0, win: "" };
    const current = base[key] ?? 0;
    /* 0 means "not rated", so tapping the active rating has to clear it again
       or a mis-tap can never be undone. */
    setDraft({ ...base, date: selected, [key]: current === n ? 0 : n });
  };

  const setWin = (value: string) => {
    setSaved(false);
    const base = entry ?? { date: selected, energy: 0, mood: 0, soreness: 0, win: "" };
    setDraft({ ...base, date: selected, win: value });
  };

  const save = () => {
    if (!entry) return;
    saveCheckIn(selected, {
      energy: entry.energy,
      mood: entry.mood,
      soreness: entry.soreness,
      win: entry.win,
    });
    setDraft(null);
    setSaved(true);
  };

  const hasWin = !!entry?.win.trim();
  /* The win is what the day is for, so Save stays disabled until there is one.
     Ratings alone do not complete a day, and an old entry without a win cannot be
     re-saved without adding one. */
  const canSave = hasWin;

  /* Oldest on the left, today on the right, so the row reads left to right the
     way a week does. */
  const days = Array.from({ length: TRACKED }, (_, i) => addDays(today, i - (TRACKED - 1)));
  const byDay = (d: string) => byDate(state.entries, d);

  return (
    <section className="panel p-5 lg:col-span-5" aria-labelledby="checkin-heading">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="checkin-heading" className="panel-title">
          {selected === today ? "How'd today go" : `How'd ${weekdayName(selected)} go`}
        </h2>
        {selected !== today ? (
          <button
            type="button"
            onClick={() => select(today)}
            className="text-[11px] text-ink-3 transition-colors hover:text-ink-2"
          >
            Back to today
          </button>
        ) : saved ? (
          <span className="text-[11px] text-ink-3">Saved</span>
        ) : null}
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

      {/* The win, in its own box: the part of a day that survives a bad one, and
          the one thing that is required. Save stays disabled until it is named. */}
      <div className="mt-4 rounded-lg border border-hairline-strong bg-white/[0.03] p-3">
        <label htmlFor="checkin-win" className="label-xs">
          One good thing
        </label>
        <p className="mt-1 text-[11px] leading-relaxed text-ink-3">
          A reason today counted, however small. This is the part worth keeping from a
          day that went wrong.
        </p>
        <textarea
          id="checkin-win"
          value={entry?.win ?? ""}
          onChange={(e) => setWin(e.target.value)}
          rows={2}
          maxLength={2000}
          placeholder="What went right, even a little?"
          className="mt-2 w-full resize-none rounded-lg border border-hairline bg-white/[0.07] px-3 py-2 text-[13px] leading-relaxed text-ink placeholder:text-ink-3 focus:border-[var(--color-accent)] focus:outline-none"
        />
        {!hasWin ? (
          <p className="mt-1.5 text-[10px] text-ink-3">Name one to save the day.</p>
        ) : null}
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
              removeCheckIn(selected);
              setDraft(null);
              setSaved(false);
            }}
            className="text-[11px] text-ink-3 transition-colors hover:text-[var(--color-low)]"
          >
            {selected === today ? "Clear today" : "Clear this day"}
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
              const isToday = d === today;
              /* A day with a win but no ratings is logged, just unscored — it gets
                 the accent rather than a tone it did not earn, and grey stays for
                 days with nothing at all. */
              const scored = e ? e.energy || e.mood || e.soreness : 0;
              return (
                <li key={d} className="flex-1">
                  {/* A button, so a past day can be opened and read — and fixed — the
                      same way today is. The bar keeps its tone colour; only the cell
                      around it gained a press and a selected state. */}
                  <button
                    type="button"
                    onClick={() => select(d)}
                    aria-pressed={selected === d}
                    aria-label={
                      e
                        ? `${shortDayLabel(d)}: energy ${e.energy || "–"}, mood ${e.mood || "–"}, soreness ${e.soreness || "–"}${e.win ? ", win noted" : ""}`
                        : `${shortDayLabel(d)}: not logged`
                    }
                    className={[
                      "block w-full rounded-md px-0.5 py-1 text-center transition-colors",
                      selected === d ? "bg-white/[0.10]" : "hover:bg-white/[0.06]",
                    ].join(" ")}
                  >
                    <span
                      className={`block text-[9px] ${
                        isToday || selected === d ? "font-semibold text-ink" : "text-ink-3"
                      }`}
                    >
                      {shortDayLabel(d).slice(0, 1)}
                    </span>
                    {/* One bar per day, coloured by how the day went overall rather
                        than by a single scale. Grey when nothing was logged, which is
                        the honest read of a day that has no answer rather than a bad
                        one. */}
                    <span
                      className="mt-1 block h-1.5 rounded-full"
                      style={{
                        background: e
                          ? scored
                            ? TONE_COLOR[dayTone(e)]
                            : "var(--color-accent-dim)"
                          : "var(--color-hairline-strong)",
                        opacity: e ? 1 : 0.6,
                      }}
                    />
                    {/* Today is the last cell at the right of the row, so it needs a
                        word rather than relying on the position alone. */}
                    {isToday ? (
                      <span className="mt-0.5 block text-[8px] leading-none text-ink-3">today</span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
          {state.entries.length ? (
            <button
              type="button"
              onClick={() => setAskingClear(true)}
              className="mt-3 self-start text-[11px] text-ink-3 transition-colors hover:text-[var(--color-low)]"
            >
              Clear all check-ins
            </button>
          ) : null}
        </div>
      ) : null}

      {askingClear ? (
        <ConfirmClearCheckIns
          count={state.entries.length}
          onCancel={cancelClear}
          onConfirm={confirmClear}
        />
      ) : null}
    </section>
  );
}
