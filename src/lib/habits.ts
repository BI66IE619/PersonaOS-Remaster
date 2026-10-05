import { createStore } from "@/lib/create-store";
import { EMPTY_HABITS, type Habit, type HabitsState } from "@/lib/types-habits";

const KEY = "personaos:habits";

const isStr = (v: unknown): v is string => typeof v === "string";
const isDay = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
const uid = () => Math.random().toString(36).slice(2, 10);
const now = () => new Date().toISOString();

/**
 * A clock that never repeats within a row.
 *
 * Two toggles of the same habit can land in the same millisecond — a double-click on
 * a day, or a habit switched off in one handler and on in the next. The server's rule
 * is strictly-newer-wins, so equal stamps mean the second edit is discarded and the
 * local grid and the server's disagree about a thing that never had a real conflict.
 * One millisecond past the row's own last stamp is invisible to anything that reads a
 * date and makes each edit strictly newer than the one before it.
 */
function stampAfter(previous: string | undefined): string {
  const wall = Date.now();
  const before = previous ? Date.parse(previous) : Number.NaN;
  return new Date(Number.isNaN(before) ? wall : Math.max(wall, before + 1)).toISOString();
}

/** Well above what a year of daily habit-toggling produces, so a device that has
 *  been offline for months still owes the server every delete. */
const MAX_PENDING_DELETES = 200;

/**
 * Untrusted localStorage. Anything that does not match the shape is dropped
 * rather than trusted, so a hand-edited or half-written record cannot crash a
 * render.
 */
export function revive(raw: unknown): HabitsState {
  if (!raw || typeof raw !== "object") return EMPTY_HABITS;
  const o = raw as Record<string, unknown>;
  if (!Array.isArray(o.habits)) return EMPTY_HABITS;

  const habits: Habit[] = o.habits.flatMap((h): Habit[] => {
    if (!h || typeof h !== "object") return [];
    const c = h as Record<string, unknown>;
    if (!isStr(c.id) || !isStr(c.name) || !c.name.trim()) return [];
    const days = Array.isArray(c.days)
      ? [...new Set(c.days.filter(isDay))].sort()
      : [];
    return [
      {
        id: c.id,
        name: c.name.slice(0, 60),
        createdAt: isStr(c.createdAt) ? c.createdAt : new Date(0).toISOString(),
        days,
        /* Habits saved before the clock existed read as long ago, so a stale push
           from this record loses to anything the server already knows. */
        updatedAt: isStr(c.updatedAt) ? c.updatedAt : new Date(0).toISOString(),
      },
    ];
  });

  return {
    habits,
    seeded: typeof o.seeded === "boolean" ? o.seeded : false,
    /* Null when the record predates ownership: unclaimed, not empty. */
    owner: isStr(o.owner) && o.owner ? o.owner : null,
    pendingDeletes: Array.isArray(o.pendingDeletes)
      ? [...new Set(o.pendingDeletes.filter(isStr))].slice(-MAX_PENDING_DELETES)
      : [],
  };
}

const store = createStore<HabitsState>(KEY, EMPTY_HABITS, revive);

export const { getSnapshot, subscribe } = store;

const SERVER_STATE: HabitsState = EMPTY_HABITS;
/** Stable identity matters: useSyncExternalStore compares snapshots by reference. */
export const getServerSnapshot = (): HabitsState => SERVER_STATE;

/**
 * Bind this device's habits to the signed-in account.
 *
 * Same rule as the mentor and the plan: localStorage is keyed by origin, so
 * without this a sign-out followed by a sign-in as somebody else would leave one
 * account's streak history on the next account's screen. A mismatch empties the
 * record rather than merging; the previous owner's server copy is untouched.
 */
export function claimHabitsOwnership(userId: string): HabitsState {
  if (store.getSnapshot().owner === userId) return store.getSnapshot();
  /* From EMPTY_HABITS rather than the current state, so nothing carries over —
     including the tombstones, whose bare ids could otherwise collide with this
     account's habit ids and delete rows that never belonged to anyone else. */
  store.update(() => ({ ...EMPTY_HABITS, owner: userId }));
  return store.getSnapshot();
}

/* --------------------------------------------------------------------------
 * The pure core, kept free of I/O so the merge can be tested without a browser.
 * ------------------------------------------------------------------------ */

export function addHabitPure(state: HabitsState, name: string): HabitsState {
  const stamp = now();
  return {
    ...state,
    seeded: true,
    habits: [...state.habits, { id: uid(), name, createdAt: stamp, days: [], updatedAt: stamp }],
  };
}

/**
 * Toggle one day, moving the habit's clock so the change can travel.
 *
 * The whole habit is the conflict unit: the local record of "done" is a list of
 * days carrying no stamps of their own, so there is nothing to decide between
 * two devices that toggled *different* days at the same moment. The newer habit
 * wins wholesale and the older toggle is lost. Documented, and the same
 * last-write-wins tradeoff the mentor conversations already make.
 */
