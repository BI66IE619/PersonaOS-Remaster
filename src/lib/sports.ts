import { createStore } from "@/lib/create-store";
import { addDays, daysBetween } from "@/lib/dates";
import { MAX_PENDING_DELETES, reviveIds, stampAfter } from "@/lib/sync-stamp";

const KEY = "personaos:sports";

export type SportSession = {
  id: string;
  date: string;
  sport: string;
  kind: "practice" | "game";
  minutes: number;
  intensity: number;
  /**
   * manual = the five-field survey. device = written by the watch, with no
   * question asked. Both live in the same log so training load counts the
   * morning run and the evening practice together.
   */
  source: "manual" | "device";
  /** Provider workout id, so a re-sync recognises what it already wrote. */
  deviceId?: string;
  avgHr?: number | null;
  calories?: number | null;
  /** The device's clock the last time this row changed. */
  updatedAt: string;
};

export type SportsState = {
  sessions: SportSession[];
  /** Dates the user answered "no" to, so the question stays gone for the day
   *  instead of nagging on every visit. Device-local: a dismissal is about this
   *  phone's prompt, not a fact about the account. */
  dismissed: string[];
  /** Provider workout ids the user has deleted. The watch re-offers the same
   *  workout on every page view, so removing the row alone would only hide it
   *  until the next reload put it back. Device-local for the same reason. */
  hiddenDevice: string[];
  owner: string | null;
  /** Ids of deleted *manual* sessions the server has not confirmed. Device
   *  sessions are never pushed, so they never need a tombstone here. */
  pendingDeletes: string[];
};

const EMPTY: SportsState = {
  sessions: [],
  dismissed: [],
  hiddenDevice: [],
  owner: null,
  pendingDeletes: [],
};

const isStr = (v: unknown): v is string => typeof v === "string";
const isDay = (v: unknown): v is string => isStr(v) && /^\d{4}-\d{2}-\d{2}$/.test(v);

/** Untrusted localStorage: anything that does not match the shape is dropped. */
function revive(raw: unknown): SportsState {
  if (!raw || typeof raw !== "object") return EMPTY;
  const o = raw as Record<string, unknown>;

  const sessions: SportSession[] = Array.isArray(o.sessions)
    ? o.sessions.flatMap((s): SportSession[] => {
        if (!s || typeof s !== "object") return [];
        const c = s as Record<string, unknown>;
        if (!isStr(c.id) || !isDay(c.date) || !isStr(c.sport) || !c.sport.trim()) return [];
        if (c.kind !== "practice" && c.kind !== "game") return [];
        if (typeof c.minutes !== "number" || !Number.isInteger(c.minutes) || c.minutes < 1 || c.minutes > 24 * 60) return [];
        if (typeof c.intensity !== "number" || !Number.isInteger(c.intensity) || c.intensity < 1 || c.intensity > 5) return [];
        const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
        return [
          {
            id: c.id,
            date: c.date,
            sport: c.sport.slice(0, 40),
            kind: c.kind,
            minutes: c.minutes,
            intensity: c.intensity,
            /* Sessions written before devices existed are all survey entries. */
            source: c.source === "device" ? "device" : "manual",
            ...(isStr(c.deviceId) ? { deviceId: c.deviceId } : {}),
            avgHr: num(c.avgHr),
            calories: num(c.calories),
            /* Saved before the clock existed. "Long ago" so a stale push loses to
               whatever the server already knows. */
            updatedAt: isStr(c.updatedAt) ? c.updatedAt : new Date(0).toISOString(),
          },
        ];
      })
    : [];

  const dismissed = Array.isArray(o.dismissed) ? o.dismissed.filter(isDay) : [];

  /* Kept short. An ignored workout only matters while the provider still offers
     it, and this list is never anything but a way of remembering a mistake. */
  const hiddenDevice = Array.isArray(o.hiddenDevice)
    ? o.hiddenDevice.filter(isStr).slice(-40)
    : [];

  return {
    sessions,
    dismissed,
    hiddenDevice,
    owner: isStr(o.owner) && o.owner ? o.owner : null,
    pendingDeletes: reviveIds(o.pendingDeletes),
  };
}

const store = createStore<SportsState>(KEY, EMPTY, revive);

export const { getSnapshot, subscribe } = store;

const SERVER_STATE: SportsState = EMPTY;
/** Stable identity matters: useSyncExternalStore compares snapshots by reference. */
export const getServerSnapshot = (): SportsState => SERVER_STATE;

