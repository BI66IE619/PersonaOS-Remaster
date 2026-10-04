export function formatDuration(totalMin: number): string {
  const h = Math.floor(totalMin / 60);
  const m = Math.round(totalMin % 60);
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

export function formatClock(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  }).format(new Date(iso));
}

export function formatDayLabel(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone,
  }).format(new Date(`${iso}T12:00:00Z`));
}

export function formatShortDate(dateKey: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone,
  }).format(new Date(`${dateKey}T12:00:00Z`));
}

export function relativeTime(iso: string, now: Date = new Date()): string {
  const diffMin = Math.round((now.getTime() - new Date(iso).getTime()) / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const h = Math.floor(diffMin / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export const LB_PER_KG = 2.2046226;

/** Seeded and synced data stays in kilograms — Health Connect reports weight in
    grams, and the scoring baselines are all kg-based. Pounds are a display and
    input conversion only. */
export function kgToLb(kg: number, dp = 1): number {
  const f = 10 ** dp;
  return Math.round(kg * LB_PER_KG * f) / f;
}

/** "+4m" / "−38m" / "−12%" — typographic minus so columns align. */
export function signed(value: number, unit: string, dp = 0): string {
  const sign = value > 0 ? "+" : value < 0 ? "−" : "±";
  return `${sign}${Math.abs(value).toFixed(dp)}${unit}`;
}

/**
 * Cents to currency. Typographic minus, matching signed().
 *
 * dp defaults to 0 because most figures here are large and glanceable, where
 * "$100" reads better than "$99.90". The cost of that default is real though: a
 * $99.90 total displayed as "$100" looks like the app is wrong by ten cents when
 * the data was exact. Anything a person reconciles against a bank statement wants
 * dp: 2, because that is the comparison being made.
 */
export function formatMoney(cents: number, opts: { showSign?: boolean; dp?: number } = {}) {
  const dp = opts.dp ?? 0;
  const body = (Math.abs(cents) / 100).toLocaleString("en-US", {
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
  });
  if (cents < 0) return `−$${body}`;
  if (opts.showSign) return `+$${body}`;
  return `$${body}`;
}
