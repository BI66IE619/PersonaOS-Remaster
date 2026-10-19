import { createStore } from "@/lib/create-store";
import { dayKey } from "@/lib/dates";
import { MAX_PENDING_DELETES, reviveIds, stampAfter } from "@/lib/sync-stamp";
import type { CheckIn } from "@/lib/types";

/**
 * One entry per day, keyed by date. The previous check-in held a single entry
 * in a single slot, so logging twice in a day erased the first one and there
 * was never any history to look back on.
 *
 * As with notes, the day is the identity: the client id pushed to the server is
 * the date, so the same day edited on two devices reconciles by the later clock
 * rather than by which one reached the server first.
 */
const KEY = "personaos:checkins";

const isStr = (v: unknown): v is string => typeof v === "string";
const isDay = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

/** 0 means "not rated", 1-5 is the actual scale. */
const scale = (v: unknown): number =>
  typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 5 ? v : 0;

/** A check-in as this device stores it. `updatedAt` is the sync clock. */
export type StoredCheckIn = CheckIn & { updatedAt: string };

function normalize(raw: unknown): StoredCheckIn | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (!isDay(o.date)) return null;
  const energy = scale(o.energy);
  const mood = scale(o.mood);
  const soreness = scale(o.soreness);
  const win = isStr(o.win) ? o.win.slice(0, 2000) : "";
  /* Nothing rated and no win is not a check-in. A day with only a win is: naming
     the win is the part the box is for. */
  if (!energy && !mood && !soreness && !win) return null;
  return {
    date: o.date,
    energy,
    mood,
    soreness,
    win,
    updatedAt: isStr(o.updatedAt) ? o.updatedAt : new Date(0).toISOString(),
  };
}

export type CheckInsState = {
  entries: StoredCheckIn[];
  seeded: boolean;
  owner: string | null;
  pendingDeletes: string[];
};

const EMPTY: CheckInsState = { entries: [], seeded: false, owner: null, pendingDeletes: [] };

function revive(raw: unknown): CheckInsState {
  if (!raw || typeof raw !== "object") return EMPTY;
  const o = raw as Record<string, unknown>;
  if (!Array.isArray(o.entries)) {
    return {
      ...EMPTY,
      owner: isStr(o.owner) && o.owner ? o.owner : null,
      seeded: typeof o.seeded === "boolean" ? o.seeded : false,
      pendingDeletes: reviveIds(o.pendingDeletes),
    };
  }

  const seen = new Set<string>();
  /* Only the client ever calls revive, so this is the user's real today. A
     day that has not happened yet cannot have been logged, whatever the
     stored value claims. */
  const today = dayKey(new Date());
  const entries = o.entries
    .map(normalize)
    .filter((e): e is StoredCheckIn => e !== null)
    .filter((e) => e.date <= today)
    .filter((e) => {
      if (seen.has(e.date)) return false;
      seen.add(e.date);
      return true;
    })
    .sort((a, b) => b.date.localeCompare(a.date));

  return {
    entries,
    seeded: typeof o.seeded === "boolean" ? o.seeded : false,
    owner: isStr(o.owner) && o.owner ? o.owner : null,
    pendingDeletes: reviveIds(o.pendingDeletes),
  };
}

const store = createStore<CheckInsState>(KEY, EMPTY, revive);

export const { getSnapshot, subscribe } = store;

const SERVER_STATE: CheckInsState = { entries: [], seeded: true, owner: null, pendingDeletes: [] };
/** Stable identity matters: useSyncExternalStore compares snapshots by reference. */
export const getServerSnapshot = (): CheckInsState => SERVER_STATE;

export function claimCheckInsOwnership(userId: string): CheckInsState {
  const s = store.getSnapshot();
  if (s.owner === userId) return s;
  /* Adopt an unowned record rather than emptying it — it is this person's own
     check-ins from before they signed in. A record owned by someone else is
     cleared, tombstones included. */
  if (s.owner === null) {
    const adopted = { ...s, owner: userId };
    store.set(adopted);
    return adopted;
  }
  store.set({ ...EMPTY, owner: userId });
  return store.getSnapshot();
}

export const byDate = (entries: CheckIn[], date: string): CheckIn | undefined =>
  entries.find((e) => e.date === date);

const sortDesc = (a: CheckIn, b: CheckIn) => b.date.localeCompare(a.date);

