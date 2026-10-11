import { createStore } from "./create-store";
import { addDays, daysBetween, weekStart } from "./dates";
import { MAX_PENDING_DELETES, reviveIds, stampAfter } from "./sync-stamp";

const KEY = "personaos:weight-log";

/** date -> pounds. One reading a day: weighing in three times does not show a
 *  trend, it shows the same day three times, and the extra numbers are water
 *  swinging around the line rather than a change in it. A second reading on the
 *  same day therefore corrects the first. User-entered, so stored exactly as
 *  typed rather than round-tripped through kg — a 135 lb plate load should not
 *  come back as 134.9. Seeded body data is a separate kg-based series. */
export type WeightLogs = Record<string, number>;

export const EMPTY_LOGS: WeightLogs = {};

/**
 * The record, now with the metadata sync needs.
 *
 * `stamps` holds the clock for each day separately rather than one for the whole
 * map, because editing Monday must not make Tuesday look changed. The public
 * shape of the readings stays a plain `WeightLogs` — `logsOf` is what the screens
 * read — so nothing that draws a weight has to know about the sync fields.
 */
export type WeightState = {
  logs: WeightLogs;
  stamps: Record<string, string>;
  owner: string | null;
  pendingDeletes: string[];
};

export const EMPTY_STATE: WeightState = { logs: {}, stamps: {}, owner: null, pendingDeletes: [] };

export const logsOf = (s: WeightState): WeightLogs => s.logs;

const isStr = (v: unknown): v is string => typeof v === "string";
const isDay = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

const usable = (n: unknown): n is number =>
  typeof n === "number" && Number.isFinite(n) && n > 0;

function reviveLogs(raw: unknown): { logs: WeightLogs; stamps: Record<string, string> } {
  if (!raw || typeof raw !== "object") return { logs: EMPTY_LOGS, stamps: {} };
  const logs: WeightLogs = {};
  const stamps: Record<string, string> = {};
  for (const [date, value] of Object.entries(raw as Record<string, unknown>)) {
    /* Briefly this allowed several readings a day, stored as a list. Those come
       back as the last reading of the day, which is the one the old panel showed
       as that day's number — so nothing logged in the meantime is silently lost. */
    const reading = Array.isArray(value) ? value.filter(usable).pop() : value;
    if (usable(reading)) logs[date] = reading;
  }
  return { logs, stamps };
}

function revive(raw: unknown): WeightState {
  if (!raw || typeof raw !== "object") return EMPTY_STATE;
  const o = raw as Record<string, unknown>;

  /* The migration from the old shape: it was a bare `date -> pounds` map with no
     wrapper. Read it as logs and give every day the epoch clock, so a stale push
     loses to whatever the server already knows. */
  const looksWrapped = "logs" in o || "owner" in o || "stamps" in o;
  const base = looksWrapped ? reviveLogs(o.logs) : reviveLogs(o);

  const stamps: Record<string, string> = {};
  if (looksWrapped && o.stamps && typeof o.stamps === "object") {
    for (const [date, v] of Object.entries(o.stamps as Record<string, unknown>)) {
      stamps[date] = isStr(v) ? v : new Date(0).toISOString();
    }
  }
  for (const date of Object.keys(base.logs)) {
    if (!stamps[date]) stamps[date] = new Date(0).toISOString();
  }

  return {
    logs: base.logs,
    stamps,
    owner: isStr(o.owner) && o.owner ? o.owner : null,
    pendingDeletes: reviveIds(o.pendingDeletes),
  };
}

const store = createStore<WeightState>(KEY, EMPTY_STATE, revive);

const SERVER_STATE: WeightState = EMPTY_STATE;

export const getSnapshot = store.getSnapshot;
export const subscribe = store.subscribe;

/** Stable identity matters: useSyncExternalStore compares snapshots by reference. */
export const getServerSnapshot = (): WeightState => SERVER_STATE;

export function claimWeightOwnership(userId: string): WeightState {
  const s = store.getSnapshot();
  if (s.owner === userId) return s;
  /* Adopt an unowned log rather than emptying it — it is this person's own
     readings from before they signed in. A log owned by someone else is cleared,
     tombstones included. */
  if (s.owner === null) {
    const adopted = { ...s, owner: userId };
    store.set(adopted);
    return adopted;
  }
  store.set({ ...EMPTY_STATE, owner: userId });
  return store.getSnapshot();
}

/** The most recent day carrying a reading at or before `today`, as pounds. */
export function latestLogged(logs: WeightLogs, today: string): number | null {
  const past = Object.keys(logs)
    .filter((d) => d <= today)
    .sort();
  return past.length ? logs[past[past.length - 1]] : null;
}

