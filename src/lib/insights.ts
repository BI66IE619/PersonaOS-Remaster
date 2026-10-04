import type { StrengthState } from "@/lib/types-strength";
import type { CheckIn, Spark } from "@/lib/types";
import type { WeightLogs } from "@/lib/weight-log";
import { addDays } from "@/lib/dates";

/**
 * Four things you cannot see from inside a single day, computed from what is
 * already logged. Nothing here needs a device that is not already feeding the
 * app, and nothing here invents a number it cannot stand behind: every one of
 * these reports how much it is standing on, and stays quiet until that is
 * enough.
 *
 * All of it is pure. Sleep comes from the provider as a series, the check-ins
 * and the lifting log come from their stores, and this file only does the
 * arithmetic — so the numbers can be tested without a browser.
 */

/** Epley. Reps vary set to set, so comparing raw weight misses the point —
 *  the same 135 lifted for 8 is worth more than 135 for 3. Shared by the lift
 *  records and the plateau check, which must agree on what "stronger" means. */
const e1rm = (weightLb: number, reps: number) => (reps > 0 ? weightLb * (1 + reps / 30) : 0);

/* ------------------------------------------------------------------ sleep */

/** Minimum nights before a sleep read means anything. A week is where the
 *  direction stops being one bad night. */
const SLEEP_MIN_NIGHTS = 7;
/** A night shorter than this is short. Not 8h: that is a population rule, and
 *  this app compares you to you. */
const SHORT_HOURS = 7;
/** Repaying debt assumes a good night runs this much over your own median. */
const REPAY_MIN_PER_NIGHT = 30;

export type SleepPoint = { date: string; totalMin: number };

export type SleepDebt = {
  enough: boolean;
  nights: number;
  medianMin: number;
  debtMin: number;
  nightsBelow: number;
  nightsToRepay: number | null;
  verdict: string;
};

export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

const hours = (min: number) => (Math.round((min / 60) * 10) / 10).toString();

/**
 * Sleep owed, against your own recent median rather than a rule of thumb.
 *
 * The median, not the mean, because one 4-hour night should not redefine what
 * normal is for you. Debt only counts the shortfall below it, so a long night
 * does not quietly bank credit — the metric that matters is whether the short
 * nights are being made up, and that is what the verdict says.
 */
export function sleepDebt(series: readonly SleepPoint[]): SleepDebt {
  const nights = series.slice(-SLEEP_MIN_NIGHTS * 2);
  if (nights.length < SLEEP_MIN_NIGHTS) {
    return {
      enough: false,
      nights: nights.length,
      medianMin: 0,
      debtMin: 0,
      nightsBelow: 0,
      nightsToRepay: null,
      verdict: `${nights.length} night${nights.length === 1 ? "" : "s"} logged — a week is needed before this means anything`,
    };
  }

  const mid = median(nights.map((n) => n.totalMin));
  let owed = 0;
  let below = 0;
  for (const n of nights) {
    const gap = mid - n.totalMin;
    if (gap > 0) {
      owed += gap;
      below++;
    }
  }
  const debtMin = Math.round(owed);
  const nightsToRepay =
    debtMin > 0 ? Math.max(1, Math.round(debtMin / REPAY_MIN_PER_NIGHT)) : null;

  /* The number is not repeated here: the panel already shows it as the figure
     for this row, so restating it just makes the line stutter. */
  const verdict =
    debtMin === 0
      ? `Nothing owed — every one of ${nights.length} nights met your ${hours(mid)}h median`
      : `Owed across ${nights.length} nights, ${below} of them short. About ${nightsToRepay} night${nightsToRepay === 1 ? "" : "s"} above your usual to clear it.`;

  return {
    enough: true,
    nights: nights.length,
    medianMin: mid,
    debtMin,
    nightsBelow: below,
    nightsToRepay,
    verdict,
  };
}

export type SleepVsEnergy = {
  enough: boolean;
  shortNights: number;
  longNights: number;
  shortEnergy: number;
  longEnergy: number;
  diff: number;
  verdict: string;
};

