import { addDays, isoWeekday } from "./dates";

/**
 * When a habit is supposed to happen.
 *
 * A habit carries a set of ISO weekdays — 1 = Monday … 7 = Sunday. An empty set
 * means every day, which is what every habit created before schedules existed
 * becomes, so old rows need no migration of meaning. The UI writes all seven for
 * "every day", so an empty set is only ever legacy data.
 *
 * This exists because a weekday habit is not a failure on a Saturday. The streak
 * should count the days the habit was due, not the days the calendar happened to
 * have, and both the streak maths and the screens need the same answer to "is it
 * due today?".
 */
export function isScheduled(date: string, schedule: readonly number[]): boolean {
  return schedule.length === 0 || schedule.includes(isoWeekday(date));
}

/**
 * The nearest due day strictly before `date`.
 *
 * With no schedule every day is due, so this is just the day before — which
 * keeps the streak maths identical for ordinary habits. With a schedule it walks
 * back over the off days, so Monday is the day before Friday for a weekday habit.
 */
export function previousScheduled(date: string, schedule: readonly number[]): string {
  let cursor = addDays(date, -1);
  if (schedule.length === 0) return cursor;
  /* A valid schedule always contains at least one weekday, so this terminates. */
  while (!schedule.includes(isoWeekday(cursor))) cursor = addDays(cursor, -1);
  return cursor;
}

const SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

/** "Every day", "Weekdays", "Weekends", or the days named. */
export function scheduleLabel(schedule: readonly number[]): string {
  const days = [...new Set(schedule)].sort((a, b) => a - b);
  if (days.length === 0 || days.length === 7) return "Every day";
  if (days.join(",") === "1,2,3,4,5") return "Weekdays";
  if (days.join(",") === "6,7") return "Weekends";
  return days.map((d) => SHORT[d - 1]).join(", ");
}

/** The seven day toggles, Monday first. */
export const WEEKDAYS = [
  { value: 1, short: "M", label: "Monday" },
  { value: 2, short: "T", label: "Tuesday" },
  { value: 3, short: "W", label: "Wednesday" },
  { value: 4, short: "T", label: "Thursday" },
  { value: 5, short: "F", label: "Friday" },
  { value: 6, short: "S", label: "Saturday" },
  { value: 7, short: "S", label: "Sunday" },
] as const;

/** All seven, the "every day" set the UI stores. */
export const EVERY_DAY: number[] = [1, 2, 3, 4, 5, 6, 7];

/** Keep only weekdays 1..7, dedupe and sort. An absent or empty value reads as
 *  every day, so old records and old server rows need no rewriting. */
export function normalizeSchedule(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  return [
    ...new Set(raw.filter((n): n is number => Number.isInteger(n) && n >= 1 && n <= 7)),
  ].sort((a, b) => a - b);
}