const withTombstone = (state: CheckInsState, date: string, entries: StoredCheckIn[]): CheckInsState => ({
  ...state,
  seeded: true,
  entries,
  pendingDeletes: [...new Set([...state.pendingDeletes, date])].slice(-MAX_PENDING_DELETES),
});

export function saveCheckIn(date: string, patch: Omit<CheckIn, "date">) {
  const s = store.getSnapshot();
  const existing = s.entries.find((e) => e.date === date);
  const next: StoredCheckIn = {
    date,
    energy: scale(patch.energy),
    mood: scale(patch.mood),
    soreness: scale(patch.soreness),
    win: (patch.win ?? "").slice(0, 2000).trim(),
    updatedAt: stampAfter(existing?.updatedAt),
  };
  /* Clearing every scale and the win should drop the day rather than leave an
     empty row and owes the server a tombstone for the same reason a note delete
     does. The UI requires a win, so this is the explicit Clear path. */
  if (!next.energy && !next.mood && !next.soreness && !next.win) {
    if (!existing) return;
    store.set(withTombstone(s, date, s.entries.filter((e) => e.date !== date)));
    return;
  }
  store.set({
    ...s,
    seeded: true,
    entries: [next, ...s.entries.filter((e) => e.date !== date)].sort(sortDesc),
  });
}

export function removeCheckIn(date: string) {
  const s = store.getSnapshot();
  if (!s.entries.some((e) => e.date === date)) return;
  store.set(withTombstone(s, date, s.entries.filter((e) => e.date !== date)));
}

export function clearCheckIns() {
  store.update((s) => ({
    ...EMPTY,
    owner: s.owner,
    seeded: true,
    pendingDeletes: [
      ...new Set([...s.pendingDeletes, ...s.entries.map((e) => e.date)]),
    ].slice(-MAX_PENDING_DELETES),
  }));
}

/* --------------------------------------------------------------------------
 * The sync half.
 * ------------------------------------------------------------------------ */

/** A check-in as it arrives from the server. The day is the identity. A row the
 *  user has cleared is dropped rather than kept as an empty row. */
function reviveRemote(raw: unknown): StoredCheckIn | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const day = isStr(o.day) ? o.day : isStr(o.clientId) ? o.clientId : null;
  if (!day || !isDay(day)) return null;
  const energy = scale(o.energy);
  const mood = scale(o.mood);
  const soreness = scale(o.soreness);
  /* The win rides in the check-in's text column; this is the only reader of it. */
  const win = isStr(o.text) ? o.text.slice(0, 2000) : "";
  if (!energy && !mood && !soreness && !win.trim()) return null;
  return {
    date: day,
    energy,
    mood,
    soreness,
    win,
    updatedAt: isStr(o.updatedAt) ? o.updatedAt : new Date(0).toISOString(),
  };
}

export function mergeRemote(
  state: CheckInsState,
  remote: { checkins: unknown[]; deleted: string[] },
): CheckInsState {
  let entries = state.entries;
  for (const raw of remote.checkins) {
    const incoming = reviveRemote(raw);
    if (!incoming) continue;
    const existing = entries.find((e) => e.date === incoming.date);
    if (!existing) entries = [...entries, incoming];
    else if (incoming.updatedAt > existing.updatedAt) {
      entries = entries.map((e) => (e.date === incoming.date ? incoming : e));
    }
  }
  const gone = new Set(
    remote.deleted
      .filter((d): d is string => typeof d === "string" && d.startsWith("checkin:"))
      .map((d) => d.slice(8)),
  );
  if (gone.size) entries = entries.filter((e) => !gone.has(e.date));
  if (entries === state.entries) return state;
  return { ...state, entries: entries.sort(sortDesc) };
}

/** A check-in as pushed. The day's win rides in the legacy `text` column, which
 *  the app otherwise never wrote — that is what makes it sync without a new column
 *  or a migration. */
export function checkinPayload(c: StoredCheckIn) {
  return {
    clientId: c.date,
    day: c.date,
    text: c.win ?? "",
    mood: c.mood || null,
    energy: c.energy || null,
    soreness: c.soreness || null,
    updatedAt: c.updatedAt,
  };
}

export function applyRemote(remote: { checkins: unknown[]; deleted: string[] }) {
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

export function currentCheckInsState(): CheckInsState {
  return store.getSnapshot();
}