/**
 * What short nights do to your own day, in your own ratings.
 *
 * Deliberately two averages rather than a correlation coefficient. With a
 * season of check-ins a coefficient looks precise and means very little; "you
 * rated 2.4 after short nights and 3.6 after long ones" is a claim a person can
 * check against their own memory, which is the only reason to show it at all.
 */
export function sleepVsEnergy(
  series: readonly SleepPoint[],
  entries: readonly CheckIn[],
): SleepVsEnergy {
  const byDate = new Map(series.map((s) => [s.date, s.totalMin]));
  const buckets: { short: number[]; long: number[] } = { short: [], long: [] };
  for (const e of entries) {
    const slept = byDate.get(e.date);
    if (slept === undefined || e.energy === 0) continue;
    (slept < SHORT_HOURS * 60 ? buckets.short : buckets.long).push(e.energy);
  }
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const shortEnergy = mean(buckets.short);
  const longEnergy = mean(buckets.long);
  const enough = buckets.short.length >= 3 && buckets.long.length >= 3;

  /* Zeroed rather than left as computed when a bucket is empty: an empty
     short bucket averages 0, which would report the whole rating scale as a
     gap. Anything downstream that reads diff without checking enough would
     then be reading a number invented out of nothing. */
  if (!enough) {
    return {
      enough: false,
      shortNights: buckets.short.length,
      longNights: buckets.long.length,
      shortEnergy: 0,
      longEnergy: 0,
      diff: 0,
      verdict: `${buckets.short.length + buckets.long.length} nights paired with a rating — needs 3 short and 3 long before this says anything`,
    };
  }

  const diff = Math.round((longEnergy - shortEnergy) * 10) / 10;
  const verdict =
    diff >= 0.4
      ? `You rate ${shortEnergy.toFixed(1)} after short nights, ${longEnergy.toFixed(1)} after long ones. That ${diff} gap is yours, not a rule.`
      : diff <= -0.4
        ? `You rate ${shortEnergy.toFixed(1)} after short nights and ${longEnergy.toFixed(1)} after long ones — sleep is not the lever here.`
        : `Sleep length barely moves your ratings: ${shortEnergy.toFixed(1)} short, ${longEnergy.toFixed(1)} long. Something else is doing it.`;

  return {
    enough: true,
    shortNights: buckets.short.length,
    longNights: buckets.long.length,
    shortEnergy: Math.round(shortEnergy * 10) / 10,
    longEnergy: Math.round(longEnergy * 10) / 10,
    diff,
    verdict,
  };
}

/* ----------------------------------------------------------------- weight */

export type WeightTrend = {
  enough: boolean;
  entries: number;
  latestLb: number | null;
  changeTotal: number | null;
  changeRecent: number | null;
  perWeek: number | null;
  status: "falling" | "holding" | "rising" | "unknown";
  verdict: string;
};

const RECENT_DAYS = 28;
/** Below this, a fortnight of weigh-ins is a plateau rather than a trend. */
const FLAT_LB = 0.6;
/** The same idea per week, for the slope. A home scale swings 1-3lb on water,
 *  salt and whatever was eaten, so anything under roughly a quarter pound a
 *  week is noise and is reported as holding rather than as a slow trend. */
const FLAT_PER_WEEK = 0.25;

