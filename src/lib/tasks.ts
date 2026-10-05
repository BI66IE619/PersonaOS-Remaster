import { createStore } from "@/lib/create-store";
import { normalizeCategory, normalizeTaskCategory, type TaskCategory } from "@/lib/categories";
import { EMPTY_TASKS, type CalEvent, type Task, type TasksState } from "@/lib/types-tasks";

const KEY = "personaos:tasks";

const isStr = (v: unknown): v is string => typeof v === "string";
const isBool = (v: unknown): v is boolean => typeof v === "boolean";
const isMin = (v: unknown): v is number | null =>
  v === null || (typeof v === "number" && Number.isInteger(v) && v >= 0 && v < 24 * 60);
const isDay = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
const uid = () => Math.random().toString(36).slice(2, 10);

/**
 * A clock that never repeats within a row.
 *
 * Date.now() has millisecond resolution and two edits to the same row can land in the
 * same millisecond — adding a task and ticking it off inside one event handler, or a
 * habit toggled twice by a double-click. The server's rule is strictly-newer-wins, so
 * two stamps that compare equal means the second edit is silently discarded: the user
 * ticks a task off, it does not stick on the other device, and the local copy and the
 * server copy disagree about a thing that never had a real conflict.
 *
 * Nudging one millisecond past the row's own last stamp costs a timestamp that is off
 * by a millisecond — invisible to everything that reads a date — and makes each edit
 * strictly newer than the one before it.
 */
function stampAfter(previous: string | undefined): string {
  const wall = Date.now();
  const before = previous ? Date.parse(previous) : Number.NaN;
  const next = Number.isNaN(before) ? wall : Math.max(wall, before + 1);
  return new Date(next).toISOString();
}

/** How many unconfirmed deletes to hold. Well above what a plan tab produces, so a
 *  device that deletes things with no connection still owes the server every one. */
const MAX_PENDING_DELETES = 200;

/**
 * Untrusted localStorage. Anything that does not match the shape is dropped
 * rather than trusted, so a hand-edited or half-written record cannot crash a
 * render or produce an impossible time.
 */
export function revive(raw: unknown): TasksState {
  if (!raw || typeof raw !== "object") return EMPTY_TASKS;
  const o = raw as Record<string, unknown>;

  /* Null when the record predates ownership. Unclaimed rather than empty: the plan
     behind it stays on the device until somebody signs in and claims it. */
  const owner = isStr(o.owner) && o.owner ? o.owner : null;

  const events: CalEvent[] = Array.isArray(o.events)
    ? o.events.flatMap((e): CalEvent[] => {
        if (!e || typeof e !== "object") return [];
        const c = e as Record<string, unknown>;
        if (!isStr(c.id) || !isStr(c.title) || !c.title.trim() || !isDay(c.date)) return [];
        return [
          {
            id: c.id,
            title: c.title.slice(0, 120),
            date: c.date,
            startMin: isMin(c.startMin) ? c.startMin : null,
            durationMin: isMin(c.durationMin) && c.durationMin !== null && c.durationMin > 0 ? c.durationMin : null,
            note: isStr(c.note) ? c.note.slice(0, 500) : "",
            /* Events saved before categories existed migrate to "other"
               rather than being dropped by validation. */
            category: normalizeCategory(c.category),
            /* Events saved before the flag existed were never asked about,
               so they default to not-sport. */
            sport: isBool(c.sport) ? c.sport : false,
            /* Saved before the clock existed. There is no right answer, and the
               least wrong one is "long ago": a stale push from this record then
               loses to anything the server already knows, which is what a device
               that has never synced should want. */
            updatedAt: isStr(c.updatedAt) ? c.updatedAt : new Date(0).toISOString(),
          },
        ];
      })
    : [];

  const tasks: Task[] = Array.isArray(o.tasks)
    ? o.tasks.flatMap((t): Task[] => {
        if (!t || typeof t !== "object") return [];
        const c = t as Record<string, unknown>;
        if (!isStr(c.id) || !isStr(c.title) || !c.title.trim()) return [];
        return [
          {
            id: c.id,
            title: c.title.slice(0, 120),
            due: isDay(c.due) ? c.due : null,
            done: isBool(c.done) ? c.done : false,
            createdAt: isStr(c.createdAt) ? c.createdAt : new Date().toISOString(),
            note: isStr(c.note) ? c.note.slice(0, 500) : "",
            /* Tasks saved before categories existed migrate to "other". */
            category: normalizeTaskCategory(c.category),
            /* Same rule as the events: an unclocked record reads as long ago. */
            updatedAt: isStr(c.updatedAt) ? c.updatedAt : new Date(0).toISOString(),
          },
        ];
      })
    : [];

  /* The tombstone lists. Filtered rather than trusted for the same reason as the
     mentor's: a hand-edited record must not put a non-string into a set that gets
     sent back to the server. The old shape had no deletes to owe. */
  const pd = (o.pendingDeletes ?? {}) as Record<string, unknown>;
  const pendingDeletes = {
    events: Array.isArray(pd.events) ? [...new Set(pd.events.filter(isStr))].slice(-MAX_PENDING_DELETES) : [],
    tasks: Array.isArray(pd.tasks) ? [...new Set(pd.tasks.filter(isStr))].slice(-MAX_PENDING_DELETES) : [],
  };

  return { events, tasks, seeded: isBool(o.seeded) ? o.seeded : false, owner, pendingDeletes };
}

