import { clamp, round } from "./utils";
import { formatDuration, signed } from "./format";
import type { Band, Driver, Spark, Stage, Tone } from "./types";
import type { DayRecord, SleepRecord } from "./seed";

const BASELINE_WINDOW = 30;
const SEVEN_DAYS = 7;

export type Baseline = { mean: number; sd: number };

function stat(values: number[]): Baseline {
  if (values.length === 0) return { mean: 0, sd: 0 };
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance =
    values.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, values.length - 1);
  return { mean, sd: Math.sqrt(variance) || 1 };
}

function efficiencyOf(s: SleepRecord) {
  const asleep = s.deepMin + s.remMin + s.lightMin;
  return asleep / s.totalMin;
}

const tone = (z: number): Tone => (z >= 0.5 ? "good" : z <= -0.5 ? "low" : "mid");

/** Rolling baseline from the days *before* today, so the score never chases itself. */
export function computeBaselines(history: DayRecord[]): Record<string, Baseline> {
  const prior = history.slice(0, -1).slice(-BASELINE_WINDOW);
  return {
    sleep: stat(prior.map((d) => d.sleep.totalMin)),
    efficiency: stat(prior.map((d) => efficiencyOf(d.sleep))),
    hrv: stat(prior.map((d) => d.hrv)),
    restingHr: stat(prior.map((d) => d.restingHr)),
    load: stat(prior.map((d) => d.loadScore)),
  };
}

type Signal = {
  key: string;
  label: string;
  z: number;
  /** positive z = better than baseline */
  weight: number;
  value: string;
  delta: string;
  tone: Tone;
  higherIsBetter: boolean;
};

export function computeSignals(
  history: DayRecord[],
  baselines: Record<string, Baseline>,
): Signal[] {
  const today = history[history.length - 1];
  const eff = efficiencyOf(today.sleep);
  const last7 = history.slice(-SEVEN_DAYS).reduce((a, d) => a + d.loadScore, 0);
  const loadPerDay = last7 / SEVEN_DAYS;

  const b = baselines;
  const zSleep = (today.sleep.totalMin - b.sleep.mean) / b.sleep.sd;
  const zEff = (eff - b.efficiency.mean) / b.efficiency.sd;
  const zHrv = (today.hrv - b.hrv.mean) / b.hrv.sd;
  const zRhr = (b.restingHr.mean - today.restingHr) / b.restingHr.sd;
  // Load is asymmetric: a normal week is neutral, an acute spike is not.
  const loadRatio = b.load.mean > 0 ? loadPerDay / b.load.mean : 1;
  const zLoad = loadRatio > 1.35 ? -(loadRatio - 1.35) * 2.2 : 0;

  return [
    {
      key: "hrv",
      label: "HRV",
      z: zHrv,
      weight: 0.3,
      value: `${Math.round(today.hrv)} ms`,
      delta: signed(round(((today.hrv - b.hrv.mean) / b.hrv.mean) * 100, 0), "%"),
      tone: tone(zHrv),
      higherIsBetter: true,
    },
    {
      key: "sleep",
      label: "Sleep",
      z: zSleep,
      weight: 0.26,
      value: formatDuration(today.sleep.totalMin),
      delta: signed(round(today.sleep.totalMin - b.sleep.mean, 0), "m"),
      tone: tone(zSleep),
      higherIsBetter: true,
    },
    {
      key: "restingHr",
      label: "Resting HR",
      z: zRhr,
      weight: 0.16,
      value: `${today.restingHr} bpm`,
      delta: signed(round(today.restingHr - b.restingHr.mean, 0), " bpm"),
      tone: tone(zRhr),
      higherIsBetter: false,
    },
    {
      key: "efficiency",
      label: "Sleep quality",
      z: zEff,
      weight: 0.16,
      value: `${Math.round(eff * 100)}% eff`,
      delta: signed(round((eff - b.efficiency.mean) * 100, 1), "pp", 1),
      tone: tone(zEff),
      higherIsBetter: true,
    },
    {
      key: "load",
      label: "7d load",
      z: zLoad,
      weight: 0.12,
      value: `${Math.round(loadPerDay)}`,
      delta: loadRatio > 1.35 ? signed(round((loadRatio - 1) * 100, 0), "%") : "normal",
      tone: tone(zLoad),
      higherIsBetter: false,
    },
  ].sort((a, c) => Math.abs(c.z) * c.weight - Math.abs(a.z) * a.weight);
}

/** Readiness band thresholds — single source of truth, shared with the ring glow. */
export function bandFor(score: number): Band {
  return score < 40 ? "low" : score < 68 ? "mid" : "high";
}

export function computeReadiness(signals: Signal[]): {
  score: number;
  band: Band;
} {
  const weighted = signals.reduce((acc, s) => acc + s.z * s.weight, 0);
  const score = Math.round(clamp(50 + 11 * weighted, 1, 100));
  return { score, band: bandFor(score) };
}

export function toDrivers(signals: Signal[], limit = 3): Driver[] {
  return signals.slice(0, limit).map((s) => ({
    label: s.label,
    value: s.value,
    delta: s.delta,
    tone: s.tone,
  }));
}

const HARD = /Intervals|Long/;

/** A signal only earns its own sentence once it is meaningfully off, not a
 *  rounding step from baseline. Below this, it is noise being described. */
const OFF = -0.3;
const UP = 0.3;

type VerdictTemplate = {
  /** Which signal this sentence is *about*, or null if it just names whatever
   *  is worst. Sleep-led lines are only allowed when sleep or sleep quality is
   *  actually driving the score. */
  lead: "sleep" | "efficiency" | null;
  /** Some lines lean on "the best signal is up", which is only true when it
   *  genuinely is. */
  needsRealBest?: boolean;
  text: string;
};

