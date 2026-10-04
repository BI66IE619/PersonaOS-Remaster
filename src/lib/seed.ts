import { clamp, gaussian, mulberry32, round } from "./utils";
import type { Workout } from "./types";

/** The user's real zone, so health and money agree on where "today" starts.
    Swaps for a profile setting once there is an account. */
export const MOCK_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;
export const STEP_GOAL = 9000;
export const HISTORY_DAYS = 120;
const SEED = 0x5eed1a;

/** A watch's daily "calories" is BMR plus everything you did on top of it.
    Mifflin-St Jeor needs age, sex and height, which this model doesn't carry
    yet, so BMR is approximated from body weight alone — enough for a believable
    number that still moves with weight. Swap in the real formula with a
    profile. */
const KCAL_PER_KG_BMR = 24;
/** ~0.04 kcal per step, the usual net-cost figure. */
const KCAL_PER_STEP = 0.04;

export type SleepRecord = {
  /** Local date the night ENDED (morning of). */
  date: string;
  totalMin: number;
  deepMin: number;
  remMin: number;
  lightMin: number;
  awakeMin: number;
  bedtimeUtc: string;
  wakeTimeUtc: string;
};

export type DayRecord = {
  date: string;
  sleep: SleepRecord;
  hrv: number;
  restingHr: number;
  spo2: number;
  steps: number;
  activeMin: number;
  weightKg: number;
  bodyFatPct: number;
  /** BMR + activity, the way a watch totals a day. */
  calories: { bmr: number; active: number; total: number };
  workouts: Workout[];
  loadScore: number;
};

type Session = {
  activity: string;
  min: number;
  avgHr: number;
  maxHr: number;
  calories: number;
  intensity: number;
  startHour: number;
};

/** A believable 3-run + 2-strength week, indexed by day of week (0 = Sun). */
const PROGRAM: (Session | null)[] = [
  { activity: "Strength — Upper", min: 44, avgHr: 114, maxHr: 145, calories: 265, intensity: 0.75, startHour: 17 }, // Sun
  null, // Mon rest
  { activity: "Run — Easy", min: 42, avgHr: 142, maxHr: 158, calories: 430, intensity: 0.9, startHour: 16 }, // Tue
  { activity: "Strength — Lower", min: 48, avgHr: 118, maxHr: 152, calories: 300, intensity: 0.8, startHour: 17 }, // Wed
  { activity: "Run — Intervals", min: 36, avgHr: 165, maxHr: 182, calories: 410, intensity: 1.35, startHour: 16 }, // Thu
  null, // Fri rest
  { activity: "Run — Long", min: 78, avgHr: 148, maxHr: 163, calories: 700, intensity: 1.05, startHour: 9 }, // Sat
];

function pad(n: number) {
  return String(n).padStart(2, "0");
}

/** Convert a wall-clock time in an arbitrary IANA zone to a UTC ISO string. */
function zonedToUtc(dateKey: string, hour: number, minute: number, timeZone: string) {
  const h = Math.floor(hour);
  const m = Math.floor(minute);
  if (h < 0 || h > 23 || m < 0 || m > 59) {
    throw new RangeError(
      `zonedToUtc: out-of-range clock time ${h}:${m} for ${dateKey}`,
    );
  }
  const guess = Date.parse(`${dateKey}T${pad(h)}:${pad(m)}:00Z`);
  if (Number.isNaN(guess)) {
    throw new RangeError(`zonedToUtc: unparseable date key "${dateKey}"`);
  }
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const p = Object.fromEntries(
    dtf.formatToParts(new Date(guess)).map((x) => [x.type, x.value]),
  );
  const asUTC = Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    Number(p.hour) % 24,
    Number(p.minute),
    Number(p.second),
  );
  return new Date(guess - (asUTC - guess)).toISOString();
}

function keyOf(d: Date) {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** A fitness day is the user's local day, not the UTC one. */
function keyOfInZone(d: Date, timeZone: string) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(d)
      .map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day}`;
}

function addDays(key: string, n: number) {
  const d = new Date(`${key}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return keyOf(d);
}

function dowOf(key: string) {
  return new Date(`${key}T00:00:00Z`).getUTCDay();
}

