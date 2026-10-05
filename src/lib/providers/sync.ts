import type { DataProvider, TodayView, Workout } from "../types";
import { addDays, dayKey } from "../dates";
import { round } from "../utils";
import { intensityFromHr } from "../sports";
import {
  buildSparks,
  buildVerdict,
  computeBaselines,
  computeReadiness,
  computeSignals,
  toDrivers,
  toStages,
} from "../scoring";
import type { DayRecord, SleepRecord } from "../seed";
import {
  Unauthenticated,
  getHealthDaily,
  getHealthSessions,
  getProfile,
  getWeightLog,
  requireUserId,
} from "../dal";
import { emptyTodayView } from "./empty";

/**
 * Vitality from Health Connect, through the same scoring the mock used.
 *
 * The point of the provider split is that computeBaselines, computeSignals and
 * buildVerdict take a DayRecord[] and know nothing about where it came from. So
 * this is not a second implementation of the readiness maths — it is a translation
 * from two flat tables into the DayRecord[] those functions already expect, and
 * every scoring rule stays in one place.
 */

/**
 * Read this far back.
 *
 * 120 days, matching the seed, because vitalityTrend refuses to call a line a
 * trend before a fortnight and the sparks want a month. Reading less would cap how
 * far back the trend can reach; reading more buys nothing the screen shows.
 */
const WINDOW_DAYS = 120;
const STALE_AFTER_MS = 86_400_000;
/** The body window BodyPanel claims to cover, and the one its own log filters to. */
const BODY_WINDOW_DAYS = 30;
/**
 * BMR approximated from weight alone. Mifflin-St Jeor needs age, sex and height,
 * which no profile field carries yet — the same approximation the mock used, and
 * no worse than the watch's own calorie estimate, which is itself a guess built on
 * this one.
 */
const KCAL_PER_KG_BMR = 24;
/** Still a constant because there is nowhere for a user to put a target yet, and
 *  Health Connect has no notion of one. */
const STEP_GOAL = 9000;

/**
 * Which app's numbers win when two sources report the same day.
 *
 * Several packages write to Health Connect and the same measurement can arrive
 * more than once. These rows are never summed — Samsung Health's step count
 * already includes what the band recorded, so adding the band's copy on top would
 * double every walk. One source per field instead, and the field is taken from the
 * first source in this order that reports it at all.
 *
 * Samsung Health first because it is the aggregator: it has already reconciled the
 * band and the phone against each other, so its number is the one that matches
 * what the user sees on their wrist.
 */
const SAMSUNG_HEALTH = "com.samsung.shealth";

function originRank(origin: string): number {
  if (origin === SAMSUNG_HEALTH) return 0;
  if (origin.startsWith("com.samsung")) return 1;
  return 2;
}

type HealthRow = Awaited<ReturnType<typeof getHealthDaily>>[number];
type HealthSessionRow = Awaited<ReturnType<typeof getHealthSessions>>[number];

/** One day's numbers, after the per-field source contest above. Every field is
 *  nullable because Health Connect reports whichever types the writing app
 *  supports, and a watch with no SpO2 sensor simply has no such record. */
type MergedDay = {
  steps: number | null;
  activeMin: number | null;
  restingHr: number | null;
  hrvRmssd: number | null;
  spo2: number | null;
  sleepTotalMin: number | null;
  sleepDeepMin: number | null;
  sleepRemMin: number | null;
  sleepLightMin: number | null;
  sleepStartUtc: Date | null;
  sleepEndUtc: Date | null;
  activeKcal: number | null;
};

/**
 * Collapse one day's rows into one, taking each field from the best-ranked source
 * that reports it rather than taking a whole row from the top source.
 *
 * Per field rather than per row because the two halves come from different places:
 * the band knows heart rate and the phone app knows sleep, and a whole-row winner
 * would throw away whichever one the aggregator happened not to carry.
 */
function mergeDay(rows: HealthRow[]): MergedDay {
  const ranked = [...rows].sort((a, b) => originRank(a.dataOrigin) - originRank(b.dataOrigin));
  const pick = <K extends keyof MergedDay>(key: K): MergedDay[K] => {
    for (const row of ranked) {
      const value = row[key];
      if (value !== null && value !== undefined) return value as MergedDay[K];
    }
    return null;
  };
  return {
    steps: pick("steps"),
    activeMin: pick("activeMin"),
    restingHr: pick("restingHr"),
    hrvRmssd: pick("hrvRmssd"),
    spo2: pick("spo2"),
    sleepTotalMin: pick("sleepTotalMin"),
    sleepDeepMin: pick("sleepDeepMin"),
    sleepRemMin: pick("sleepRemMin"),
    sleepLightMin: pick("sleepLightMin"),
    sleepStartUtc: pick("sleepStartUtc"),
    sleepEndUtc: pick("sleepEndUtc"),
    activeKcal: pick("activeKcal"),
  };
}