function daysBetweenKeys(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/** Least-squares slope in lb per week. */
function slopePerWeek(points: { day: number; lb: number }[]): number | null {
  if (points.length < 2) return null;
  const n = points.length;
  const meanX = points.reduce((a, p) => a + p.day, 0) / n;
  const meanY = points.reduce((a, p) => a + p.lb, 0) / n;
  let num = 0;
  let den = 0;
  for (const p of points) {
    num += (p.day - meanX) * (p.lb - meanY);
    den += (p.day - meanX) ** 2;
  }
  if (den === 0) return null;
  return Math.round(((num / den) * 7) * 100) / 100;
}

/**
 * Weight as a direction, not a reading. A single weigh-in is water, salt and
 * whatever you had for dinner; the slope is the only version of this number
 * that survives a bad night.
 *
 * Weigh-ins land every other week, so "recent" is a four-week window rather
 * than a fortnight — otherwise the recent change is usually just two points
 * and says nothing. Holding is called out separately from falling, because a
 * plateau after real progress is the moment worth knowing about and "you are
 * down 4lb" would hide it completely.
 */
export function weightTrend(logs: WeightLogs, today: string): WeightTrend {
  const rows = Object.entries(logs)
    .filter(([d, lb]) => d <= today && Number.isFinite(lb) && lb > 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, lb]) => ({ date, lb }));

  const empty: WeightTrend = {
    enough: false,
    entries: 0,
    latestLb: null,
    changeTotal: null,
    changeRecent: null,
    perWeek: null,
    status: "unknown",
    verdict: "No weigh-ins yet",
  };
  if (rows.length === 0) return empty;
  if (rows.length < 3) {
    return {
      ...empty,
      entries: rows.length,
      latestLb: rows[rows.length - 1].lb,
      verdict: `${rows.length} weigh-in${rows.length === 1 ? "" : "s"} — a line needs three`,
    };
  }
  const first = rows[0];
  const last = rows[rows.length - 1];
  const changeTotal = Math.round((last.lb - first.lb) * 10) / 10;
  /* The 28-day window starts at the newest weigh-in that is at least 28 days
     back, not strictly more than: at exactly 28 days that point is the one a
     reader counts as the start of the window, and excluding it silently
     stretches the change to cover the whole log. */
  const before = rows.filter((r) => daysBetweenKeys(r.date, last.date) >= RECENT_DAYS);
  const baseline = before.length ? before[before.length - 1] : null;
  const changeRecent = baseline ? Math.round((last.lb - baseline.lb) * 10) / 10 : null;
  /* Measured forwards from the first weigh-in, so the axis runs in the same
     direction as time and a falling weight comes out negative. */
  const perWeek = slopePerWeek(
    rows.map((r) => ({ day: daysBetweenKeys(first.date, r.date), lb: r.lb })),
  );
  const window = baseline
    ? rows.filter((r) => daysBetweenKeys(r.date, last.date) <= RECENT_DAYS)
    : rows;
  const recentWeek =
    window.length >= 2
      ? slopePerWeek(
          window.map((r) => ({ day: daysBetweenKeys(window[0].date, r.date), lb: r.lb })),
        )
      : null;

  const active = perWeek ?? 0;
  /* Recent movement wins over the long-run slope, so a trend that has gone flat
     is reported as flat instead of being described by the progress made months
     ago. */
  const still = recentWeek !== null && Math.abs(recentWeek) < FLAT_PER_WEEK;
  const status: WeightTrend["status"] = still
    ? "holding"
    : active < -FLAT_PER_WEEK
      ? "falling"
      : active > FLAT_PER_WEEK
        ? "rising"
        : "holding";

  const span = daysBetweenKeys(first.date, last.date);
  const weeks = Math.round(span / 7);
  /* The head describes the whole run, from the total change, so it keeps
     saying "down" even after the recent window has gone flat — "8.7lb down…
     then flat" is the story, and "flat… then flat" is not. */
  const overall =
    changeTotal < -FLAT_LB ? "down" : changeTotal > FLAT_LB ? "up" : "flat";
  const head = `${Math.abs(changeTotal)}lb ${overall} across ${rows.length} weigh-in${rows.length === 1 ? "" : "s"} over ${weeks} week${weeks === 1 ? "" : "s"}`;

  /* The recent change is only worth stating when it is a genuine slowdown.
     Repeating the total back as "but only" the same number reads as a
     contradiction and buries the case where it really has slowed. */
  const slowed =
    changeRecent !== null &&
    changeRecent !== 0 &&
    status !== "holding" &&
    Math.abs(recentWeek ?? 0) < Math.abs(perWeek ?? 0) * 0.5;

  const verdict =
    status === "holding" && Math.abs(changeTotal) >= FLAT_LB
      ? `${head}, then flat — it has stopped moving. A plateau after real progress is usually a sign to change something, not to push harder.`
      : slowed
        ? `${head}, but only ${Math.abs(changeRecent)}lb in the last ${RECENT_DAYS} days. It is slowing down.`
        : `${head}.`;

  return {
    enough: true,
    entries: rows.length,
    latestLb: last.lb,
    changeTotal,
    changeRecent,
    perWeek,
    status,
    verdict,
  };
}

