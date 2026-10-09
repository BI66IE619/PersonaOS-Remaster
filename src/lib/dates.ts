/** Key for the user's local calendar day. A fitness or money day is never UTC. */
export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Key for a calendar day in a specific IANA timezone.
 *
 * The server runs in UTC, so dayKey(new Date()) taken there is the wrong day for
 * anyone east or west of it: an evening in the US is already tomorrow in UTC, and
 * a Thursday check-in gets filed under Friday. Formatting through the zone is what
 * turns the server's own clock into the day the user is actually living in. An
 * unrecognised zone falls back to the server day rather than throwing, because a
 * day that is merely off beats a page that will not render.
 */
export function dayKeyInTz(d: Date, timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(d);
    const at = (type: string) => parts.find((p) => p.type === type)?.value;
    const y = at("year");
    const m = at("month");
    const day = at("day");
    if (!y || !m || !day) return dayKey(d);
    return `${y}-${m}-${day}`;
  } catch {
    return dayKey(d);
  }
}

export function monthKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

export function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function addMonths(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return monthKey(d);
}

/** Add days to a YYYY-MM-DD key. UTC maths, because the key is already a
    calendar date and must not drift with the viewer's zone. */
export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

/** Whole days from `from` to `to`, both YYYY-MM-DD keys. */
export function daysBetween(from: string, to: string): number {
  const [ay, am, ad] = from.split("-").map(Number);
  const [by, bm, bd] = to.split("-").map(Number);
  return Math.round(
    (Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000,
  );
}

export function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(
    new Date(y, m - 1, 1),
  );
}

export function shortDayLabel(date: string): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T12:00:00Z`));
}

/** Monday of the week containing `date`, as a YYYY-MM-DD key. */
export function weekStart(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return addDays(date, -((dow + 6) % 7));
}

/** Every day key in a month, from the 1st to the last. */
export function monthDays(month: string): string[] {
  const [y, m] = month.split("-").map(Number);
  const total = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: total }, (_, i) => `${y}-${pad(m)}-${pad(i + 1)}`);
}

/** Whole weeks covering a month, Monday-first, padded with neighbouring days so
    the grid is always a clean rectangle. Always six rows, because a month can
    span five or six and a grid that changes height between months is worse than
    one wasted row. */
export function monthMatrix(month: string): string[][] {
  const days = monthDays(month);
  const first = days[0];
  const last = days[days.length - 1];
  let cursor = weekStart(first);
  const rows: string[][] = [];
  while (rows.length < 5 && cursor <= last) {
    rows.push(Array.from({ length: 7 }, (_, i) => addDays(cursor, i)));
    cursor = addDays(cursor, 7);
  }
  while (rows.length < 6) {
    const prev = rows[rows.length - 1][6];
    rows.push(Array.from({ length: 7 }, (_, i) => addDays(prev, 1 + i)));
  }
  return rows;
}

const CLOCK = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
  timeZone: "UTC",
});

/** 570 -> "9:30 AM". Takes minutes from midnight, not a Date, so it never
    depends on the viewer's zone. */
export function timeLabel(min: number): string {
  const h24 = Math.floor(min / 60) % 24;
  const m = min % 60;
  return CLOCK.format(new Date(Date.UTC(2000, 0, 1, h24, m)));
}

/** "today" / "tomorrow" / "Sat, Mar 7" for a day key relative to another. */
export function relativeDayLabel(date: string, today: string): string {
  const diff = daysBetween(today, date);
  if (diff === 0) return "today";
  if (diff === 1) return "tomorrow";
  if (diff === -1) return "yesterday";
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T12:00:00Z`));
}