/**
 * What the app shows when there is activity but not enough to score readiness.
 *
 * Readiness is a trained signal — it needs sleep, its stages, HRV and resting
 * heart rate before it will say anything. A source that publishes steps and
 * calories but not sleep (Samsung Health does exactly this to Health Connect)
 * would otherwise leave every screen blank even though there is real activity to
 * show. So the day's steps, calories and workouts are rendered from what arrived,
 * and the verdict says plainly that the rest is missing rather than inventing it.
 */
function partialView(
  rows: HealthRow[],
  sessions: HealthSessionRow[],
  weightLog: Awaited<ReturnType<typeof getWeightLog>>,
  now: Date,
  tz: string,
): TodayView {
  const today = dayKey(now);
  const body = buildBody(weightLog, today);

  const byDay = new Map<string, HealthRow[]>();
  for (const row of rows) {
    const list = byDay.get(row.day);
    if (list) list.push(row);
    else byDay.set(row.day, [row]);
  }
  const latestDate = [...byDay.keys()].sort().at(-1) ?? today;
  const merged = mergeDay(byDay.get(latestDate) ?? []);
  const daySessions = sessions.filter((s) => s.day === latestDate);

  const activeKcal = Math.round(
    merged.activeKcal ?? daySessions.reduce((sum, s) => sum + (s.energyKcal ?? 0), 0),
  );
  const bmr = Math.round(body.weightKg * KCAL_PER_KG_BMR);
  const workouts: Workout[] = daySessions.map((s) => ({
    id: s.sourceRecordId,
    activity: s.activity,
    startUtc: s.startedAtUtc.toISOString(),
    durationMin: s.durationMin,
    calories: s.energyKcal,
    avgHr: s.avgHr,
    maxHr: s.maxHr,
    distanceM: s.distanceM,
  }));

  return {
    date: today,
    readiness: { score: 0, band: "low" },
    verdict:
      "Not enough health data to score readiness yet. Health Connect is not sharing sleep or heart rate, so only your activity is shown.",
    drivers: [],
    lastNight: {
      totalMin: merged.sleepTotalMin ?? 0,
      stages: [],
      efficiency: 0,
      bedtime: merged.sleepStartUtc?.toISOString() ?? now.toISOString(),
      wakeTime: merged.sleepEndUtc?.toISOString() ?? now.toISOString(),
    },
    today: {
      workouts,
      steps: merged.steps ?? 0,
      stepGoal: STEP_GOAL,
      activeMin: merged.activeMin ?? daySessions.reduce((sum, s) => sum + (s.activeMin ?? 0), 0),
      loadScore: Math.round(
        daySessions.reduce((sum, s) => sum + s.durationMin * intensityFromHr(s.avgHr), 0),
      ),
      calories: { total: bmr + activeKcal, active: activeKcal },
    },
    body,
    sparks: [],
    sleepSeries: [],
    freshness: { latestAt: now.toISOString(), isStale: true },
    timezone: tz,
  };
}

/**
 * The real provider.
 *
 * Never invents anything. With no rows it returns an empty view; with activity but
 * too few scorable nights it returns a partial view (steps, calories, workouts, and
 * a verdict saying what is missing); with two or more scorable nights it computes
 * readiness. The path is re-evaluated on every render rather than latched, so the
 * tab starts showing real numbers the moment the phone's first sync lands.
 */