const store = createStore<TasksState>(KEY, EMPTY_TASKS, revive);

export const { getSnapshot, subscribe } = store;

const SERVER_STATE: TasksState = EMPTY_TASKS;
/** Stable identity matters: useSyncExternalStore compares snapshots by reference. */
export const getServerSnapshot = (): TasksState => SERVER_STATE;

/**
 * Bind this device's plan to the signed-in account.
 *
 * Same rule as the mentor store, and the same reason: the plan is the day's
 * schedule, and on a shared browser a sign-out followed by a sign-in as somebody
 * else would leave one account's calendar on the next account's screen. A mismatch
 * empties the record rather than merging. Their server copy is untouched.
 */
export function claimTasksOwnership(userId: string): TasksState {
  if (store.getSnapshot().owner === userId) return store.getSnapshot();
  /* From EMPTY_TASKS rather than the current state, so nothing carries over —
     including the tombstones, which are the sharpest edge: an id left over from
     somebody else's delete list would be pushed into this account and could
     tombstone a row that happened to collide. */
  store.update(() => ({ ...EMPTY_TASKS, owner: userId }));
  return store.getSnapshot();
}

/* --------------------------------------------------------------------------
 * The pure core, kept free of I/O so the merge can be tested without a browser.
 * The exported functions below are one-line callers of these.
 * ------------------------------------------------------------------------ */

/** A new or changed event. */
export function putEvent(
  state: TasksState,
  input: Omit<CalEvent, "id" | "updatedAt"> & { id?: string },
): TasksState {
  const id = input.id ?? uid();
  const previous = state.events.find((e) => e.id === id)?.updatedAt;
  const next: CalEvent = { ...input, id, updatedAt: stampAfter(previous) };
  const exists = previous !== undefined;
  return {
    ...state,
    seeded: true,
    events: exists ? state.events.map((e) => (e.id === id ? next : e)) : [...state.events, next],
  };
}

/** Delete an event, and owe the server a tombstone for it. */
export function removeEventPure(state: TasksState, id: string): TasksState {
  if (!state.events.some((e) => e.id === id)) return state;
  return {
    ...state,
    seeded: true,
    events: state.events.filter((e) => e.id !== id),
    pendingDeletes: {
      ...state.pendingDeletes,
      events: [...new Set([...state.pendingDeletes.events, id])].slice(-MAX_PENDING_DELETES),
    },
  };
}

/** A new task. */
export function addTaskPure(
  state: TasksState,
  title: string,
  due: string | null,
  category: TaskCategory = "other",
): TasksState {
  const stamp = new Date().toISOString();
  return {
    ...state,
    seeded: true,
    tasks: [
      ...state.tasks,
      {
        id: uid(),
        title,
        due,
        done: false,
        createdAt: stamp,
        updatedAt: stamp,
        note: "",
        category: normalizeTaskCategory(category),
      },
    ],
  };
}

/** Toggle done, moving the clock so the change can travel. */
export function toggleTaskPure(state: TasksState, id: string): TasksState {
  if (!state.tasks.some((t) => t.id === id)) return state;
  return {
    ...state,
    seeded: true,
    tasks: state.tasks.map((t) =>
      t.id === id ? { ...t, done: !t.done, updatedAt: stampAfter(t.updatedAt) } : t,
    ),
  };
}

