"use client";

import { useEffect, useId, useState, useSyncExternalStore } from "react";
import {
  EMPTY_STATE,
  addExercise,
  addSet,
  getSnapshot,
  removeExercise,
  removeSet,
  seedStrength,
  setTargetSets,
  setUsualReps,
  setWeight,
  subscribe,
  totalReps,
  updateSet,
  type StrengthSet,
} from "@/lib/strength";
import { SwipeRow } from "./swipe-row";

/* Kept in step with PROGRAM in src/lib/strength.ts. Offered as autocomplete only
   — the three are installed on first run, so this list is here for when one is
   removed and added back, not as the source of truth. */
const SUGGESTIONS = ["Bench press", "Bicep curls", "Overhead dumbbell tricep extension"];

function formatSet(set: StrengthSet) {
  if (set.weightLb == null) return `${set.reps} reps`;
  return `${set.reps} × ${set.weightLb} lb`;
}

export function StrengthLog({ date }: { date: string }) {
  const state = useSyncExternalStore(subscribe, getSnapshot, () => EMPTY_STATE);
  const [draftName, setDraftName] = useState("");
  const [adjusting, setAdjusting] = useState(false);
  const adjustId = useId();

  useEffect(() => {
    seedStrength();
  }, []);

  const today = state.days[date] ?? {};
  const loggedToday = state.exercises.filter((e) => (today[e.id]?.length ?? 0) > 0);

  const lastSessionFor = (exerciseId: string) => {
    const dates = Object.keys(state.days)
      .filter((d) => d < date && (state.days[d]?.[exerciseId]?.length ?? 0) > 0)
      .sort();
    const last = dates[dates.length - 1];
    return last ? { date: last, sets: state.days[last][exerciseId] } : null;
  };

  const submit = () => {
    const name = draftName.trim();
    if (!name) return;
    addExercise(name);
    setDraftName("");
  };

  return (
    <div className="panel p-5">
      <div className="flex items-center justify-between gap-3">
        <span className="label-xs">Strength log</span>
        <div className="flex items-center gap-2">
          {!loggedToday.length && state.exercises.length > 0 ? (
            <span className="hidden text-[10px] text-ink-3 sm:inline">drag to log</span>
          ) : null}
          <button
            type="button"
            onClick={() => setAdjusting((v) => !v)}
            aria-expanded={adjusting}
            aria-controls={adjustId}
            className="rounded-lg border border-hairline-strong bg-raised px-2.5 py-1.5 text-[11px] font-medium text-ink-2 transition-colors hover:bg-inset hover:text-ink"
          >
            {adjusting ? "Done" : "Adjust"}
          </button>
        </div>
      </div>

      {adjusting ? (
        <div id={adjustId} className="mt-4 space-y-3 border-t border-hairline pt-4">
          <div className="flex gap-2">
            <input
              list="strength-suggestions"
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  submit();
                }
              }}
              placeholder="Add a movement"
              aria-label="Add a movement"
              className="min-w-0 flex-1 rounded-lg border border-hairline bg-white/[0.07] px-3 py-2.5 text-sm text-ink placeholder:text-ink-3 focus:border-[var(--color-accent)] focus:outline-none"
            />
            <datalist id="strength-suggestions">
              {SUGGESTIONS.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
            <button
              type="button"
              onClick={submit}
              disabled={!draftName.trim()}
              className="shrink-0 rounded-lg border border-hairline-strong bg-raised px-3.5 py-2.5 text-sm font-medium text-ink transition-colors hover:bg-inset disabled:cursor-not-allowed disabled:opacity-40"
            >
              Add
            </button>
          </div>

          <p className="text-[11px] text-ink-3">
            Weight is what a drag logs, so it only needs changing when it actually changes.
          </p>

          {state.exercises.length === 0 ? (
            <p className="text-xs text-ink-3">
              Nothing tracked yet. Add what you train, and the rows below become
              the ones you drag to log.
            </p>
          ) : (
            state.exercises.map((exercise) => {
              const sets = today[exercise.id] ?? [];
              return (
                <div key={exercise.id} className="rounded-xl border border-hairline p-3">
                  <div className="flex items-start justify-between gap-2">
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">
                      {exercise.name}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeExercise(exercise.id)}
                      aria-label={`Remove ${exercise.name}`}
                      className="shrink-0 rounded-md px-2 py-1 text-xs text-ink-3 transition-colors hover:text-[var(--color-low)]"
                    >
                      Remove
                    </button>
                  </div>

                  <div className="mt-2.5 grid grid-cols-3 gap-2">
                    <label className="block">
                      <span className="block text-[10px] text-ink-3">Usual reps</span>
                      <input
                        type="number"
                        inputMode="numeric"
                        min={0}
                        value={exercise.usualReps || ""}
                        onChange={(e) => setUsualReps(exercise.id, Number(e.target.value) || 0)}
                        aria-label={`Usual reps for ${exercise.name}`}
                        className="num mt-1 w-full rounded-md border border-hairline bg-inset px-2 py-1.5 text-sm text-ink focus:border-[var(--color-accent)] focus:outline-none"
                      />
                    </label>
                    <label className="block">
                      <span className="block text-[10px] text-ink-3">Sets</span>
                      <input
                        type="number"
                        inputMode="numeric"
                        min={0}
                        value={exercise.targetSets || ""}
                        onChange={(e) => setTargetSets(exercise.id, Number(e.target.value) || 0)}
                        aria-label={`Set target for ${exercise.name}`}
                        className="num mt-1 w-full rounded-md border border-hairline bg-inset px-2 py-1.5 text-sm text-ink focus:border-[var(--color-accent)] focus:outline-none"
                      />
                    </label>
                    <label className="block">
                      <span className="block text-[10px] text-ink-3">Weight</span>
                      <input
                        type="number"
                        inputMode="decimal"
                        min={0}
                        step={5}
                        placeholder="lb"
                        value={exercise.weightLb || ""}
                        onChange={(e) => setWeight(exercise.id, Number(e.target.value) || 0)}
                        aria-label={`Weight for ${exercise.name} in pounds`}
                        className="num mt-1 w-full rounded-md border border-hairline bg-inset px-2 py-1.5 text-sm text-ink placeholder:text-ink-3 focus:border-[var(--color-accent)] focus:outline-none"
                      />
                    </label>
                  </div>

                  {sets.length ? (
                    <div className="mt-3 border-t border-hairline pt-2.5">
                      <span className="block text-[10px] text-ink-3">Logged today</span>
                      <div className="mt-1.5 space-y-1.5">
                        {sets.map((set, i) => (
                          <div key={i} className="flex items-center gap-2">
                            <span className="num w-4 shrink-0 text-[11px] text-ink-3">{i + 1}</span>
                            <label className="w-16 shrink-0">
                              <span className="sr-only">{exercise.name} set {i + 1} reps</span>
                              <input
                                type="number"
                                inputMode="numeric"
                                min={0}
                                value={Number.isFinite(set.reps) ? set.reps : ""}
                                onChange={(e) =>
                                  updateSet(date, exercise.id, i, {
                                    reps: Math.max(0, Math.round(Number(e.target.value) || 0)),
                                  })
                                }
                                className="num w-full rounded-md border border-hairline bg-inset px-2 py-1 text-sm text-ink focus:border-[var(--color-accent)] focus:outline-none"
                              />
                            </label>
                            {/* Not editable: the weight belongs to the movement now.
                                Kept visible so a set still reads as what was lifted. */}
                            <span className="num min-w-0 flex-1 truncate text-[11px] text-ink-3">
                              {set.weightLb != null ? `${set.weightLb} lb` : "bodyweight"}
                            </span>
                            <button
                              type="button"
                              onClick={() => removeSet(date, exercise.id, i)}
                              aria-label={`Remove set ${i + 1} of ${exercise.name}`}
                              className="shrink-0 rounded-md px-2 py-1 text-xs text-ink-3 transition-colors hover:text-[var(--color-low)]"
                            >
                              ✕
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              );
            })
          )}
        </div>
      ) : null}

      {state.exercises.length === 0 ? (
        <p className="mt-4 text-xs text-ink-3">
          Add the movements you train, then drag one across each time you do a set.
        </p>
      ) : (
        <div className="mt-3 space-y-2">
          {state.exercises.map((exercise) => {
            const sets = today[exercise.id] ?? [];
            const last = lastSessionFor(exercise.id);
            const target = exercise.targetSets;
            const met = target > 0 && sets.length >= target;
            const load = exercise.weightLb > 0 ? `${exercise.weightLb} lb` : "bodyweight";
            const usual = exercise.usualReps > 0 ? `${exercise.usualReps} reps` : null;

            /* The row says what a drag will record, and says "drag" rather than
               "swipe" because on a desktop a drag means holding the button: moving
               the mouse across the row is only hover, and a hint that does not
               match what the hardware needs is worse than no hint. */
            const goal = target > 0 ? ` · ${target} sets` : "";
            const summary = sets.length
              ? `${sets.length}${target > 0 ? `/${target}` : ""} ${
                  sets.length === 1 ? "set" : "sets"
                } · ${totalReps(sets)} reps · ${load}`
              : usual
                ? `drag right to log ${usual}${goal} · ${load}`
                : `drag right to log a set${goal} · ${load}`;

            const count = sets.length === 1 ? "1 set" : `${sets.length} sets`;

            return (
              <SwipeRow
                key={exercise.id}
                label={`Log a set of ${exercise.name}`}
                hint={
                  target > 0
                    ? `${count} of ${target} logged${met ? ", target met" : ""}. Drag right to log, drag left to undo.`
                    : `${count} logged. Drag right to log, drag left to undo.`
                }
                onSwipeRight={() => addSet(date, exercise.id)}
                onSwipeLeft={sets.length ? () => removeSet(date, exercise.id, sets.length - 1) : undefined}
              >
                <span className="flex items-center gap-3 px-3.5 py-3">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{exercise.name}</span>
                    <span className="num mt-0.5 block truncate text-[11px] text-ink-3">
                      {summary}
                    </span>
                  </span>
                  {met ? (
                    <span
                      aria-hidden
                      /* Mounts only once the target is met, so the pop plays on
                         the set that got there rather than on page load. */
                      className="pop-in num shrink-0 text-sm font-medium text-[var(--color-accent)]"
                    >
                      ✓
                    </span>
                  ) : null}
                  {/* Dragging back is invisible until you know it exists, so it is
                      said out loud on any row that has something to take back. */}
                  {sets.length ? (
                    <span
                      aria-hidden
                      className="num shrink-0 whitespace-nowrap text-[11px] text-ink-3"
                    >
                      ‹ drag back
                    </span>
                  ) : null}
                  {!sets.length && last ? (
                    <span className="num shrink-0 text-[11px] text-ink-3">
                      last {last.sets.map(formatSet).join(", ")}
                    </span>
                  ) : null}
                </span>
              </SwipeRow>
            );
          })}
        </div>
      )}
    </div>
  );
}