export function buildVerdict(input: {
  score: number;
  band: Band;
  signals: Signal[];
  sleep: SleepRecord;
  today: DayRecord;
  variant: number;
}): string {
  const { band, sleep, today, variant } = input;
  const worst = [...input.signals].sort((a, b) => a.z - b.z)[0];
  const best = [...input.signals].sort((a, b) => b.z - a.z)[0];
  const hardToday = today.workouts.some((w) => HARD.test(w.activity));
  const sleepStr = formatDuration(sleep.totalMin);
  const ending = hardToday ? "take the hard session" : "train hard or take a full rest day";
  const plan = hardToday ? "Train as planned, nothing spectacular." : "Easy day, or add some easy volume.";

  /* The app always has signals, but a verdict function that throws on an empty
     list is a trap for the next caller, and there is nothing to be clever about
     here — just say what is known. */
  if (!worst || !best) {
    return `${sleepStr} of sleep logged. Nothing to compare it against yet, so no call today.`;
  }

  const good: VerdictTemplate[] = [
    { lead: null, text: `${best.label} is ${best.delta} against baseline. Primed day — ${ending}.` },
    { lead: null, text: `Everything's trending up. ${best.label} at ${best.value} is your strongest signal right now. ${hardToday ? "Good day to push it." : "Bank the recovery while you can."}` },
    { lead: null, text: `Green across the board, ${best.label} leading at ${best.value}. ${hardToday ? "Go hard today." : "Use the green light."}` },
  ];

  const mid: VerdictTemplate[] = [
    { lead: null, needsRealBest: true, text: `Steady. ${best.label} is up (${best.delta}) but ${worst.label} is the thing to watch. ${plan}` },
    { lead: null, text: `Neither sharp nor flat — ${worst.label} at ${worst.value} is holding you back. ${hardToday ? "Do the session, keep it controlled." : "A walk and an early night would do more than a hard effort."}` },
    { lead: "sleep", text: `Middle of the road. ${sleepStr} of sleep and ${worst.label} at ${worst.value}. ${hardToday ? "Nothing to fear today." : "Recovery day is a reasonable call."}` },
  ];

  const low: VerdictTemplate[] = [
    { lead: "sleep", text: `Back off. ${worst.label} is ${worst.delta} and you only got ${sleepStr}. Walk or mobility today, and get to bed early.` },
    { lead: null, text: `Not today. ${worst.label} came in at ${worst.value} (${worst.delta}) on ${sleepStr} of sleep. Skip the hard effort — ${hardToday ? "the session can wait" : "just move gently"}.` },
    { lead: "sleep", text: `Recovery is the priority. ${sleepStr} of sleep with ${worst.label} ${worst.delta} means piling on intensity would be borrowing from tomorrow.` },
  ];

  const pool = band === "high" ? good : band === "mid" ? mid : low;
  /* The signal actually dragging the score down, not merely the lowest one:
     a signal can be low and matter little, and the sentence should follow the
     weight. Signals arrive sorted by |z| * weight, so the first one that is
     meaningfully off is the one to talk about. */
  const dominant = input.signals.find((s) => s.z < OFF) ?? null;
  const isNight = (k: string | null) => k === "sleep" || k === "efficiency";

  /* A sentence that names a cause is only honest when that cause is the one
     driving the score. Rotating blindly used to hand out "you only got 6h" on
     days when sleep was fine and training load was the problem. */
  const fits = (t: VerdictTemplate) => {
    if (t.needsRealBest && best.z <= UP) return false;
    if (t.lead === null) return true;
    if (dominant === null) return false;
    if (t.lead === dominant.key) return true;
    /* Sleep and sleep quality are the same story told twice, so a sentence
       about one is still correct when the other is the problem. */
    return isNight(t.lead) && isNight(dominant.key);
  };

  const eligible = pool.filter(fits);
  /* Never leave the day without a verdict: if nothing fits, drop the lines that
     make an extra claim rather than saying something untrue. */
  const usable = eligible.length ? eligible : pool.filter((t) => !t.needsRealBest);
  return usable[variant % usable.length].text;
}

export function toStages(s: SleepRecord): Stage[] {
  return [
    { stage: "deep", min: s.deepMin },
    { stage: "rem", min: s.remMin },
    { stage: "light", min: s.lightMin },
    { stage: "awake", min: s.awakeMin },
  ];
}

export function buildSparks(
  history: DayRecord[],
  baselines: Record<string, Baseline>,
): Spark[] {
  const window = history.slice(-30);
  const keys: {
    key: string;
    label: string;
    unit: string;
    higherIsBetter: boolean;
    get: (d: DayRecord) => number;
  }[] = [
    { key: "sleep", label: "Sleep", unit: "h", higherIsBetter: true, get: (d) => d.sleep.totalMin / 60 },
    { key: "hrv", label: "HRV", unit: "ms", higherIsBetter: true, get: (d) => d.hrv },
    { key: "restingHr", label: "Resting HR", unit: "bpm", higherIsBetter: false, get: (d) => d.restingHr },
    { key: "load", label: "Load", unit: "", higherIsBetter: false, get: (d) => d.loadScore },
  ];

  return keys.map((k) => ({
    key: k.key,
    label: k.label,
    unit: k.unit,
    higherIsBetter: k.higherIsBetter,
    points: window.map((d) => ({ date: d.date, value: round(k.get(d), 2) })),
    baseline: {
      mean: round(k.key === "sleep" ? baselines.sleep.mean / 60 : baselines[k.key].mean, 2),
      sd: round(k.key === "sleep" ? baselines.sleep.sd / 60 : baselines[k.key].sd, 2),
    },
  }));
}
