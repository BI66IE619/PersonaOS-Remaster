import type { CalCategory, TaskCategory } from "@/lib/categories";

export type CalEvent = {
  id: string;
  title: string;
  date: string;
  /** Minutes from midnight. Null means all day. */
  startMin: number | null;
  durationMin: number | null;
  note: string;
  category: CalCategory;
  /** Legacy flag from the event-driven prompt experiment. No longer set from
   *  the UI; kept optional so old saved events still load. When present, Home
   *  names the event in the daily sports prompt. */
  sport?: boolean;
  /** The device's clock the last time this row changed.
   *
   *  Its own field rather than derived from anything else, because "the calendar
   *  entry's day" and "the moment it was edited" are not the same fact. The sync
   *  rule needs the second one. */
  updatedAt: string;
};

export type Task = {
  id: string;
  title: string;
  /** Day key, or null for "someday". */
  due: string | null;
  done: boolean;
  createdAt: string;
  note: string;
  category: TaskCategory;
  /** Same rule as the events: the moment this row last changed, from the device
   *  that changed it. */
  updatedAt: string;
};

export type TasksState = {
  events: CalEvent[];
  tasks: Task[];
  /** First-run sample content, so the calendar is legible before you add
      anything. Cleared once you add or remove anything real. */
  seeded: boolean;
  /** The auth account this record belongs to, or null while nobody has claimed
      it. Same rule as the mentor: localStorage is keyed by origin, and without
      it a sign-out followed by a sign-in as somebody else would leave the
      previous account's plan on screen. */
  owner: string | null;
  /**
   * Ids deleted here that the server has not confirmed yet.
   *
   * A delete removes the row from `events` or `tasks` immediately, so without
   * this list it could not be pushed: the row the server needs to be told about
   * is exactly the row that was just dropped, and the other device would keep
   * showing a thing this one has deleted. Held as bare ids, so the server is not
   * sent the contents of something the user asked to be gone.
   */
  pendingDeletes: { events: string[]; tasks: string[] };
};

export const EMPTY_TASKS: TasksState = {
  events: [],
  tasks: [],
  seeded: false,
  owner: null,
  pendingDeletes: { events: [], tasks: [] },
};
