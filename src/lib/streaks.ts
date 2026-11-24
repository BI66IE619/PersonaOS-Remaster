import { addDays } from "./dates.ts";
import { isDue, type Pause } from "./habit-schedule.ts";

const NO_PAUSE: Pause = { from: null, until: null };

/**
 * Consecutive due days ending today, for a habit that may not be due every day and
 * may have been paused.
 *
 * The unit is the habit's own due days, not the calendar. A weekday habit is not
 * missed on a Saturday, and a day inside a pause is not missed at all — so a break
 * neither counts toward the streak nor breaks it. A due day that has passed without
 * a tick is what ends the run; a due today not yet ticked is pending, so the anchor
 * falls back to the previous due day.
 */
export function currentStreak(
  days: readonly string[],
  today: string,
  schedule: readonly number[] = [],
  pause: Pause = NO_PAUSE,
): number {
  const set = new Set(days);
  let cursor =
    isDue(today, schedule, pause.from, pause.until) && set.has(today)
      ? today
      : addDays(today, -1);
  let n = 0;
  /* Bounded: a habit paused indefinitely from its creation has no due day behind
     it, and the walk has to end rather than run to 1970. ~11 years is far past any
     real log. */
  for (let i = 0; i < 4200; i++) {
    if (!isDue(cursor, schedule, pause.from, pause.until)) {
      cursor = addDays(cursor, -1);
      continue;
    }
    if (!set.has(cursor)) break;
    n++;
    cursor = addDays(cursor, -1);
  }
  return n;
}

/** Whether any due day sits strictly between two dates. */
function hasDueBetween(
  after: string,
  before: string,
  schedule: readonly number[],
  pause: Pause,
): boolean {
  let cursor = addDays(after, 1);
  while (cursor < before) {
    if (isDue(cursor, schedule, pause.from, pause.until)) return true;
    cursor = addDays(cursor, 1);
  }
  return false;
}

/**
 * Longest run of consecutive due days ever recorded.
 *
 * Off days and paused days are filtered out first. A run continues when no due day
 * sits between two ticks: for a weekday habit that makes Friday and Monday
 * neighbours, and across a pause it bridges the whole break, because those days are
 * not due. A genuinely missed due day between two ticks still breaks it.
 */
export function bestStreak(
  days: readonly string[],
  schedule: readonly number[] = [],
  pause: Pause = NO_PAUSE,
): number {
  const sorted = [...new Set(days)]
    .filter((d) => isDue(d, schedule, pause.from, pause.until))
    .sort();
  let best = 0;
  let run = 0;
  let prev: string | null = null;
  for (const d of sorted) {
    run = prev !== null && !hasDueBetween(prev, d, schedule, pause) ? run + 1 : 1;
    if (run > best) best = run;
    prev = d;
  }
  return best;
}