export class SyncProvider implements DataProvider {
  async getToday(): Promise<TodayView> {
    let userId: string;
    try {
      userId = await requireUserId();
    } catch (e) {
      if (e instanceof Unauthenticated) return emptyTodayView();
      throw e;
    }

    const now = new Date();
    const today = dayKey(now);
    /* Both reads take an exclusive lower bound, hence the extra day. */
    const fromDay = addDays(today, -WINDOW_DAYS);

    const [rows, sessions, profile, weightLog] = await Promise.all([
      getHealthDaily(userId, fromDay, today),
      getHealthSessions(userId, fromDay, today),
      getProfile(userId),
      getWeightLog(userId, addDays(today, -BODY_WINDOW_DAYS)),
    ]);
    const tz = profile?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;

    /* No real readings yet: show nothing rather than an invented day. */
    if (rows.length === 0) return emptyTodayView(now, tz);

    const body = buildBody(weightLog, today);

    /* Group first, merge second. Merging as the rows streamed past would run the
       per-field source contest across the whole window instead of within a day. */
    const byDay = new Map<string, HealthRow[]>();
    for (const row of rows) {
      const list = byDay.get(row.day);
      if (list) list.push(row);
      else byDay.set(row.day, [row]);
    }

    const history = [...byDay.keys()]
      .sort()
      .map((date) =>
        toDayRecord(date, mergeDay(byDay.get(date) as HealthRow[]), sessions, body),
      )
      .filter((d): d is DayRecord => d !== null);

    /* A single night leaves every baseline with a standard deviation over an empty
       sample and a z-score of pure noise, so a score off anything less than two is
       not one the app can stand behind. Show the activity that did arrive instead
       of an empty screen. */
    if (history.length < 2) return partialView(rows, sessions, weightLog, now, tz);

    const baselines = computeBaselines(history);
    const signals = computeSignals(history, baselines);
    const readiness = computeReadiness(signals);
    const latest = history[history.length - 1];

    /* Same day-of-year rotation the mock uses, so the phrasing varies without
       reading as canned. */
    const variant = Math.floor(now.getTime() / 86_400_000) % 3;
    const wakeTimeUtc = new Date(latest.sleep.wakeTimeUtc);

    return {
      /* Today's date, not the date of the newest night. Every other panel in the
         app — agenda, habits, check-ins — is keyed to today, and pointing them at
         a stale day would show the wrong plan. The distance between now and the
         newest night is what `freshness` exists to report, and the header already
         renders it as a stale chip. */
      date: today,
      readiness,
      verdict: buildVerdict({
        score: readiness.score,
        band: readiness.band,
        signals,
        sleep: latest.sleep,
        today: latest,
        variant,
      }),
      drivers: toDrivers(signals, 3),
      lastNight: {
        totalMin: latest.sleep.totalMin,
        stages: toStages(latest.sleep),
        efficiency: asleepRatio(latest.sleep),
        bedtime: latest.sleep.bedtimeUtc,
        wakeTime: latest.sleep.wakeTimeUtc,
      },
      today: {
        workouts: latest.workouts,
        steps: latest.steps,
        stepGoal: STEP_GOAL,
        activeMin: latest.activeMin,
        loadScore: latest.loadScore,
        calories: {
          total: latest.calories.total,
          active: latest.calories.active,
        },
      },
      body,
      sparks: buildSparks(history, baselines),
      sleepSeries: history.map((d) => ({ date: d.date, totalMin: d.sleep.totalMin })),
      freshness: {
        latestAt: wakeTimeUtc.toISOString(),
        isStale: now.getTime() - wakeTimeUtc.getTime() > STALE_AFTER_MS,
      },
      timezone: profile?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
    };
  }
}

/**
 * A day becomes a DayRecord only if it carries everything the scoring pipeline
 * reads, and this is that list.
 *
 * The alternative — filling a gap with a zero, or carrying yesterday's value
 * forward — is worse than dropping the day. computeSignals z-scores each metric
 * against its own baseline, so an absent HRV read as zero is not a neutral gap, it
 * is the worst value in the window, and it would read as a bad day on a morning the
 * watch simply had not synced. Dropping a day costs one point on a sparkline;
 * inventing it costs a wrong number on the screen the user trusts most.
 *
 * So required: sleep duration, at least one sleep stage, the sleep window itself,
 * HRV and resting heart rate. The window is in the list because Vitality prints
 * the clock times and the freshness chip compares the night's end against now —
 * both need a timestamp, and a fabricated one would render as a real bedtime. A
 * Galaxy Fit reports all five every night; the list is here so a watch that does
 * not degrades to a gap rather than to a fabrication.
 */