/* ------------------------------------------------------------------- lifts */

export type LiftProgress = {
  exerciseId: string;
  name: string;
  /** Days on which this movement was worked at all. */
  sessions: number;
  /** Best estimated one-rep max so far, and the set that produced it. */
  bestLb: number;
  bestWeightLb: number;
  bestReps: number;
  bestDate: string;
  /** Same movement, a month ago. Null until there is a month to compare with. */
  priorLb: number | null;
  /** How much better the best is than it was, in pounds of estimated 1RM. */
  gainLb: number | null;
};

/** A month back is the shortest window where a change is a plan rather than a
 *  bad session. Comparing to last week reports noise as progress. */
const LIFT_WINDOW_DAYS = 28;

/**
 * How strong each movement has got, as a personal best and what it beat.
 *
 * Everything here is judged on estimated one-rep max rather than raw weight,
 * for the same reason plateaus are: 5lb on a 5-rep set is a much bigger change
 * than 5lb on a 12-rep set, and only the estimate can tell those apart. It is
 * still an estimate, so the set that set the record is shown next to the number
 * — "180lb x 3" is checkable, "180lb estimated" is not.
 *
 * The comparison is against the best from a month ago rather than against the
 * first session ever. Lifting does not only go up, and a personal best from six
 * months ago would report every good week since as flat.
 *
 * Bodyweight movements are left out entirely: there is no load to grow, so
 * claiming progress on them would be inventing a trend out of reps alone.
 */
export function liftProgress(state: StrengthState, today: string): LiftProgress[] {
  const out: LiftProgress[] = [];
  for (const exercise of state.exercises) {
    /* One entry per day, keeping that day's best set, so a four-set workout
       cannot look like four sessions. */
    const byDay = new Map<string, { est: number; weight: number; reps: number }>();
    for (const date of Object.keys(state.days)) {
      /* A day in the future is a typo or a clock, not a session. Counting it
         would put a personal best that has not happened yet at the top of the
         list, and every gain after it would read as a fall. */
      if (date > today) continue;
      for (const s of state.days[date]?.[exercise.id] ?? []) {
        if (typeof s.weightLb !== "number" || s.weightLb <= 0) continue;
        if (typeof s.reps !== "number" || s.reps <= 0) continue;
        const est = e1rm(s.weightLb, s.reps);
        const held = byDay.get(date);
        if (!held || est > held.est) byDay.set(date, { est, weight: s.weightLb, reps: s.reps });
      }
    }
    if (byDay.size === 0) continue;

    const days = [...byDay.keys()].sort();
    let bestDay = days[0];
    for (const d of days) if (byDay.get(d)!.est > byDay.get(bestDay)!.est) bestDay = d;
    const best = byDay.get(bestDay)!;

    const cutoff = addDays(today, -LIFT_WINDOW_DAYS);
    /* The best as it stood a month ago: the highest of anything logged strictly
       before the cutoff. The cutoff day itself is left out, because a set logged
       the day the window opened is not "a month ago", it is 28 days ago. */
    let prior: { est: number } | null = null;
    for (const d of days) {
      if (d >= cutoff) continue;
      const day = byDay.get(d)!;
      if (!prior || day.est > prior.est) prior = { est: day.est };
    }

    const bestLb = Math.round(best.est);
    const priorLb = prior ? Math.round(prior.est) : null;
    out.push({
      exerciseId: exercise.id,
      name: exercise.name,
      sessions: days.length,
      bestLb,
      bestWeightLb: best.weight,
      bestReps: best.reps,
      bestDate: bestDay,
      priorLb,
      /* Zero is not a gain and not a loss, so it is reported as no movement
         rather than dressed up with a sign. */
      gainLb: priorLb === null ? null : bestLb - priorLb,
    });
  }
  /* Best first, so the panel leads with the movement you have moved furthest. */
  return out.sort((a, b) => b.bestLb - a.bestLb);
}