/** Adopt an unowned log on first claim, clear a different account's. See notes. */
export function claimSportsOwnership(userId: string): SportsState {
  const s = store.getSnapshot();
  if (s.owner === userId) return s;
  if (s.owner === null) {
    const adopted = { ...s, owner: userId };
    store.set(adopted);
    return adopted;
  }
  store.set({ ...EMPTY, owner: userId });
  return store.getSnapshot();
}

const uid = () => Math.random().toString(36).slice(2, 10);

/** Every session on a day, earliest written first. A day can hold more than
 *  one: the watch's run and a practice logged by hand are both real. */
export const onDate = (sessions: SportSession[], date: string): SportSession[] =>
  sessions.filter((s) => s.date === date);

export function addSession(input: Omit<SportSession, "id" | "updatedAt">) {
  const s = store.getSnapshot();
  /* Always appends. A day genuinely can hold several sessions — a watch run
     and a practice logged by hand, or two training blocks — and this used to
     drop the earlier hand-written ones to make a re-filed survey correct itself.
     That is the wrong trade: the second form was meant to add a session, and
     silently deleting the first one lost a workout nobody had copied anywhere.
     Getting it wrong is now fixed by removing the row you don't want, which is
     visible. Device entries are keyed by their own id and are only ever
     replaced by a re-sync of that same workout. */
  store.set({
    ...s,
    sessions: [...s.sessions, { ...input, id: uid(), updatedAt: stampAfter(undefined) }],
  });
}

/**
 * Removes one session, and only that one.
 *
 * A watch workout is offered again on every page view, so deleting the row
 * alone would only hide it until the next reload brought it back. Its provider
 * id is remembered as ignored instead, which is what "that one was not a
 * session" has to mean for something the watch insists happened.
 *
 * A manual session gets a tombstone instead, so the delete reaches the other
 * device rather than being read as "not synced yet".
 */
export function removeSession(id: string) {
  const s = store.getSnapshot();
  const gone = s.sessions.find((x) => x.id === id);
  if (!gone) return;
  const hiddenDevice =
    gone.deviceId && !s.hiddenDevice.includes(gone.deviceId)
      ? [...s.hiddenDevice.slice(-39), gone.deviceId]
      : s.hiddenDevice;
  const pendingDeletes =
    gone.source === "manual"
      ? [...new Set([...s.pendingDeletes, id])].slice(-MAX_PENDING_DELETES)
      : s.pendingDeletes;
  store.set({
    ...s,
    sessions: s.sessions.filter((x) => x.id !== id),
    hiddenDevice,
    pendingDeletes,
  });
}

/**
 * Puts a deleted session back exactly as it was.
 *
 * The counterpart to removeSession, and the reason a delete can be a single tap
 * rather than select-then-confirm: the undo window means a session logged by
 * mistake is recoverable for a few seconds, which is the same safety a
 * confirmation dialog gives but without making everyone read the dialog.
 *
 * Restores the original id rather than minting a new one, so undoing twice in a
 * row cannot produce duplicates, and drops the tombstone for a watch workout —
 * otherwise the row would come back and be filtered out again as "deleted" on
 * the very next page view. A restored manual session re-pushes, which is what
 * cancels a delete already sent.
 */
export function restoreSession(session: SportSession) {
  const s = store.getSnapshot();
  if (s.sessions.some((x) => x.id === session.id)) return;
  const hiddenDevice = session.deviceId
    ? s.hiddenDevice.filter((d) => d !== session.deviceId)
    : s.hiddenDevice;
  store.set({
    ...s,
    sessions: [...s.sessions, { ...session, updatedAt: stampAfter(session.updatedAt) }],
    hiddenDevice,
    pendingDeletes: s.pendingDeletes.filter((x) => x !== session.id),
  });
}

export function dismissFor(date: string) {
  const s = store.getSnapshot();
  if (s.dismissed.includes(date)) return;
  /* Dismissals older than a week are dead weight. */
  store.set({ ...s, dismissed: [...s.dismissed.slice(-6), date] });
}

/** What a run of days of the log adds up to. */
export type WeekSlice = {
  /** Days counted. A week in progress is shorter than a finished one. */
  days: number;
  minutes: number;
  sessions: number;
  /** Distinct days with something on them. */
  trainedDays: number;
  restDays: number;
};

export type SportWeek = {
  /** Monday of the week being reported. */
  start: string;
  current: WeekSlice;
  /** The same days a week earlier, so the comparison is like for like. */
  previous: WeekSlice;
  deltaMinutes: number;
  /** Nothing was ever logged before this week, so "last week" is not a thing
   *  that happened — it is a week the user had not started yet. */
  firstWeek: boolean;
};