export function generateHistory(now: Date = new Date()): DayRecord[] {
  const rnd = mulberry32(SEED);
  const todayKey = keyOfInZone(now, MOCK_TZ);
  const days: DayRecord[] = [];

  for (let i = 0; i < HISTORY_DAYS; i++) {
    const date = addDays(todayKey, i - (HISTORY_DAYS - 1));
    const dow = dowOf(date);
    const prevDate = addDays(date, -1);
    const prevDow = dowOf(prevDate);

    /* ---- workouts (10% of scheduled sessions get skipped, as life happens) ---- */
    const planned = PROGRAM[dow];
    const skipped = planned !== null && rnd() < 0.1;
    const session = skipped ? null : planned;

    const workouts: Workout[] = session
      ? [
          {
            id: `w-${date}-${session.activity}`,
            activity: session.activity,
            startUtc: zonedToUtc(date, session.startHour, Math.floor(rnd() * 50), MOCK_TZ),
            durationMin: Math.round(session.min + gaussian(rnd, 0, 4)),
            calories: Math.round(session.calories * (1 + gaussian(rnd, 0, 0.09))),
            avgHr: Math.round(session.avgHr + gaussian(rnd, 0, 5)),
            maxHr: Math.round(session.maxHr + gaussian(rnd, 0, 6)),
            distanceM: null,
          },
        ]
      : [];

    const loadScore = session
      ? Math.round(session.min * session.intensity * (1 + gaussian(rnd, 0, 0.08)))
      : 0;

    /* ---- sleep: the night that ended this morning ---- */
    let total = 425;
    if (prevDow === 5) total += 50; // Friday night: late
    else if (prevDow === 6) total += 25; // Saturday night
    else if (prevDow === 0) total -= 35; // Sunday night: sleep debt
    else if (prevDow === 4) total += 10;
    total -= 0.16 * i; // gradual bedtime improvement over the window
    if (prevDow === 3 || prevDow === 6) total -= 15; // after a hard session
    if (rnd() < 0.06) total -= 45 + rnd() * 45; // occasional bad night
    total += gaussian(rnd, 0, 25);
    total = Math.round(clamp(total, 245, 560));

    const awakeFrac = clamp(gaussian(rnd, 0.085, 0.028), 0.02, 0.24);
    const awakeMin = total * awakeFrac;
    const asleep = total - awakeMin;
    const deepMin = asleep * clamp(gaussian(rnd, 0.16, 0.035), 0.08, 0.28);
    const remMin = asleep * clamp(gaussian(rnd, 0.21, 0.045), 0.1, 0.32);
    const lightMin = Math.max(0, asleep - deepMin - remMin);

    const wakeMin = 6 * 60 + 50 + gaussian(rnd, 0, 22);
    /* Round to whole minutes *before* splitting into h/m, otherwise
       Math.round(x % 60) can roll over to 60 and produce "T07:60:00Z". */
    const wakeTotal = Math.round(clamp(wakeMin, 360, 9 * 60));
    const wakeHour = Math.floor(wakeTotal / 60);
    const wakeM = wakeTotal % 60;
    const wakeTimeUtc = zonedToUtc(date, wakeHour, wakeM, MOCK_TZ);
    const bedtimeUtc = new Date(
      Date.parse(wakeTimeUtc) - total * 60000,
    ).toISOString();

    const efficiency = clamp(asleep / total, 0.6, 0.99);

    /* ---- recovery markers, all correlated with the night above ---- */
    const weeklyRhythm = 4 * Math.sin((2 * Math.PI * i) / 7);
    const hrv = clamp(
      58 + weeklyRhythm + 0.02 * i + (efficiency - 0.9) * 40 +
        (prevDow === 3 || prevDow === 6 ? -5 : 0) + gaussian(rnd, 0, 6.5),
      22,
      95,
    );

    const restingHr = clamp(
      52 - (hrv - 58) * 0.09 - 0.008 * i + gaussian(rnd, 0, 2.2),
      42,
      72,
    );

    const spo2 = clamp(gaussian(rnd, 97.2, 1.1), 92, 100);

    /* ---- activity ---- */
    const isWeekend = dow === 0 || dow === 6;
    const steps = Math.round(
      clamp(
        (isWeekend ? 10500 : 7400) +
          (session?.activity === "Run — Long" ? 2500 : 0) +
          0.9 * i +
          gaussian(rnd, 0, 2200),
        2500,
        22000,
      ),
    );

    const activeMin = Math.round(
      clamp((session ? session.min * 0.85 : 0) + 14 + gaussian(rnd, 0, 7), 8, 130),
    );

    /* ---- body composition: slow trend plus a plateau wave ---- */
    const weightKg = round(
      68.4 - 0.011 * i + 0.25 * Math.sin(i / 19) + gaussian(rnd, 0, 0.22),
      1,
    );
    const bodyFatPct = round(17.5 - 0.01 * i + gaussian(rnd, 0, 0.3), 1);

    /* ---- calories burned: resting cost + session + steps ---- */
    const bmr = Math.round(weightKg * KCAL_PER_KG_BMR);
    const activeKcal = Math.round(
      workouts.reduce((sum, w) => sum + (w.calories ?? 0), 0) + steps * KCAL_PER_STEP,
    );

    /* No check-in here on purpose. Sleep, HRV and workouts are things a device
       would really report, so simulating them stands in for hardware. Energy,
       mood and soreness are not: they are the user's own, and a generator
       filling them in would have the app claim something about them that they
       never said. The check-in is seeded as history instead, in
       src/lib/checkins.ts, and today is left for the user to write.

       These draws are thrown away on purpose. The generator used to end each
       day by inventing a check-in, which took one draw for "was there one" and
       then four more on the days it decided to write one. The stream is
       sequential, so dropping those calls does not just remove the check-in --
       it moves every later day's sleep, HRV, resting HR and steps, silently
       rewriting months of history. So the calls stay and the results go. */
    if (rnd() < 0.52) {
      gaussian(rnd, 0, 0.8); // was energy
      gaussian(rnd, 0, 0.7); // was mood
      gaussian(rnd, 0, 0.7); // was soreness
      rnd(); // picked a note
    }

    days.push({
      date,
      sleep: {
        date,
        totalMin: Math.round(total),
        deepMin: Math.round(deepMin),
        remMin: Math.round(remMin),
        lightMin: Math.round(lightMin),
        awakeMin: Math.round(awakeMin),
        bedtimeUtc,
        wakeTimeUtc,
      },
      hrv: round(hrv, 1),
      restingHr: Math.round(restingHr),
      spo2: round(spo2, 0),
      steps,
      activeMin,
      weightKg,
      bodyFatPct,
      calories: { bmr, active: activeKcal, total: bmr + activeKcal },
      workouts,
      loadScore,
    });
  }

  return days;
}
