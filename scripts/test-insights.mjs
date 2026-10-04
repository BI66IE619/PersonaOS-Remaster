/**
 * Direct tests for the four multi-day calculations. No browser: these are pure
 * functions, so they run straight through Node's type stripping. The browser
 * suite in test-insights-ui.mjs asserts the panels render; this asserts the
 * arithmetic is right, which is the part a screenshot cannot check.
 */
import { sleepDebt, sleepVsEnergy, weightTrend, plateaus, liftProgress, median, vitalityTrend } from "../src/lib/insights.ts";

let failed = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    failed++;
    console.log(`  FAIL ${name}: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
  } else {
    console.log(`  ok   ${name}`);
  }
}

/* -------------------------------------------------------------- sleep debt */

const nights = (mins) => mins.map((totalMin, i) => ({ date: `2026-09-${String(i + 1).padStart(2, "0")}`, totalMin }));

// median is exported for its own sake: it is the piece the whole thing rests on
check("median of odd count", median([5, 1, 3]), 3);
check("median of even count", median([5, 1, 3, 4]), 4);

// Under a week of nights: refuse to answer rather than guess
const thin = sleepDebt(nights([300, 300, 300]));
check("six nights is not enough", thin.enough, false);
check("thin verdict asks for a week", /a week is needed/.test(thin.verdict), true);

// A clean week at a consistent 8h owes nothing
const clean = sleepDebt(nights([480, 480, 480, 480, 480, 480, 480, 480]));
check("consistent week is clear", clean.enough, true);
check("consistent week owes nothing", clean.debtMin, 0);
check("consistent week has no repay plan", clean.nightsToRepay, null);

// Two 5h nights against a 480 median: 180 + 180 = 360 owed
const short = sleepDebt(nights([480, 480, 300, 300, 480, 480, 480, 480]));
check("debt sums the shortfalls", short.debtMin, 360);
check("counts the short nights", short.nightsBelow, 2);
check("repay plan at 30min a night", short.nightsToRepay, 12);
check("median is the 8h majority", short.medianMin, 480);

// A long night does not bank credit to cancel a short one: debt is shortfall only
const mixed = sleepDebt(nights([300, 900, 300, 900, 300, 900, 300, 900]));
check("long nights do not cancel short ones", mixed.debtMin > 0, true);

// One terrible night must not redefine "normal" — median, not mean
const oneBad = sleepDebt(nights([240, 480, 480, 480, 480, 480, 480, 480]));
check("one bad night does not move the median", oneBad.medianMin, 480);

/* ------------------------------------------------------- sleep vs energy */

// 390min is 6.5h, unambiguously short. Exactly 7h is not "short", so the
// boundary is exercised with a value clear of it.
const series = nights([390, 480, 540, 390, 480, 540, 390, 480]);
const entry = (day, energy) => ({ date: `2026-09-${String(day).padStart(2, "0")}`, energy, mood: 3, soreness: 2 });

// Not enough pairs yet: the claim is refused, and no gap is invented
const few = sleepVsEnergy(series, [entry(1, 2), entry(4, 2)]);
check("two pairs is not enough", few.enough, false);
check("no gap is invented from an empty bucket", few.diff, 0);

// Short nights (1,4,7) rated 2, long nights (2,3,5,6,8) rated 4
const split = sleepVsEnergy(series, [
  entry(1, 2), entry(2, 4), entry(3, 4), entry(4, 2), entry(5, 4),
  entry(6, 4), entry(7, 2), entry(8, 4),
]);
check("paired nights are enough", split.enough, true);
check("short-night energy", split.shortEnergy, 2);
check("long-night energy", split.longEnergy, 4);
check("gap is positive when sleep helps", split.diff, 2);
check("verdict quotes both averages", /2\.0.*4\.0/.test(split.verdict), true);

// Sleep genuinely not the lever — the call has to be able to say so
const flat = sleepVsEnergy(series, [
  entry(1, 3), entry(2, 3), entry(3, 3), entry(4, 3), entry(5, 3),
  entry(6, 3), entry(7, 3), entry(8, 3),
]);
check("no gap reported when there is none", flat.diff, 0);
check("verdict says something else is doing it", /Something else/.test(flat.verdict), true);

// A rating on a day with no sleep record is dropped, not paired with a guess
const orphan = sleepVsEnergy(series, [
  { date: "2026-08-01", energy: 1, mood: 3, soreness: 2 },
  entry(1, 2), entry(4, 2), entry(7, 2), entry(2, 4),
]);
check("unpaired ratings are ignored", orphan.shortNights + orphan.longNights, 4);

/* ------------------------------------------------------------ weight trend */

/* One reading per day, as a list — a day can hold several. */
const logs = (rows) => Object.fromEntries(rows.map(([date, lb]) => [date, lb]));

// A clear fall: 140 down to 136 over four weeks
const falling = weightTrend(
  logs([["2026-09-01", 140], ["2026-09-15", 138.5], ["2026-09-29", 136]]),
  "2026-09-29",
);
check("falling status", falling.status, "falling");
check("total change", falling.changeTotal, -4);
check("latest weight", falling.latestLb, 136);
check("falling slope is negative", falling.perWeek < 0, true);
check("falling verdict has no false slowdown", /but only/.test(falling.verdict), false);

// Down overall, flat in the last four weeks: the plateau read
const plateauing = weightTrend(
  logs([["2026-08-15", 140], ["2026-08-29", 137], ["2026-09-12", 136.2], ["2026-09-26", 136.1]]),
  "2026-09-26",
);
check("plateau called out after real progress", plateauing.status, "holding");
check("plateau verdict names it", /stopped moving/.test(plateauing.verdict), true);
check("plateau head keeps the earlier direction", /3\.9lb down/.test(plateauing.verdict), true);
// The 28-day window must start at the weigh-in exactly 28 days back (137), not
// the one before it (140), or the recent change stretches to the whole log.
check("recent change uses the 28-day baseline", plateauing.changeRecent, -0.9);

// A genuine slowdown: still moving, but at well under half the earlier rate
const slowing = weightTrend(
  logs([
    ["2026-07-01", 145], ["2026-07-29", 140], ["2026-08-26", 137.5],
    ["2026-09-09", 137], ["2026-09-23", 136.2],
  ]),
  "2026-09-23",
);
check("still falling while slowing", slowing.status, "falling");
check("slowdown is reported", /slowing down/.test(slowing.verdict), true);
check("slowdown quotes the recent window", /1\.3lb in the last 28 days/.test(slowing.verdict), true);
check("head keeps the overall direction", /8\.8lb down/.test(slowing.verdict), true);

// Still climbing
const rising = weightTrend(
  logs([["2026-09-01", 132], ["2026-09-15", 133.5], ["2026-09-29", 135]]),
  "2026-09-29",
);
check("rising status", rising.status, "rising");
check("rising slope is positive", rising.perWeek > 0, true);

// Not enough weigh-ins
check("no weigh-ins", weightTrend({}, "2026-09-29").verdict, "No weigh-ins yet");
check("one weigh-in is not a line", weightTrend(logs([["2026-09-29", 136]]), "2026-09-29").enough, false);
check("two weigh-ins is not a line", weightTrend(logs([["2026-09-15", 136], ["2026-09-29", 135]]), "2026-09-29").enough, false);
check("two needs three to make a line", /three/.test(weightTrend(logs([["2026-09-15", 136], ["2026-09-29", 135]]), "2026-09-29").verdict), true);

// A future date cannot drag the trend, and junk is ignored
const future = weightTrend(
  logs([["2026-09-01", 140], ["2026-09-15", 138], ["2026-10-20", 100]]),
  "2026-09-15",
);
check("future weigh-ins ignored", future.entries, 2);
check("junk weight ignored", weightTrend(logs([["2026-09-01", 0], ["2026-09-15", 140]]), "2026-09-15").enough, false);

/* A day holds one reading, so the days are the weigh-ins and the two counts
   cannot drift apart. Asserted so a future change to stacking cannot quietly
   bring back a verdict that calls two weigh-ins "two days". */
const single = weightTrend({ "2026-09-01": 140, "2026-09-15": 138.5, "2026-09-29": 136 }, "2026-09-29");
check("days and weigh-ins are the same count", single.entries, 3);
check("the head names weigh-ins", /across 3 weigh-ins/.test(single.verdict), true);
check("the head does not say days", /across 3 days/.test(single.verdict), false);
check("a junk reading cannot zero the line", weightTrend({ "2026-09-01": 140, "2026-09-15": 138, "2026-09-29": 0 }, "2026-09-29").enough, false);

/* ---------------------------------------------------------------- plateau */

const ex = (id, name) => ({ id, name, usualReps: 8, targetSets: 4, weightLb: 0 });
const day = (date, sets) => ({ [date]: { "bench-press": sets.map(([weightLb, reps]) => ({ weightLb, reps })) } });

// Six sessions, best at the third: three sessions with no new best
const stalled = {
  exercises: [ex("bench-press", "Bench press")],
  days: {
    ...day("2026-08-10", [[100, 8]]),
    ...day("2026-08-17", [[105, 8]]),
    ...day("2026-08-24", [[110, 8]]),
    ...day("2026-08-31", [[110, 8]]),
    ...day("2026-09-07", [[110, 7]]),
    ...day("2026-09-21", [[110, 8]]),
  },
  seeded: true,
};
const stall = plateaus(stalled, "2026-09-21")[0];
check("stalled movement reported", stall.exerciseId, "bench-press");
check("three sessions without a best", stall.sessionsSince, 3);
check("days since best", stall.daysSince, 28);
check("plateau verdict says so", /No new best in 3 sessions/.test(stall.verdict), true);
check("best is held as an e1RM", stall.bestLb > 110, true);

// daysSince is measured to today, so a stale best is not hidden by a recent session
const stale = plateaus(stalled, "2026-10-21")[0];
check("stale best ages even if the last session was recent", stale.daysSince, 58);

// e1RM, not raw weight: lighter for more reps counts as a real best
const repsCount = plateaus({
  exercises: [ex("bench-press", "Bench press")],
  days: {
    ...day("2026-08-10", [[120, 3]]),
    ...day("2026-08-17", [[115, 6]]),
    ...day("2026-08-24", [[110, 10]]),
    ...day("2026-08-31", [[110, 10]]),
  },
  seeded: true,
}, "2026-08-31")[0];
check("reps win over raw weight", repsCount.bestLb > 132, true);

// Bodyweight sets must not become a fake load ceiling
const bodyweight = plateaus({
  exercises: [ex("push-ups", "Push-ups")],
  days: {
    ...day("2026-08-10", [[0, 20]]),
    ...day("2026-08-17", [[0, 22]]),
    ...day("2026-08-24", [[0, 25]]),
    ...day("2026-08-31", [[0, 25]]),
  },
  seeded: true,
}, "2026-08-31");
check("bodyweight-only movement is not scored", bodyweight.length, 0);

// Seen twice is not plateaued, it is new
const newish = {
  exercises: [ex("squat", "Squat")],
  days: { ...day("2026-09-14", [[95, 5]]), ...day("2026-09-21", [[97, 5]]) },
  seeded: true,
};
check("two sessions is not a plateau", plateaus(newish, "2026-09-21").length, 0);

// A climbing movement is not a stall
const climbing = plateaus({
  exercises: [ex("bench-press", "Bench press")],
  days: {
    ...day("2026-08-10", [[100, 8]]),
    ...day("2026-08-17", [[105, 8]]),
    ...day("2026-08-24", [[110, 8]]),
    ...day("2026-08-31", [[115, 8]]),
  },
  seeded: true,
}, "2026-08-31")[0];
check("climbing movement is not a plateau", climbing.sessionsSince, 0);
check("climbing verdict reads as progress", /Still climbing/.test(climbing.verdict), true);

check("no exercises, no plateaus", plateaus({ exercises: [], days: {}, seeded: true }, "2026-09-21").length, 0);

/* ------------------------------------------------------------- lift record */

const today = "2026-09-30";
const liftDay = (date, sets, id = "bench-press") => ({
  [date]: { [id]: sets.map(([weightLb, reps]) => ({ weightLb, reps })) },
});
const liftEx = (id, name) => ({ id, name, usualReps: 8, targetSets: 4, weightLb: 0 });

// A month of steady climbing: the record is the most recent session, and the
// comparison is against the best as it stood four weeks earlier.
const climbingLift = liftProgress(
  {
    exercises: [liftEx("bench-press", "Bench press")],
    days: {
      ...liftDay("2026-08-20", [[100, 5]]),
      ...liftDay("2026-08-27", [[105, 5]]),
      ...liftDay("2026-09-10", [[110, 5]]),
      ...liftDay("2026-09-24", [[115, 5]]),
    },
    seeded: true,
  },
  today,
)[0];
check("record movement reported", climbingLift.exerciseId, "bench-press");
check("four sessions counted", climbingLift.sessions, 4);
check("the set behind the record is kept", climbingLift.bestWeightLb, 115);
check("and its reps", climbingLift.bestReps, 5);
check("the record date is the newest session", climbingLift.bestDate, "2026-09-24");
// e1rm(115,5) = 115 * 1.1667 = 134.2
check("record is an e1RM, not the plate weight", climbingLift.bestLb, 134);
// Everything before 2026-09-02 is the "month ago" pool: 100x5=116.7, 105x5=122.5
check("compared against a month ago", climbingLift.priorLb, 123);
check("the gain is measured", climbingLift.gainLb, 11);

// One session is a first record, not progress. No month behind it.
const firstEver = liftProgress(
  { exercises: [liftEx("squat", "Squat")], days: { ...liftDay("2026-09-28", [[135, 3]], "squat") }, seeded: true },
  today,
)[0];
check("a lone session still sets a record", firstEver.bestLb, 149);
check("but claims no gain", firstEver.gainLb, null);
check("and has nothing to compare to", firstEver.priorLb, null);

// The window boundary: a session exactly on the cutoff is "now", not "a month ago"
const boundary = liftProgress(
  {
    exercises: [liftEx("bench-press", "Bench press")],
    days: { ...liftDay("2026-09-02", [[100, 5]]), ...liftDay("2026-09-20", [[120, 5]]) },
    seeded: true,
  },
  today,
)[0];
check("the cutoff day is not counted as the past", boundary.priorLb, null);

// Several sets in one session are one session, not four. The record goes to
// 95x8 rather than the heaviest 100x5, which is the whole reason the estimate
// exists: 120.3 beats 116.7 even though less is on the bar.
const manySets = liftProgress(
  {
    exercises: [liftEx("bench-press", "Bench press")],
    days: { ...liftDay("2026-09-25", [[90, 10], [95, 8], [100, 5], [80, 12]]) },
    seeded: true,
  },
  today,
)[0];
check("one day of sets is one session", manySets.sessions, 1);
check("the best set in the day is the record", manySets.bestWeightLb, 95);
check("a heavier set at lower reps does not take it", manySets.bestLb, 120);

// Bodyweight cannot produce a record — there is no load to grow
check(
  "bodyweight-only movement is not scored",
  liftProgress(
    { exercises: [liftEx("push-ups", "Push-ups")], days: { ...liftDay("2026-09-20", [[0, 20]], "push-ups") }, seeded: true },
    today,
  ).length,
  0,
);
check(
  "no logged sets, nothing to report",
  liftProgress({ exercises: [liftEx("bench-press", "Bench press")], days: {}, seeded: true }, today).length,
  0,
);

// Best first, so the panel leads with the strongest movement. Both movements
// are on the same day, so they share one date key rather than overwriting.
const ranked = liftProgress(
  {
    exercises: [liftEx("curl", "Bicep curls"), liftEx("bench", "Bench press")],
    days: {
      "2026-09-25": {
        curl: [{ weightLb: 20, reps: 10 }],
        bench: [{ weightLb: 120, reps: 5 }],
      },
    },
    seeded: true,
  },
  today,
);
check("both movements are reported", ranked.length, 2);
check("ranked by strength", ranked.map((l) => l.exerciseId), ["bench", "curl"]);

/* --------------------------------------------------------- vitality trend */

const spark = (key, unit, higherIsBetter, values, mean, sd) => ({
  key,
  label: key,
  unit,
  higherIsBetter,
  baseline: { mean, sd },
  points: values.map((value, i) => ({ date: `2026-09-${String(i + 1).padStart(2, "0")}`, value })),
});

const days = 30;
const flat30 = (v) => Array.from({ length: days }, () => v);
const rising30 = (base) => Array.from({ length: days }, (_, i) => base + i * 0.5);
const falling30 = (base) => Array.from({ length: days }, (_, i) => base - i * 0.5);

// A normal month: every signal flat on its own baseline, so the line sits at 50
const calm = vitalityTrend([
  spark("sleep", "h", true, flat30(8), 8, 0.5),
  spark("hrv", "ms", true, flat30(60), 60, 8),
  spark("restingHr", "bpm", false, flat30(58), 58, 3),
  spark("load", "", false, flat30(40), 40, 10),
]);
check("a calm month is enough data", calm.enough, true);
check("a calm month sits at the midpoint", calm.current, 50);
check("a calm month reads as flat", calm.direction, "flat");
check("a calm month says it is noise", /just noise/.test(calm.verdict), true);

// Under a fortnight it refuses to draw a conclusion
const shortWindow = vitalityTrend([
  spark("sleep", "h", true, flat30(8).slice(0, 6), 8, 0.5),
  spark("hrv", "ms", true, flat30(60).slice(0, 6), 60, 8),
]);
check("six days is not enough", shortWindow.enough, false);
check("short verdict asks for a fortnight", /fortnight/.test(shortWindow.verdict), true);

// Resting HR counts against you when it climbs, not with it
const hrUp = vitalityTrend([
  spark("sleep", "h", true, flat30(8), 8, 0.5),
  spark("hrv", "ms", true, flat30(60), 60, 8),
  spark("restingHr", "bpm", false, rising30(58), 58, 3),
  spark("load", "", false, flat30(40), 40, 10),
]);
check("a rising resting heart rate is bad", hrUp.direction, "down");
check("a rising resting heart rate is named", /slow version of not quite recovering/.test(hrUp.verdict), true);

// The night group averages its inputs, so a night that is bad on every measure
// counts once rather than four times. A naive weighted sum over the same night
// signals would weigh it at 0.3+0.26+0.16+0.16 = 0.88, so a night 2sd below
// normal would sit 2*0.88*11 = 19.4 points under the midpoint. Grouped, it must
// sit less far under than that — damped, but not ignored.
const badNight = vitalityTrend([
  spark("sleep", "h", true, flat30(7), 8, 0.5),
  spark("hrv", "ms", true, flat30(44), 60, 8),
  spark("restingHr", "bpm", false, flat30(64), 58, 3),
  spark("load", "", false, flat30(40), 40, 10),
]);
// sleep 7 vs mean 8 sd 0.5, hrv 44 vs 60 sd 8, rhr 64 vs 58 sd 3: all exactly 2sd off.
const drop = 50 - (badNight.current ?? 50);
check("night group reads a 2sd night as -2", badNight.night, -2);
check("a bad night is damped below the double-counted figure", drop < 19.4, true);
check("a bad night is damped but still counted", drop > 10, true);

// Recovery genuinely improving reads as up
const better = vitalityTrend([
  spark("sleep", "h", true, rising30(7), 7, 0.5),
  spark("hrv", "ms", true, rising30(52), 52, 8),
  spark("restingHr", "bpm", false, falling30(62), 62, 3),
  spark("load", "", false, flat30(40), 40, 10),
]);
check("improving recovery reads as up", better.direction, "up");
check("improving recovery says so", /is working/.test(better.verdict), true);

// A flat baseline cannot be scored, so nothing is invented
const noSd = vitalityTrend([
  spark("sleep", "h", true, flat30(8), 8, 0),
  spark("hrv", "ms", true, flat30(60), 60, 0),
]);
check("a zero-variance baseline yields no points", noSd.points.length, 0);
check("a zero-variance baseline is not enough", noSd.enough, false);

// No sparks at all
check("no sparks, no points", vitalityTrend([]).points.length, 0);

console.log(failed === 0 ? "\nall passing" : `\n${failed} failing`);
process.exit(failed === 0 ? 0 : 1);

