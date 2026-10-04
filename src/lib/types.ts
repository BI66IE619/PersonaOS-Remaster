export type SleepStage = "deep" | "rem" | "light" | "awake";

export type Tone = "good" | "mid" | "low" | "neutral";

export type Band = "low" | "mid" | "high";

export type Workout = {
  id: string;
  activity: string;
  startUtc: string;
  durationMin: number;
  calories: number | null;
  avgHr: number | null;
  maxHr: number | null;
  /** Always null on Galaxy Fit 3 — the band has no GPS. */
  distanceM: number | null;
};

export type Stage = { stage: SleepStage; min: number };

export type Driver = {
  label: string;
  value: string;
  delta: string;
  tone: Tone;
  hint?: string;
};

export type Spark = {
  key: string;
  label: string;
  unit: string;
  /** Oldest to newest. */
  points: { date: string; value: number }[];
  baseline: { mean: number; sd: number };
  /** false for HRV / sleep quality, where lower is worse. */
  higherIsBetter: boolean;
};

export type JournalEntry = {
  date: string;
  note: string;
  tags: string[];
};

/** A daily subjective log. 1-5 scales only — writing lives in Notes. */
export type CheckIn = {
  date: string;
  energy: number;
  mood: number;
  soreness: number;
};

export type TodayView = {
  date: string;
  readiness: { score: number; band: Band };
  verdict: string;
  drivers: Driver[];
  lastNight: {
    totalMin: number;
    stages: Stage[];
    efficiency: number;
    bedtime: string;
    wakeTime: string;
  };
  today: {
    workouts: Workout[];
    steps: number;
    stepGoal: number;
    activeMin: number;
    loadScore: number;
    /** BMR + activity, as a watch reports it. */
    calories: { total: number; active: number };
  };
  body: {
    weightKg: number;
    /** Change across the 30 day window, signed. */
    weightDeltaKg: number;
    bodyFatPct: number;
    points: { date: string; value: number }[];
    mean: number;
  };
  sparks: Spark[];
  /** Nights of sleep length, oldest first. The sleep sparkline only has the
   *  last 30 points at hourly resolution, which is not enough to owe or repay
   *  anything against, so the series is handed over in full. */
  sleepSeries: { date: string; totalMin: number }[];
  freshness: { latestAt: string; isStale: boolean };
  timezone: string;
};

export interface DataProvider {
  getToday(): Promise<TodayView>;
}