/** Delete a task, and owe the server a tombstone for it. */
export function removeTaskPure(state: TasksState, id: string): TasksState {
  if (!state.tasks.some((t) => t.id === id)) return state;
  return {
    ...state,
    seeded: true,
    tasks: state.tasks.filter((t) => t.id !== id),
    pendingDeletes: {
      ...state.pendingDeletes,
      tasks: [...new Set([...state.pendingDeletes.tasks, id])].slice(-MAX_PENDING_DELETES),
    },
  };
}

/** Forget tombstones the server has confirmed. */
export function clearPendingDeletes(
  state: TasksState,
  ids: { events: string[]; tasks: string[] },
): TasksState {
  if (ids.events.length === 0 && ids.tasks.length === 0) return state;
  const goneE = new Set(ids.events);
  const goneT = new Set(ids.tasks);
  const pendingDeletes = {
    events: state.pendingDeletes.events.filter((id) => !goneE.has(id)),
    tasks: state.pendingDeletes.tasks.filter((id) => !goneT.has(id)),
  };
  if (
    pendingDeletes.events.length === state.pendingDeletes.events.length &&
    pendingDeletes.tasks.length === state.pendingDeletes.tasks.length
  ) {
    return state;
  }
  return { ...state, pendingDeletes };
}

/* --------------------------------------------------------------------------
 * The merge.
 * ------------------------------------------------------------------------ */

/** An event as it arrives from the server. Untrusted: anything that does not
 *  match the shape is dropped rather than shown. */
function reviveEvent(raw: unknown): CalEvent | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (!isStr(o.clientId) || !isStr(o.title) || !o.title.trim() || !isDay(o.day)) return null;
  return {
    id: o.clientId,
    title: o.title.slice(0, 120),
    date: o.day,
    startMin: isMin(o.startMin) ? o.startMin : null,
    durationMin:
      isMin(o.durationMin) && o.durationMin !== null && o.durationMin > 0 ? o.durationMin : null,
    note: isStr(o.note) ? o.note.slice(0, 500) : "",
    category: normalizeCategory(o.category),
    /* The server does not store the flag; a pulled event is not a sport prompt. */
    sport: false,
    updatedAt: isStr(o.updatedAt) ? o.updatedAt : new Date(0).toISOString(),
  };
}

/** A task as it arrives from the server. Same rule as the events. */
function reviveTask(raw: unknown): Task | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (!isStr(o.clientId) || !isStr(o.title) || !o.title.trim()) return null;
  const stamp = isStr(o.updatedAt) ? o.updatedAt : new Date(0).toISOString();
  return {
    id: o.clientId,
    title: o.title.slice(0, 120),
    due: isDay(o.day) ? o.day : null,
    done: o.done === true,
    createdAt: stamp,
    note: isStr(o.note) ? o.note.slice(0, 500) : "",
    category: normalizeTaskCategory(o.category),
    updatedAt: stamp,
  };
}

/**
 * Fold a server pull into the local state.
 *
 * Last-write-wins per row, on the device's own clock. A row the pull does not
 * mention is left alone rather than removed: a cursor pull returns only what
 * changed, so treating silence as a delete would wipe the plan on every pull.
 * Deletion is carried explicitly, by tombstone, and only that.
 *
 * Returns the same object when nothing changed, so a no-op pull does not re-render
 * the tab.
 */