/** Monday of the week `date` falls in. ISO weeks, which is what a school week is. */
function startOfWeek(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  /* getUTCDay is 0 for Sunday, so this is the number of days back to Monday. */
  const back = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
  return addDays(date, -back);
}

/**
 * The sport total for the week in progress, against the same days a week ago.
 *
 * Comparing a partial week with a whole one is the trap here: on a Monday,
 * "1h 10m, 2h 10m less than last week" is both true and useless, because last
 * week went on to include a Wednesday and this one has not had a Tuesday yet.
 * So the earlier week is cut to the same number of days, and the headline
 * carries how many days are actually behind it.
 */
export function sportWeek(sessions: readonly SportSession[], today: string): SportWeek {
  const start = startOfWeek(today);
  /* Monday is day one, so a Wednesday is three days in. */
  const days = daysBetween(start, today) + 1;

  const slice = (from: string, count: number): WeekSlice => {
    /* Keys are YYYY-MM-DD, so they order as strings. */
    const to = addDays(from, count - 1);
    const inRange = sessions.filter((s) => s.date >= from && s.date <= to);
    const trainedDays = new Set(inRange.map((s) => s.date)).size;
    return {
      days: count,
      minutes: inRange.reduce((sum, s) => sum + s.minutes, 0),
      sessions: inRange.length,
      trainedDays,
      /* Rest days only mean something inside the days already lived: a week
         that has not reached Wednesday is not short of rest days. */
      restDays: count - trainedDays,
    };
  };

  const current = slice(start, days);
  const previous = slice(addDays(start, -7), days);

  return {
    start,
    current,
    previous,
    deltaMinutes: current.minutes - previous.minutes,
    firstWeek: !sessions.some((s) => s.date < start),
  };
}

/**
 * The watch's average heart rate turned into the same 1-5 scale the survey
 * asks for, so the two are comparable. Buckets rather than a formula: a watch
 * average is already coarse, and pretending to more precision than the sensor
 * has would be a lie in a number that feeds training load.
 */
export function intensityFromHr(avgHr: number | null | undefined): number {
  if (typeof avgHr !== "number" || !Number.isFinite(avgHr)) return 3;
  if (avgHr <= 95) return 1;
  if (avgHr <= 115) return 2;
  if (avgHr <= 135) return 3;
  if (avgHr <= 155) return 4;
  return 5;
}

/**
 * Which provider activities count as a sport session, and what to call it.
 *
 * The watch reports training, not sport: a strength session and an easy run are
 * both workouts, but neither is a practice or a game. Writing those into this
 * log would invent sessions that never happened, and would quietly answer the
 * one question the log exists to ask. Strength belongs to the lifting log, so
 * it is matched on purpose and left out. A cardio run counts, because running
 * is one of the sports the survey offers.
 *
 * Matching is by keyword anywhere in the name, not by prefix: providers label
 * the same activity several ways — "Run — Easy", "Indoor running", "Open water
 * swimming" — and a prefix test misses all but the first. Order matters where
 * one name could match two rows, so the specific ones come first.
 */
const ACTIVITY_TO_SPORT: [RegExp, string][] = [
  [/swim/, "Swimming"],
  [/row/, "Rowing"],
  [/cycl|bik|bike/, "Cycling"],
  [/run/, "Running"],
  [/soccer|football/, "Soccer"],
  [/basketball/, "Basketball"],
  [/tennis|pickleball/, "Tennis"],
  [/volley/, "Volleyball"],
  [/martial|karate|judo|taekwondo/, "Martial arts"],
  [/rock ?climb/, "Rock climbing"],
  [/hiking|hike/, "Hiking"],
  [/yoga|pilates/, "Yoga"],
];

/** The sport an activity belongs to, or null when it is not one. */
export function sportForActivity(activity: string): string | null {
  /* Only the part before a qualifier: "Run — Intervals" is a run, and the
     qualifier carries the effort, not the sport. */
  const head = activity.split(/\s+[—–-]\s+/)[0].trim().toLowerCase();
  if (!head) return null;
  for (const [re, sport] of ACTIVITY_TO_SPORT) if (re.test(head)) return sport;
  return null;
}

type DeviceWorkout = {
  id: string;
  activity: string;
  durationMin: number;
  avgHr: number | null;
  calories: number | null;
};

/**
 * Writes the watch's sport sessions into the log with nothing asked. Called
 * from whichever page happens to be open; the id check makes it idempotent, so
 * visiting Vitality and then Home adds nothing the second time.
 *
 * Practice-or-game is the one field a watch cannot know, so device entries are
 * always "practice". That is the safe way to be wrong: it never inflates a
 * game count.
 *
 * These rows are never pushed: the id is the phone's own Health Connect record,
 * which the other device does not have, so syncing it would add a second copy
 * there rather than move this one. The other device derives the same workout
 * from its own Health Connect.
 */