function toDayRecord(
  date: string,
  merged: MergedDay,
  sessions: HealthSessionRow[],
  body: ReturnType<typeof buildBody>,
): DayRecord | null {
  const {
    sleepTotalMin,
    sleepStartUtc,
    sleepEndUtc,
    restingHr,
    hrvRmssd,
  } = merged;

  /* Sleep is the one thing that must be present — a readiness score off no sleep
     is not a score. HRV and resting heart rate are optional now: a source may not
     report them (Samsung Health through Health Connect reports neither), and a day
     is still worth scoring without them. */
  if (!sleepTotalMin || sleepTotalMin <= 0 || !sleepStartUtc || !sleepEndUtc) {
    return null;
  }

  /* Awake is whatever is left of the window once the asleep stages are accounted
     for, so it is derived rather than sent — a phone reporting a 480 minute window
     and 400 minutes of sleep has already told us the rest was spent awake, and
     asking it to sum that too is asking for the same number twice. Clamped, because
     a source whose stages add up to more than the window would otherwise produce a
     negative asleep time. */
  const deep = merged.sleepDeepMin ?? 0;
  const rem = merged.sleepRemMin ?? 0;
  const light = merged.sleepLightMin ?? 0;
  const asleep = Math.min(deep + rem + light, sleepTotalMin);
  const awakeMin = Math.max(0, sleepTotalMin - asleep);

  const daySessions = sessions.filter((s) => s.day === date);
  const workouts: Workout[] = daySessions.map((s) => ({
    id: s.sourceRecordId,
    activity: s.activity,
    startUtc: s.startedAtUtc.toISOString(),
    durationMin: s.durationMin,
    calories: s.energyKcal,
    avgHr: s.avgHr,
    maxHr: s.maxHr,
    distanceM: s.distanceM,
  }));

  /* Training load off the same 1-5 intensity the survey asks for, so a logged
     session and a synced one land on one scale. The absolute size is irrelevant —
     only that every real day is computed the same way, because it is read against
     its own baseline. */
  const loadScore = Math.round(
    daySessions.reduce((sum, s) => sum + s.durationMin * intensityFromHr(s.avgHr), 0),
  );

  const sleep: SleepRecord = {
    date,
    totalMin: sleepTotalMin,
    deepMin: deep,
    remMin: rem,
    lightMin: light,
    awakeMin,
    bedtimeUtc: sleepStartUtc.toISOString(),
    wakeTimeUtc: sleepEndUtc.toISOString(),
  };

  const active = Math.round(
    merged.activeKcal ?? daySessions.reduce((sum, s) => sum + (s.energyKcal ?? 0), 0),
  );
  const bmr = Math.round(body.weightKg * KCAL_PER_KG_BMR);

  return {
    date,
    sleep,
    hrv: hrvRmssd ?? 0,
    restingHr: restingHr ?? 0,
    spo2: merged.spo2 ?? 0,
    steps: merged.steps ?? 0,
    activeMin:
      merged.activeMin ?? daySessions.reduce((sum, s) => sum + (s.activeMin ?? 0), 0),
    weightKg: body.weightKg,
    bodyFatPct: body.bodyFatPct,
    calories: { bmr, active, total: bmr + active },
    workouts,
    loadScore,
  };
}

function asleepRatio(sleep: SleepRecord) {
  return (sleep.deepMin + sleep.remMin + sleep.lightMin) / sleep.totalMin;
}

/**
 * Weight from the log the user keeps by hand, not from Health Connect.
 *
 * Deliberate. Samsung Health will report a weigh-in from a connected scale, but the
 * weight log is the app's own record and the one BodyPanel already prefers — reading
 * weight from two places would leave the page showing one number while the card the
 * user had just edited showed another.
 *
 * BodyPanel reads this only as its fallback, before the first weigh-in, which is
 * why a missing body fat is zero rather than a null the type does not allow.
 */
function buildBody(
  logs: { day: string; kg: number; bodyFatPct: number | null }[],
  today: string,
) {
  const live = logs.filter((r) => r.day <= today).sort((a, b) => a.day.localeCompare(b.day));
  const points = live.map((r) => ({ date: r.day, value: round(r.kg, 2) }));
  const values = points.map((p) => p.value);
  const latest = live[live.length - 1];

  return {
    weightKg: values.length ? values[values.length - 1] : 0,
    /* One weigh-in in the window is no change at all, so nothing is reported —
       same reasoning as BodyPanel's own delta, which withholds it rather than
       showing a flat zero that reads as "held steady". */
    weightDeltaKg: values.length > 1 ? round(values[values.length - 1] - values[0], 1) : 0,
    bodyFatPct: round(latest?.bodyFatPct ?? 0, 1),
    points,
    mean: round(
      values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0,
      2,
    ),
  };
}