export function mergeRemote(
  state: TasksState,
  remote: { events: unknown[]; tasks: unknown[]; deleted: string[] },
): TasksState {
  let events = state.events;
  let tasks = state.tasks;

  for (const raw of remote.events) {
    const incoming = reviveEvent(raw);
    if (!incoming) continue;
    const existing = events.find((e) => e.id === incoming.id);
    if (!existing) {
      events = [...events, incoming];
    } else if (incoming.updatedAt > existing.updatedAt) {
      events = events.map((e) => (e.id === incoming.id ? incoming : e));
    }
    /* Not newer: the local row stands. Strictly-greater rather than
       greater-or-equal, so a pull of what this device just pushed is a no-op
       rather than a render. */
  }

  for (const raw of remote.tasks) {
    const incoming = reviveTask(raw);
    if (!incoming) continue;
    const existing = tasks.find((t) => t.id === incoming.id);
    if (!existing) {
      tasks = [...tasks, incoming];
    } else if (incoming.updatedAt > existing.updatedAt) {
      tasks = tasks.map((t) => (t.id === incoming.id ? incoming : t));
    }
  }

/* The tombstones come prefixed from the route, because an event id and a task id
     are both bare strings the device minted and the two stores can hold the same one.
     Ids without a prefix are ignored rather than acted on: a bare id in this list is
     a habit's, and a habit id that happened to match a task id would delete a task the
     user still has. */
  const goneEvents = remote.deleted
    .filter((d): d is string => typeof d === "string" && d.startsWith("event:"))
    .map((d) => d.slice(6));
  const goneTasks = remote.deleted
    .filter((d): d is string => typeof d === "string" && d.startsWith("task:"))
    .map((d) => d.slice(5));
  if (goneEvents.length) {
    const gone = new Set(goneEvents);
    events = events.filter((e) => !gone.has(e.id));
  }
  if (goneTasks.length) {
    const gone = new Set(goneTasks);
    tasks = tasks.filter((t) => !gone.has(t.id));
  }

  if (events === state.events && tasks === state.tasks) return state;
  return { ...state, events, tasks };
}

/* --------------------------------------------------------------------------
 * The payloads.
 * ------------------------------------------------------------------------ */

/** An event as pushed. */
export function eventPayload(e: CalEvent, position: number) {
  return {
    clientId: e.id,
    day: e.date,
    title: e.title,
    startMin: e.startMin,
    durationMin: e.durationMin,
    note: e.note,
    category: e.category,
    updatedAt: e.updatedAt,
    position,
  };
}

/** A task as pushed. Position is the array index, so order survives the trip. */
export function taskPayload(t: Task, position: number) {
  return {
    clientId: t.id,
    day: t.due,
    title: t.title,
    done: t.done,
    note: t.note,
    category: t.category,
    updatedAt: t.updatedAt,
    position,
  };
}

/* --------------------------------------------------------------------------
 * The store's exported callers.
 * ------------------------------------------------------------------------ */

export function addEvent(input: Omit<CalEvent, "id" | "updatedAt">) {
  store.update((s) => putEvent(s, input));
}

export function updateEvent(id: string, patch: Partial<Omit<CalEvent, "id" | "updatedAt">>) {
  store.update((s) => {
    const found = s.events.find((e) => e.id === id);
    if (!found) return s;
    /* Merged onto the row rather than replacing it, because a patch from the
       calendar's editor carries the visible fields and not the ones it never
       shows — the legacy sport flag among them. */
    const { sport, ...rest } = patch;
    return putEvent(s, { ...found, ...rest, sport: sport ?? found.sport, id });
  });
}

export function removeEvent(id: string) {
  store.update((s) => removeEventPure(s, id));
}

export function addTask(title: string, due: string | null, category: TaskCategory = "other") {
  store.update((s) => addTaskPure(s, title, due, category));
}

export function toggleTask(id: string) {
  store.update((s) => toggleTaskPure(s, id));
}

export function removeTask(id: string) {
  store.update((s) => removeTaskPure(s, id));
}

export function clearAll() {
  /* Wiping the plan is a delete of everything in it, and the tombstones are what
     carry that to the server. Dropping them here would mean the other device keeps
     the rows this one just threw away. */
  store.update((s) => ({
    ...EMPTY_TASKS,
    owner: s.owner,
    seeded: true,
    pendingDeletes: {
      events: [...new Set([...s.pendingDeletes.events, ...s.events.map((e) => e.id)])].slice(-MAX_PENDING_DELETES),
      tasks: [...new Set([...s.pendingDeletes.tasks, ...s.tasks.map((t) => t.id)])].slice(-MAX_PENDING_DELETES),
    },
  }));
}

/** Fold in a server pull. */
export function applyRemote(remote: { events: unknown[]; tasks: unknown[]; deleted: string[] }) {
  store.update((s) => mergeRemote(s, remote));
}

/** Drop tombstones a push has confirmed. */
export function acknowledgeDeletes(ids: { events: string[]; tasks: string[] }) {
  store.update((s) => clearPendingDeletes(s, ids));
}

/** The current record, for the sync driver. */
export function currentTasksState(): TasksState {
  return store.getSnapshot();
}