export function syncDeviceWorkouts(date: string, workouts: readonly DeviceWorkout[]) {
  if (workouts.length === 0) return;
  const s = store.getSnapshot();
  const known = new Set(s.sessions.map((x) => x.deviceId).filter(isStr));
  const ignored = new Set(s.hiddenDevice);
  const stamp = new Date().toISOString();
  const fresh = workouts
    .filter((w) => w.durationMin >= 1 && !known.has(w.id) && !ignored.has(w.id))
    .flatMap<SportSession>((w) => {
      const sport = sportForActivity(w.activity);
      if (!sport) return [];
      return [
        {
          id: `dev-${w.id}`,
          date,
          sport,
          kind: "practice" as const,
          minutes: Math.round(w.durationMin),
          intensity: intensityFromHr(w.avgHr),
          source: "device" as const,
          deviceId: w.id,
          avgHr: w.avgHr,
          calories: w.calories,
          updatedAt: stamp,
        },
      ];
    });
  if (fresh.length === 0) return;
  store.set({ ...s, sessions: [...s.sessions, ...fresh] });
}

/* --------------------------------------------------------------------------
 * The sync half.
 * ------------------------------------------------------------------------ */

/** A session as it arrives from the server. Untrusted. */
function reviveRemote(raw: unknown): SportSession | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const date = isStr(o.day) ? o.day : isStr(o.clientId) ? o.clientId : null;
  if (!date || !isDay(date) || !isStr(o.clientId)) return null;
  if (!isStr(o.name) || !o.name.trim()) return null;
  const minutes = typeof o.minutes === "number" && Number.isInteger(o.minutes) ? o.minutes : 0;
  const intensity = typeof o.intensity === "number" && Number.isInteger(o.intensity) ? o.intensity : 3;
  const numOrNull = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  return {
    id: o.clientId,
    date,
    sport: o.name.slice(0, 40),
    kind: o.kind === "game" ? "game" : "practice",
    minutes: Math.max(1, Math.min(24 * 60, minutes)),
    intensity: Math.max(1, Math.min(5, intensity)),
    source: o.source === "device" ? "device" : "manual",
    ...(isStr(o.deviceId) ? { deviceId: o.deviceId } : {}),
    avgHr: numOrNull(o.avgHr),
    calories: numOrNull(o.calories),
    updatedAt: isStr(o.updatedAt) ? o.updatedAt : new Date(0).toISOString(),
  };
}

/** Last-write-wins per session id. A session the pull does not mention is left
 *  alone — a cursor pull returns only what changed, so silence is not a delete. */
export function mergeRemote(
  state: SportsState,
  remote: { sports: unknown[]; deleted: string[] },
): SportsState {
  let sessions = state.sessions;
  for (const raw of remote.sports) {
    const incoming = reviveRemote(raw);
    if (!incoming) continue;
    const existing = sessions.find((s) => s.id === incoming.id);
    if (!existing) sessions = [...sessions, incoming];
    else if (incoming.updatedAt > existing.updatedAt) {
      sessions = sessions.map((s) => (s.id === incoming.id ? incoming : s));
    }
  }
  const gone = new Set(
    remote.deleted
      .filter((d): d is string => typeof d === "string" && d.startsWith("sport:"))
      .map((d) => d.slice(6)),
  );
  if (gone.size) sessions = sessions.filter((s) => !gone.has(s.id));
  if (sessions === state.sessions) return state;
  return { ...state, sessions };
}

/** A manual session as pushed. Device sessions are deliberately never sent. */
export function sportPayload(s: SportSession) {
  return {
    clientId: s.id,
    day: s.date,
    name: s.sport,
    kind: s.kind,
    minutes: s.minutes,
    intensity: s.intensity,
    source: s.source,
    deviceId: s.deviceId ?? null,
    avgHr: s.avgHr ?? null,
    calories: s.calories ?? null,
    updatedAt: s.updatedAt,
  };
}

export function applyRemote(remote: { sports: unknown[]; deleted: string[] }) {
  store.update((s) => mergeRemote(s, remote));
}

export function acknowledgeDeletes(ids: string[]) {
  if (ids.length === 0) return;
  const gone = new Set(ids);
  store.update((s) => ({
    ...s,
    pendingDeletes: s.pendingDeletes.filter((id) => !gone.has(id)),
  }));
}

export function currentSportsState(): SportsState {
  return store.getSnapshot();
}
