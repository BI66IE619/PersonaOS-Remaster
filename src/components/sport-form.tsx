"use client";

import { useState } from "react";
import { addSession } from "@/lib/sports";

export const SPORTS = [
  "Soccer",
  "Basketball",
  "Football",
  "Tennis",
  "Swimming",
  "Running",
  "Cycling",
  "Martial arts",
  "Volleyball",
  "Other",
] as const;

/* The app's panel/tile styles are translucent glass, which only works on top of
   the dark page. Inside a modal there is nothing solid behind them, so this
   form carries its own solid surfaces instead of those utilities. */
const solid = {
  overlay: { background: "var(--color-base)" },
  card: {
    background: "var(--color-surface)",
    border: "1px solid var(--color-hairline-strong)",
    borderRadius: "var(--radius-panel)",
  },
  field: {
    background: "var(--color-inset)",
    border: "1px solid var(--color-hairline)",
    borderRadius: 10,
  },
} as const;

/**
 * The one place a sport session gets written down, shared by the Home prompt
 * and the Vitality add button. Deliberately dumb: no parsing of event titles,
 * no guesses — the five fields are faster than correcting a wrong prefill.
 */
export function SportForm({ today, onClose }: { today: string; onClose: () => void }) {
  const [sport, setSport] = useState("");
  const [kind, setKind] = useState<"" | "practice" | "game">("");
  const [hours, setHours] = useState("");
  const [minutes, setMinutes] = useState("");
  const [intensity, setIntensity] = useState(0);

  const total = (Number(hours) || 0) * 60 + (Number(minutes) || 0);
  const valid = sport !== "" && kind !== "" && total > 0 && intensity > 0;

  const save = () => {
    if (!valid) return;
    addSession({
      date: today,
      sport,
      kind: kind as "practice" | "game",
      minutes: total,
      intensity,
      source: "manual",
    });
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center p-4"
      style={solid.overlay}
      role="dialog"
      aria-modal="true"
      aria-label="Log a sports session"
    >
      <div className="w-full max-w-sm p-5" style={solid.card}>
        <span className="label-xs">Sports session</span>

        <div className="mt-4 flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-ink-3">Sport</span>
            <select
              value={sport}
              onChange={(e) => setSport(e.target.value)}
              className="w-full px-3 py-2 text-sm text-ink outline-none"
              style={solid.field}
            >
              <option value="" disabled>
                Pick one
              </option>
              {SPORTS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-ink-3">Type</span>
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as "practice" | "game")}
              className="w-full px-3 py-2 text-sm text-ink outline-none"
              style={solid.field}
            >
              <option value="" disabled>
                Pick one
              </option>
              <option value="practice">Practice</option>
              <option value="game">Game</option>
            </select>
          </label>

          <div className="flex flex-col gap-1">
            <span className="text-[11px] text-ink-3">Length</span>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={0}
                max={12}
                inputMode="numeric"
                placeholder="0"
                value={hours}
                onChange={(e) => setHours(e.target.value)}
                aria-label="Hours"
                className="num w-full px-3 py-2 text-sm text-ink outline-none"
                style={solid.field}
              />
              <span className="shrink-0 text-[11px] text-ink-3">h</span>
              <input
                type="number"
                min={0}
                max={59}
                inputMode="numeric"
                placeholder="0"
                value={minutes}
                onChange={(e) => setMinutes(e.target.value)}
                aria-label="Minutes"
                className="num w-full px-3 py-2 text-sm text-ink outline-none"
                style={solid.field}
              />
              <span className="shrink-0 text-[11px] text-ink-3">m</span>
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <span className="text-[11px] text-ink-3">Intensity</span>
            <div className="flex items-center gap-1.5" role="group" aria-label="Intensity">
              {[1, 2, 3, 4, 5].map((n) => {
                const on = intensity === n;
                return (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setIntensity(intensity === n ? 0 : n)}
                    aria-pressed={on}
                    aria-label={`Intensity ${n} of 5`}
                    className="num h-8 flex-1 rounded-md border text-[11px] transition-colors"
                    style={{
                      borderColor: on ? "var(--color-accent)" : "var(--color-hairline)",
                      background: on ? "var(--color-raised)" : "var(--color-inset)",
                      color: on ? "var(--color-ink)" : "var(--color-ink-3)",
                    }}
                  >
                    {n}
                  </button>
                );
              })}
            </div>
            <span className="text-[10px] text-ink-3">1 is a light jog, 5 is everything you had</span>
          </div>

          <div className="mt-1 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-hairline px-3 py-1.5 text-[11px] text-ink-3 transition-colors hover:border-[var(--color-accent)]"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={save}
              disabled={!valid}
              className="rounded-md border border-[var(--color-accent)] px-3 py-1.5 text-[11px] font-medium text-ink transition-colors disabled:opacity-40"
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