/** One entry per calendar day — logging again in a day corrects it, not stacks.
 *  Moves the day's clock so the correction can travel to the other device. */
export function logWeight(date: string, lb: number) {
  const rounded = Math.round(lb * 10) / 10;
  if (!Number.isFinite(rounded) || rounded <= 0) return;
  store.update((s) => ({
    ...s,
    logs: { ...s.logs, [date]: rounded },
    stamps: { ...s.stamps, [date]: stampAfter(s.stamps[date]) },
  }));
}

export function removeWeight(date: string) {
  store.update((s) => {
    if (!(date in s.logs)) return s;
    const logs = { ...s.logs };
    delete logs[date];
    const stamps = { ...s.stamps };
    delete stamps[date];
    return {
      ...s,
      logs,
      stamps,
      pendingDeletes: [...new Set([...s.pendingDeletes, date])].slice(-MAX_PENDING_DELETES),
    };
  });
}

/** A week. The prompt is anchored to the calendar rather than counted off the
 *  last reading, so it lands on Monday morning every week instead of drifting to
 *  whatever weekday the previous weigh-in happened to fall on. */
export const CADENCE_DAYS = 7;

/**
 * Whether a weigh-in is due: never logged one, or the last was before this week
 * began. Future-dated entries are ignored when working out the last one, so a
 * stray bad date cannot quietly suppress the prompt forever.
 *
 * `next` is the Monday after this week's, which the countdown prints. It is the
 * same value whether or not a weigh-in is outstanding, because "when should I
 * next weigh in" has one answer: next Monday.
 */
export function weightDue(
  logs: WeightLogs,
  today: string,
): { due: boolean; daysSince: number | null; next: string } {
  const monday = weekStart(today);
  const next = addDays(monday, CADENCE_DAYS);
  const past = Object.keys(logs)
    .filter((d) => d <= today)
    .sort();
  const latest = past[past.length - 1];
  if (!latest) return { due: true, daysSince: null, next };
  const daysSince = daysBetween(latest, today);
  /* Due once the week has turned over without a reading in it. Log it any day of
     the week and the next one waits for the following Monday. */
  return { due: latest < monday, daysSince, next };
}

/* --------------------------------------------------------------------------
 * The sync half.
 *
 * Weight is stored in pounds and the server column is kg, so the payload and
 * the merge both convert. The screen's own store stays in pounds, because the
 * number a person typed is the number they should see again.
 * ------------------------------------------------------------------------ */

const LB_PER_KG = 2.2046226;
const kgToLb = (kg: number) => kg * LB_PER_KG;
const lbToKg = (lb: number) => lb / LB_PER_KG;

/** A reading as it arrives from the server, converted to pounds. */
function reviveRemote(raw: unknown): { date: string; lb: number; updatedAt: string } | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const day = isStr(o.day) ? o.day : isStr(o.clientId) ? o.clientId : null;
  if (!day || !isDay(day) || !usable(o.kg)) return null;
  /* Rounded to the tenth the device stores, so a round trip through kg lands on
     the same number rather than 135.0000001. */
  const lb = Math.round(kgToLb(o.kg as number) * 10) / 10;
  if (!usable(lb)) return null;
  return { date: day, lb, updatedAt: isStr(o.updatedAt) ? o.updatedAt : new Date(0).toISOString() };
}

export function mergeRemote(
  state: WeightState,
  remote: { weight: unknown[]; deleted: string[] },
): WeightState {
  let logs = state.logs;
  let stamps = state.stamps;
  let changed = false;
  for (const raw of remote.weight) {
    const incoming = reviveRemote(raw);
    if (!incoming) continue;
    const existingStamp = stamps[incoming.date];
    if (existingStamp !== undefined && !(incoming.updatedAt > existingStamp)) continue;
    logs = { ...logs, [incoming.date]: incoming.lb };
    stamps = { ...stamps, [incoming.date]: incoming.updatedAt };
    changed = true;
  }
  const gone = new Set(
    remote.deleted
      .filter((d): d is string => typeof d === "string" && d.startsWith("weight:"))
      .map((d) => d.slice(7)),
  );
  if (gone.size) {
    for (const date of gone) {
      if (!(date in logs)) continue;
      const next = { ...logs };
      delete next[date];
      logs = next;
      changed = true;
    }
  }
  if (!changed) return state;
  return { ...state, logs, stamps };
}

/** A reading as pushed, converted to the kg the column stores. */
export function weightPayload(date: string, lb: number, updatedAt: string) {
  return {
    clientId: date,
    day: date,
    kg: lbToKg(lb),
    updatedAt,
  };
}

export function applyRemote(remote: { weight: unknown[]; deleted: string[] }) {
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

export function currentWeightState(): WeightState {
  return store.getSnapshot();
}
