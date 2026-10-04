/**
 * The verdict is nine hand-written sentences, so the risk is not that the
 * arithmetic is wrong — it is that a sentence is chosen on a day it does not
 * fit. These assert the choice, not the wording.
 */
import { buildVerdict } from "../src/lib/scoring.ts";

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

const sig = (key, label, z, weight, value = "50", delta = "+0%", higherIsBetter = true) => ({
  key,
  label,
  z,
  weight,
  value,
  delta,
  tone: "good",
  higherIsBetter,
});

const sleep = { totalMin: 420, deepMin: 90, remMin: 110, lightMin: 200, awakeMin: 20, bedtimeUtc: "", wakeTimeUtc: "" };
const day = (workouts = []) => ({
  date: "2026-09-27",
  steps: 0,
  stepGoal: 8000,
  activeMin: 0,
  loadScore: 40,
  restingHr: 58,
  hrv: 60,
  bodyFatPct: 12,
  weightKg: 62,
  calories: { total: 2000, active: 500 },
  sleep,
  workouts,
});

const ALL_OK = [
  sig("hrv", "HRV", 1.2, 0.3, "68 ms", "+12%"),
  sig("sleep", "Sleep", 0.9, 0.26, "8h", "+40m"),
  sig("restingHr", "Resting HR", 0.4, 0.16, "55 bpm", "-3 bpm", false),
  sig("efficiency", "Sleep quality", 0.5, 0.16, "92% eff", "+3pp"),
  sig("load", "7d load", 0.1, 0.12, "42", "normal", false),
];

const verdict = (signals, band, variant, workouts) =>
  buildVerdict({ score: 70, band, signals, sleep, today: day(workouts), variant });

/* ---- the case that motivated this: sleep fine, load is the problem ---- */
const loadIsTheProblem = [
  sig("load", "7d load", -2.0, 0.12, "68", "+40%", false),
  sig("hrv", "HRV", 0.8, 0.3, "66 ms", "+9%"),
  sig("sleep", "Sleep", 0.1, 0.26, "8h 12m", "+4m"),
  sig("efficiency", "Sleep quality", 0.1, 0.16, "91% eff", "+1pp"),
  sig("restingHr", "Resting HR", 0.3, 0.16, "57 bpm", "-1 bpm", false),
];

/* Every low-band sentence that mentions sleep must stay unchosen here, for
   every rotation offset. */
let sleepTalkedAboutLoad = 0;
for (let v = 0; v < 3; v++) {
  const text = verdict(loadIsTheProblem, "low", v);
  if (/only got|of sleep/.test(text) && /Back off|Recovery is the priority/.test(text)) sleepTalkedAboutLoad++;
}
check("a load-driven day never blames sleep", sleepTalkedAboutLoad, 0);

/* And it must actually name the load, not sleep */
const lowText = verdict(loadIsTheProblem, "low", 1);
check("a load-driven day names the load", /7d load/.test(lowText), true);
check("a load-driven low verdict exists for every rotation", [0, 1, 2].every((v) => verdict(loadIsTheProblem, "low", v).length > 0), true);

/* ---- sleep genuinely is the problem: the sleep-led lines are allowed ---- */
const sleepIsTheProblem = [
  sig("sleep", "Sleep", -2.2, 0.26, "5h 40m", "-2h 10m"),
  sig("hrv", "HRV", -1.4, 0.3, "48 ms", "-18%"),
  sig("efficiency", "Sleep quality", -1.1, 0.16, "74% eff", "-12pp"),
  sig("restingHr", "Resting HR", -0.9, 0.16, "64 bpm", "+6 bpm", false),
  sig("load", "7d load", 0.0, 0.12, "40", "normal", false),
];
const sleepTexts = [0, 1, 2].map((v) => verdict(sleepIsTheProblem, "low", v));
check("a sleep-driven day can still say so", sleepTexts.some((t) => /only got/.test(t)), true);
check("a sleep-driven day never names load as the cause", sleepTexts.every((t) => !/7d load/.test(t)), true);

/* ---- "the best signal is up" needs the best signal to actually be up ---- */
const allFlat = ALL_OK.map((s) => ({ ...s, z: 0.05 }));
let claimedUp = 0;
for (let v = 0; v < 3; v++) if (/is up \(/.test(verdict(allFlat, "mid", v))) claimedUp++;
check("a flat day never claims something is up", claimedUp, 0);

/* When something is genuinely up, the line is allowed to say so */
const clearlyUp = [
  sig("hrv", "HRV", 2.0, 0.3, "72 ms", "+18%"),
  sig("sleep", "Sleep", -0.5, 0.26, "7h 30m", "-20m"),
  sig("efficiency", "Sleep quality", -0.2, 0.16, "89% eff", "-2pp"),
  sig("restingHr", "Resting HR", 0.2, 0.16, "56 bpm", "-2 bpm", false),
  sig("load", "7d load", 0.0, 0.12, "40", "normal", false),
];
let allowedUp = 0;
for (let v = 0; v < 3; v++) if (/is up \(/.test(verdict(clearlyUp, "mid", v))) allowedUp++;
check("a clearly better day may say something is up", allowedUp > 0, true);

/* ---- hard sessions change the advice, not the diagnosis ---- */
check(
  "a hard session swaps the plan",
  /Take the hard session|take the hard session/.test(verdict(ALL_OK, "high", 0, [{ activity: "Intervals", minutes: 40 }])),
  true,
);
check(
  "an easy day gets easy advice",
  /Easy day, or add some easy volume\./.test(verdict(ALL_OK, "mid", 0)),
  true,
);
check(
  "a hard session changes the mid plan",
  /Train as planned/.test(verdict(ALL_OK, "mid", 0, [{ activity: "Intervals", minutes: 40 }])),
  true,
);

/* ---- never leave the day without a verdict ---- */
let empties = 0;
for (const band of ["high", "mid", "low"]) {
  for (let v = 0; v < 3; v++) {
    for (const set of [ALL_OK, allFlat, loadIsTheProblem, sleepIsTheProblem, []]) {
      if (verdict(set, band, v).length === 0) empties++;
    }
  }
}
check("a verdict always exists", empties, 0);

/* Rotation must still vary the wording, or the app feels robotic */
const distinct = new Set([0, 1, 2].map((v) => verdict(ALL_OK, "mid", v)));
check("rotation still produces different sentences", distinct.size > 1, true);

console.log(failed === 0 ? "\nall passing" : `\n${failed} failing`);
process.exit(failed === 0 ? 0 : 1);
