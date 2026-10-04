/**
 * Per-row logical clocks, shared by the stores that sync.
 *
 * The same rule as the plan stores: a stamp that never repeats within a row. The
 * server resolves conflicts with strictly-newer-wins, so two edits landing in the
 * same millisecond would make the second one lose silently. Nudging past the
 * row's own last stamp costs a millisecond nobody can see and makes every edit
 * strictly newer than the one before it.
 */
export function stampAfter(previous: string | undefined): string {
  const wall = Date.now();
  const before = previous ? Date.parse(previous) : Number.NaN;
  const next = Number.isNaN(before) ? wall : Math.max(wall, before + 1);
  return new Date(next).toISOString();
}

/** How many unconfirmed deletes a store holds before dropping the oldest.
 *  Well above what any device produces between syncs, so nothing is really lost;
 *  the cap is here so a device that deletes with no connection does not grow a
 *  list forever. */
export const MAX_PENDING_DELETES = 200;

/** Dedupe, cap length, and keep only strings — for a tombstone list read back
 *  from hand-editable localStorage. */
export function reviveIds(raw: unknown): string[] {
  return Array.isArray(raw)
    ? [...new Set(raw.filter((v): v is string => typeof v === "string"))].slice(-MAX_PENDING_DELETES)
    : [];
}