/* ---------------------------------------------------------------- vitality */

export type VitalityPoint = { date: string; value: number };

export type VitalityTrend = {
  enough: boolean;
  points: VitalityPoint[];
  current: number | null;
  change: number | null;
  direction: "up" | "down" | "flat" | "unknown";
  night: number;
  training: number;
  verdict: string;
};

/** Sleep length, HRV and resting heart rate are four views of one night, so
 *  they are averaged into a single night score before anything is weighted.
 *  Weighted separately they would count one bad night as three bad signals and
 *  drag the whole line flat, which reads as "broken" when nothing is wrong. */
const NIGHT_KEYS = ["sleep", "hrv", "restingHr"] as const;
const TRAINING_KEYS = ["load"] as const;
const NIGHT_SHARE = 0.7;
/** Below this, a fortnight of movement is a plateau rather than a trend. */
const FLAT_POINTS = 3;
const VITALITY_MIN_DAYS = 14;

/** Each day scored against its own baseline, so the line is "normal for you"
 *  rather than an absolute scale that would rate a calm week as a bad one. */
function zFor(spark: Spark | undefined, date: string): number | null {
  if (!spark || spark.baseline.sd <= 0) return null;
  const point = spark.points.find((p) => p.date === date);
  if (!point) return null;
  const z = (point.value - spark.baseline.mean) / spark.baseline.sd;
  return spark.higherIsBetter ? z : -z;
}

function groupAt(sparks: Map<string, Spark>, date: string, keys: readonly string[]): number | null {
  const zs = keys.map((k) => zFor(sparks.get(k), date)).filter((z): z is number => z !== null);
  if (!zs.length) return null;
  return zs.reduce((a, b) => a + b, 0) / zs.length;
}

/**
 * How the whole picture has moved over the last month, on one line.
 *
 * A trend rather than a number for today, on purpose. Today's readiness already
 * exists and is a better judge of today; a daily composite here would only
 * compete with it. What a single figure cannot show is drift — the slow slide
 * where every night is a little worse than the last and no single day ever
 * looks bad enough to notice. That is what this line is for.
 *
 * Only the fast signals go in. Sleep debt and weight move over months, and
 * folding them into a daily line would apply today's reading to weeks of
 * history that it says nothing about. They stay as their own lines.
 */
export function vitalityTrend(sparks: readonly Spark[]): VitalityTrend {
  const map = new Map(sparks.map((s) => [s.key, s]));
  const sleep = map.get("sleep");
  const byDate = new Map<string, VitalityPoint>();
  const nights: number[] = [];
  const trainings: number[] = [];

  for (const point of sleep?.points ?? []) {
    const night = groupAt(map, point.date, NIGHT_KEYS);
    const training = groupAt(map, point.date, TRAINING_KEYS);
    if (night === null && training === null) continue;
    const n = night ?? 0;
    const t = training ?? 0;
    byDate.set(point.date, { date: point.date, value: Math.round(50 + 11 * (NIGHT_SHARE * n + (1 - NIGHT_SHARE) * t)) });
    if (night !== null) nights.push(n);
    if (training !== null) trainings.push(t);
  }

  const points = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

  if (points.length < VITALITY_MIN_DAYS) {
    return {
      enough: false,
      points,
      current: points.length ? points[points.length - 1].value : null,
      change: null,
      direction: "unknown",
      night: Math.round(mean(nights) * 10) / 10,
      training: Math.round(mean(trainings) * 10) / 10,
      verdict: `Only ${points.length} days scored — a fortnight is needed before this line means anything`,
    };
  }

  const current = points[points.length - 1].value;
  const first = points[0].value;
  const change = current - first;
  const direction: VitalityTrend["direction"] =
    change > FLAT_POINTS ? "up" : change < -FLAT_POINTS ? "down" : "flat";
  const weeks = Math.round((points.length - 1) / 7);

  const verdict =
    direction === "down"
      ? `Down ${Math.abs(change)} points over ${weeks} weeks. Nothing here looks broken — it is the slow version of not quite recovering.`
      : direction === "up"
        ? `Up ${change} points over ${weeks} weeks. Whatever you changed is working.`
        : `Holding steady over ${weeks} weeks — within ${FLAT_POINTS} points, which is just noise.`;

  return {
    enough: true,
    points,
    current,
    change,
    direction,
    night: Math.round(mean(nights) * 10) / 10,
    training: Math.round(mean(trainings) * 10) / 10,
    verdict,
  };
}

