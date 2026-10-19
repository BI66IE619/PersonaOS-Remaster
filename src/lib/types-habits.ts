export type Habit = {
  id: string;
  name: string;
  createdAt: string;
  /** ISO weekdays this habit is due: 1 = Monday … 7 = Sunday. Empty means every
   *  day, which is what every habit saved before schedules existed becomes. The
   *  streak counts due days, so a weekday habit is not broken by the weekend. */
  schedule: number[];
  /** Day keys on which the habit was done. */
  days: string[];
  /** The device's clock the last time this habit changed: renamed, a day toggled.
   *
   *  One clock for the habit rather than one per day, because the local record of
   *  "done" is a list of days with no stamps of its own — the habit is the smallest
   *  thing a conflict can be decided on. */
  updatedAt: string;
};

export type HabitsState = {
  habits: Habit[];
  seeded: boolean;
  /** Same rule as every other synced store: which auth account this record is
      bound to, so a sign-out does not leave it on screen for the next account. */
  owner: string | null;
  /** Habit ids deleted here that the server has not confirmed yet. Same rule as
      the other stores: the row is gone locally, so the tombstone is the only
      thing left to tell the server about it. */
  pendingDeletes: string[];
};

export const EMPTY_HABITS: HabitsState = {
  habits: [],
  seeded: false,
  owner: null,
  pendingDeletes: [],
};
