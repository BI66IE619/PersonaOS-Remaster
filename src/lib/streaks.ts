import { addDays } from "./dates.ts";
import { isScheduled, previousScheduled } from "./habit-schedule.ts";

/**
 * Consecutive due days ending today, for a habit that may not be due every day.
 *
 * The unit is the habit's own schedule, not the calendar. A weekday habit is not
 * missed on a Saturday, so the walk skips Saturday and Sunday and counts the
 * Friday before them. A due day that has passed without a tick is what ends the
 * run; a due today that has not been ticked yet is pending, so the anchor falls
 * back to the previous due day rather than reporting zero.
 */
export function currentStreak(
  days: readonly string[],
  today: string,
  schedule: readonly number[] = [],
): number {
  const set = new Set(days);
  /* Today counts only if it is due and already ticked. Otherwise the walk starts
     at yesterday, which may itself be off, and the loop skips to the last due
     day. */
  let cursor = isScheduled(today, schedule) && set.has(today) ? today : addDays(today, -1);
  let n = 0;
  while (true) {
    if (!isScheduled(cursor, schedule)) {
      cursor = addDays(cursor, -1);
      continue;
    }
    if (!set.has(cursor)) break;
    n++;
    cursor = addDays(cursor, -1);
  }
  return n;
}

/**
 * Longest run of consecutive due days ever recorded.
 *
 * Off days are filtered out first, so a habit logged on a day it is not due does
 * not inflate the run. A run continues when the previous tick is the previous due
 * day: for a weekday habit that makes Friday and Monday neighbours, with the
 * weekend neither breaking the run nor counting toward it.
 */
export function bestStreak(
  days: readonly string[],
  schedule: readonly number[] = [],
): number {
  const sorted = [...new Set(days)]
    .filter((d) => isScheduled(d, schedule))
    .sort();
  let best = 0;
  let run = 0;
  let prev: string | null = null;
  for (const d of sorted) {
    run = prev !== null && previousScheduled(d, schedule) === prev ? run + 1 : 1;
    if (run > best) best = run;
    prev = d;
  }
  return best;
}
