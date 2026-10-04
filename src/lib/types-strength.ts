export type StrengthSet = {
  reps: number;
  /** null for bodyweight movements. Pounds — user-entered, stored as typed. */
  weightLb: number | null;
};

export type Exercise = {
  id: string;
  name: string;
  /** Reps this movement is normally done at. Prefills new sets. 0 = not set. */
  usualReps: number;
  /** Sets this movement is normally done for. Drives the day's workout habit. 0 = no target. */
  targetSets: number;
  /**
   * The weight this movement is loaded to, held on the movement rather than on
   * each set. Logging is a swipe, so the weight has to already be known or there
   * is nothing to ask; it only changes when the user updates it, which in
   * practice is monthly. 0 = bodyweight.
   */
  weightLb: number;
  /** The device's clock the last time this movement changed. */
  updatedAt: string;
};

/** date -> exerciseId -> sets */
export type StrengthDays = Record<string, Record<string, StrengthSet[]>>;

export type StrengthState = {
  /** Guards the first-run programme seed so it is only ever applied once. */
  seeded?: boolean;
  exercises: Exercise[];
  days: StrengthDays;
  /**
   * "date::exerciseId" -> the device clock of that day/movement log.
   *
   * Held beside `days` rather than inside it so every existing reader of
   * `days[date][exerciseId]` keeps working unchanged. It is the unit of sync:
   * the whole set array for one movement on one day is written together, last
   * write wins.
   */
  logStamps: Record<string, string>;
  owner: string | null;
  /** Deleted movement ids and day/movement log ids the server has not confirmed. */
  pendingDeletes: { exercises: string[]; logs: string[] };
};

/** The row identity for a day/movement log. */
export const logKey = (date: string, exerciseId: string) => `${date}::${exerciseId}`;