export function toggleHabitPure(state: HabitsState, id: string, day: string): HabitsState {
  if (!state.habits.some((h) => h.id === id)) return state;
  return {
    ...state,
    seeded: true,
    habits: state.habits.map((h) => {
      if (h.id !== id) return h;
      const has = h.days.includes(day);
      return {
        ...h,
        days: has ? h.days.filter((d) => d !== day) : [...h.days, day].sort(),
        updatedAt: stampAfter(h.updatedAt),
      };
    }),
  };
}

export function removeHabitPure(state: HabitsState, id: string): HabitsState {
  if (!state.habits.some((h) => h.id === id)) return state;
  return {
    ...state,
    seeded: true,
    habits: state.habits.filter((h) => h.id !== id),
    /* A tombstone carries the habit's id alone, which the server also uses to
       cascade the habit_days rows — so a delete is one fact, not one per day. */
    pendingDeletes: [...new Set([...state.pendingDeletes, id])].slice(-MAX_PENDING_DELETES),
  };
}

export function clearPendingDeletes(state: HabitsState, ids: string[]): HabitsState {
  if (ids.length === 0) return state;
  const gone = new Set(ids);
  const pendingDeletes = state.pendingDeletes.filter((id) => !gone.has(id));
  if (pendingDeletes.length === state.pendingDeletes.length) return state;
  return { ...state, pendingDeletes };
}

/* --------------------------------------------------------------------------
 * The merge.
 * ------------------------------------------------------------------------ */

/** A habit as it arrives from the server. Untrusted: a malformed row is dropped
 *  rather than shown. */
function reviveHabit(raw: unknown): Habit | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (!isStr(o.clientId) || !isStr(o.name) || !o.name.trim()) return null;
  const stamp = isStr(o.updatedAt) ? o.updatedAt : new Date(0).toISOString();
  return {
    id: o.clientId,
    name: o.name.slice(0, 60),
    createdAt: stamp,
    days: Array.isArray(o.days) ? [...new Set(o.days.filter(isDay))].sort() : [],
    updatedAt: stamp,
  };
}

/**
 * Fold a server pull into the local state.
 *
 * Last-write-wins per habit, on the device's own clock. A habit the pull does not
 * mention is left alone rather than removed: a cursor pull returns only what
 * changed, so treating silence as a delete would wipe the streaks on every pull.
 * Deletion is carried explicitly, by tombstone, and only that.
 *
 * Returns the same object when nothing changed, so a no-op pull does not
 * re-render the tab.
 */
export function mergeRemote(
  state: HabitsState,
  remote: { habits: unknown[]; deleted: string[] },
): HabitsState {
  let habits = state.habits;

  for (const raw of remote.habits) {
    const incoming = reviveHabit(raw);
    if (!incoming) continue;
    const existing = habits.find((h) => h.id === incoming.id);
    if (!existing) {
      habits = [...habits, incoming];
    } else if (incoming.updatedAt > existing.updatedAt) {
      habits = habits.map((h) => (h.id === incoming.id ? incoming : h));
    }
    /* Not newer: the local habit stands, so the winning device's toggles survive
       the round trip. */
  }

  /* Namespaced by the route, and stripped here rather than compared bare: a habit id
     is a bare string the device minted, and it can equal an event's or a task's, so a
     bare comparison would let one store's delete remove a row from another. Ids
     without the prefix are ignored — they belong to a store this one does not hold. */
  const gone = new Set(
    remote.deleted
      .filter((d): d is string => isStr(d) && d.startsWith("habit:"))
      .map((d) => d.slice(6)),
  );
  if (gone.size) habits = habits.filter((h) => !gone.has(h.id));

  if (habits === state.habits) return state;
  return { ...state, habits };
}

/* --------------------------------------------------------------------------
 * The payloads.
 * ------------------------------------------------------------------------ */

/**
 * A habit as pushed. The full `days` list travels with it, because the server
 * holds one row per day and the winning habit replaces them wholesale — there is
 * no per-day clock to reconcile them on.
 */
export function habitPayload(h: Habit, position: number) {
  return {
    clientId: h.id,
    name: h.name,
    days: h.days,
    updatedAt: h.updatedAt,
    position,
  };
}

/* --------------------------------------------------------------------------
 * The store's exported callers.
 * ------------------------------------------------------------------------ */

export function addHabit(name: string) {
  store.update((s) => addHabitPure(s, name));
}

export function toggleHabit(id: string, day: string) {
  store.update((s) => toggleHabitPure(s, id, day));
}

export function removeHabit(id: string) {
  store.update((s) => removeHabitPure(s, id));
}

/** Fold in a server pull. */
export function applyRemote(remote: { habits: unknown[]; deleted: string[] }) {
  store.update((s) => mergeRemote(s, remote));
}

/** Drop tombstones a push has confirmed. */
export function acknowledgeDeletes(ids: string[]) {
  store.update((s) => clearPendingDeletes(s, ids));
}

/** The current record, for the sync driver. */
export function currentHabitsState(): HabitsState {
  return store.getSnapshot();
}