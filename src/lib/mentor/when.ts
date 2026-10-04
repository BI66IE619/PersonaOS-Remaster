/**
 * A short label of how long ago a chat was last touched, for the recents log.
 *
 * Everything the mentor needs to be honest about is already plain text
 * elsewhere on this tab; this is the one timestamp the chat screen formats,
 * and it earns its place by being the only thing the recents log shows next
 * to a preview. It is deliberately coarse — minutes, hours, "yesterday", then
 * a date — because a recents log with "3 days, 4 hours ago" next to every row
 * is a log that got too chatty to scan.
 *
 * `now` is injectable so the labels are testable without freezing the clock.
 */
/** Whole calendar days between two dates, local time, as `now - d`. Built from
 *  calendar dates rather than divided milliseconds so a 23-hour message from
 *  the day before reads as yesterday and a 25-hour one from two days back does
 *  not. */
function daysApart(d: Date, now: Date): number {
  const a = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const b = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return Math.round((b - a) / 86_400_000);
}

export function whenLabel(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const ms = now.getTime() - d.getTime();
  if (ms < 60_000) return "just now";
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  const apart = daysApart(d, now);
  if (apart === 0) return `${Math.floor(ms / 3_600_000)}h ago`;
  if (apart === 1) return "yesterday";
  const opts: Intl.DateTimeFormatOptions =
    d.getFullYear() === now.getFullYear()
      ? { month: "short", day: "numeric" }
      : { month: "short", day: "numeric", year: "numeric" };
  return d.toLocaleDateString(undefined, opts);
}