/* --------------------------------------------------------------- plateau */

export type Plateau = {
  exerciseId: string;
  name: string;
  bestLb: number | null;
  bestReps: number | null;
  bestDate: string | null;
  sessionsSince: number;
  daysSince: number | null;
  trend: "up" | "flat" | "down";
  verdict: string;
};

/** Enough sessions for "hasn't improved" to be a pattern and not a bad week. */
const PLATEAU_SESSIONS = 3;
const PLATEAU_DAYS = 10;

/**
 * Which lifts have stopped moving, judged on estimated one-rep max.
 *
 * Reps in the log are the honest signal here, and a 5lb gain on a 5-rep set is
 * a bigger change than 5lb on a 12-rep set, which raw weight cannot tell apart.
 * Bodyweight sets are left out of the load entirely — they would otherwise
 * dominate the best and pin every movement to a fake number.
 *
 * Only movements that have been trained at least four times are reported. A
 * movement seen twice is not plateaued, it is new.
 */
export function plateaus(state: StrengthState, today: string): Plateau[] {
  const out: Plateau[] = [];
  for (const exercise of state.exercises) {
    const sessions: { date: string; best: number; reps: number; weight: number }[] = [];
    for (const date of Object.keys(state.days).sort()) {
      const sets = state.days[date]?.[exercise.id] ?? [];
      let best = 0;
      let reps = 0;
      let weight = 0;
      for (const s of sets) {
        if (typeof s.weightLb !== "number" || s.weightLb <= 0) continue;
        if (typeof s.reps !== "number" || s.reps <= 0) continue;
        const est = e1rm(s.weightLb, s.reps);
        if (est > best) {
          best = est;
          reps = s.reps;
          weight = s.weightLb;
        }
      }
      if (best > 0) sessions.push({ date, best, reps, weight });
    }
    if (sessions.length < 4) continue;

    let bestIdx = 0;
    for (let i = 1; i < sessions.length; i++) if (sessions[i].best > sessions[bestIdx].best) bestIdx = i;
    const bestSession = sessions[bestIdx];
    const since = sessions.length - 1 - bestIdx;
    /* Measured to today, not to the last session: a best that is three weeks
       old because you have not trained is more stale than one that is three
       weeks old because you trained and it did not move, and the two should
       not read the same. */
    const daysSince =
      bestSession.date === today ? 0 : daysBetweenKeys(bestSession.date, today);

    const window = sessions.slice(-3).map((s) => s.best);
    const prior = sessions.slice(-6, -3).map((s) => s.best);
    const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
    const delta = mean(prior) ? (mean(window) - mean(prior)) / mean(prior) : 0;
    const trend: Plateau["trend"] = delta > 0.02 ? "up" : delta < -0.02 ? "down" : "flat";

    const held = since >= PLATEAU_SESSIONS && daysSince >= PLATEAU_DAYS;
    const round = (n: number) => Math.round(n);
    const verdict = held
      ? `No new best in ${since} sessions (${Math.round(daysSince / 7)} weeks). Time to add weight or change the movement.`
      : trend === "up"
        ? `Still climbing — ${round(bestSession.weight)}lb x ${bestSession.reps} is your best.`
        : trend === "down"
          ? `Drifting down over the last three sessions. Check the log before adding.`
          : `Holding steady near ${round(bestSession.weight)}lb x ${bestSession.reps}.`;

    out.push({
      exerciseId: exercise.id,
      name: exercise.name,
      bestLb: round(bestSession.best),
      bestReps: bestSession.reps,
      bestDate: bestSession.date,
      sessionsSince: since,
      daysSince,
      trend,
      verdict,
    });
  }
  return out.sort((a, b) => b.sessionsSince - a.sessionsSince);
}
