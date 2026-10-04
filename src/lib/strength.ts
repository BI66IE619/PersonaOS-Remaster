import { createStore } from "./create-store";
import { addDays } from "./dates";
import { MAX_PENDING_DELETES, reviveIds, stampAfter } from "./sync-stamp";
import {
  logKey,
  type Exercise,
  type StrengthDays,
  type StrengthSet,
  type StrengthState,
} from "./types-strength";

const KEY = "personaos:strength";

export type { Exercise, StrengthSet, StrengthState };

export const EMPTY_STATE: StrengthState = {
  exercises: [],
  days: {},
  logStamps: {},
  owner: null,
  pendingDeletes: { exercises: [], logs: [] },
};

/** Sets a movement is worked to when nothing says otherwise. */
export const DEFAULT_SETS = 4;

/**
 * The programme this logger is built around. `usual` is not a target to hit, it
 * is the number new sets start on, so logging a set you have done before is one
 * tap and a weight rather than three fields. Bench compounds low, curls sit in
 * the middle, and the overhead extension is the one that runs high.
 */
const PROGRAM: { id: string; name: string; usual: number; sets: number }[] = [
  { id: "bench-press", name: "Bench press", usual: 12, sets: DEFAULT_SETS },
  { id: "bicep-curls", name: "Bicep curls", usual: 16, sets: DEFAULT_SETS },
  {
    id: "overhead-db-tricep-extension",
    name: "Overhead dumbbell tricep extension",
    usual: 22,
    sets: DEFAULT_SETS,
  },
];

function programFor(name: string) {
  return PROGRAM.find((p) => p.name.toLowerCase() === name.toLowerCase());
}

/**
 * The weight each movement was last loaded to, newest date winning.
 *
 * weightLb moved from the set to the movement, so existing logs have no standing
 * weight on them. Backfilling from the most recent set actually lifted keeps the
 * user's real number instead of dropping them back to bodyweight, which would
 * quietly rewrite history the first time they logged a set after the update.
 */
function lastLifted(days: StrengthDays): Map<string, number> {
  const latest = new Map<string, number>();
  for (const date of Object.keys(days).sort()) {
    for (const [id, sets] of Object.entries(days[date] ?? {})) {
      const weight = sets[sets.length - 1]?.weightLb;
      if (typeof weight === "number" && weight > 0) latest.set(id, weight);
    }
  }
  return latest;
}

const isStr = (v: unknown): v is string => typeof v === "string";

function revive(raw: unknown): StrengthState {
  if (!raw || typeof raw !== "object") return EMPTY_STATE;
  const parsed = raw as Partial<StrengthState>;
  if (!Array.isArray(parsed.exercises)) return EMPTY_STATE;
  const days =
    parsed.days && typeof parsed.days === "object" ? (parsed.days as StrengthDays) : {};
  const lifted = lastLifted(days);

  /* The log clocks. Read back rather than recomputed: a log saved before the
     clock existed reads as long ago, so its first push loses to anything the
     server already knows. */
  const logStamps: Record<string, string> = {};
  if (parsed.logStamps && typeof parsed.logStamps === "object") {
    for (const [k, v] of Object.entries(parsed.logStamps)) {
      if (isStr(v)) logStamps[k] = v;
    }
  }
  for (const date of Object.keys(days)) {
    for (const id of Object.keys(days[date] ?? {})) {
      const k = logKey(date, id);
      if (!logStamps[k]) logStamps[k] = new Date(0).toISOString();
    }
  }

  const pd = (parsed.pendingDeletes ?? {}) as Record<string, unknown>;

  return {
    seeded: parsed.seeded === true,
    exercises: parsed.exercises
      .filter((e) => e && typeof e.id === "string" && e.name)
      .map((e) => ({
        ...e,
        usualReps: Number.isFinite(e.usualReps) ? e.usualReps : 0,
        /* Written before targetSets existed, so the target is backfilled from
           the programme. Movements you added yourself stay free-form with no
           target, so adding one never quietly extends the day's workout. */
        targetSets: Number.isFinite(e.targetSets) ? e.targetSets : (programFor(e.name)?.sets ?? 0),
        weightLb: Number.isFinite(e.weightLb) ? e.weightLb : (lifted.get(e.id) ?? 0),
        updatedAt: isStr(e.updatedAt) ? e.updatedAt : new Date(0).toISOString(),
      })),
    days,
    logStamps,
    owner: isStr(parsed.owner) && parsed.owner ? parsed.owner : null,
    pendingDeletes: {
      exercises: reviveIds(pd.exercises),
      logs: reviveIds(pd.logs),
    },
  };
}

const store = createStore<StrengthState>(KEY, EMPTY_STATE, revive);

const SERVER_STATE: StrengthState = { ...EMPTY_STATE, seeded: true };

export const getSnapshot = store.getSnapshot;
export const subscribe = store.subscribe;

/** Stable identity matters: useSyncExternalStore compares snapshots by reference. */
export const getServerSnapshot = (): StrengthState => SERVER_STATE;

/** Adopt an unowned record on first claim, clear a different account's. */
export function claimStrengthOwnership(userId: string): StrengthState {
  const s = store.getSnapshot();
  if (s.owner === userId) return s;
  if (s.owner === null) {
    const adopted = { ...s, owner: userId };
    store.set(adopted);
    return adopted;
  }
  store.set({ ...EMPTY_STATE, owner: userId });
  return store.getSnapshot();
}

/**
 * First run installs the three movements so the panel is usable straight away.
 * Matched by name, not id: anyone who already added "bench press" by hand keeps
 * that entry and its logged history, and only picks up the usual rep count.
 */
function seed(state: StrengthState): StrengthState {
  if (state.seeded) return state;

  const stamp = new Date().toISOString();
  const byName = new Map(state.exercises.map((e) => [e.name.toLowerCase(), e]));
  const filled = state.exercises.map((e) => {
    const known = programFor(e.name);
    return {
      ...e,
      usualReps: e.usualReps > 0 ? e.usualReps : (known?.usual ?? 0),
      targetSets: e.targetSets > 0 ? e.targetSets : (known?.sets ?? 0),
    };
  });

  const added = PROGRAM.filter((p) => !byName.has(p.name.toLowerCase())).map((p) => ({
    id: p.id,
    name: p.name,
    usualReps: p.usual,
    targetSets: p.sets,
    /* No weight yet: a swipe logs bodyweight until the user sets one in Adjust,
       which is the honest default rather than a made-up number. */
    weightLb: 0,
    updatedAt: stamp,
  }));

  return { ...state, seeded: true, exercises: [...filled, ...added] };
}

export function seedStrength() {
  /* Unconditional, unlike the sample tasks and habits: this is not placeholder
     content to throw away, it is the programme the logger is built around. A
     signed-in user should still find their three movements there, and pushing
     the definitions to their account is harmless — they carry no logged sets. */
  const current = store.getSnapshot();
  const next = seed(current);
  if (next !== current) store.set(next);
}

function uid() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `e${Date.now().toString(36)}`;
}

/** Apply a change to one movement and move its clock. */
function updateExercise(state: StrengthState, id: string, patch: Partial<Exercise>): StrengthState {
  const found = state.exercises.find((e) => e.id === id);
  if (!found) return state;
  return {
    ...state,
    exercises: state.exercises.map((e) =>
      e.id === id ? { ...e, ...patch, updatedAt: stampAfter(found.updatedAt) } : e,
    ),
  };
}

export function addExercise(name: string) {
  const trimmed = name.trim();
  if (!trimmed) return;
  store.update((s) => {
    if (s.exercises.some((e) => e.name.toLowerCase() === trimmed.toLowerCase())) return s;
    /* Re-adding a programme movement you deleted restores its usual rep count
       rather than coming back as a blank slate. */
    const known = programFor(trimmed);
    return {
      ...s,
      exercises: [
        ...s.exercises,
        {
          id: known?.id ?? uid(),
          name: trimmed,
          usualReps: known?.usual ?? 0,
          /* A movement you invent is a free extra until you give it a target. */
          targetSets: known?.sets ?? 0,
          weightLb: 0,
          updatedAt: stampAfter(undefined),
        },
      ],
    };
  });
}

export function setUsualReps(exerciseId: string, reps: number) {
  store.update((s) => updateExercise(s, exerciseId, { usualReps: Math.max(0, Math.round(reps) || 0) }));
}

/** 0 takes a movement out of the day's workout without deleting its history. */
export function setTargetSets(exerciseId: string, sets: number) {
  store.update((s) => updateExercise(s, exerciseId, { targetSets: Math.max(0, Math.round(sets) || 0) }));
}

/**
 * The weight a movement is loaded to, and where a swipe takes it from. Sets
 * already logged keep the weight they were done at, so history still shows what
 * was lifted on the day rather than today's number.
 */
export function setWeight(exerciseId: string, weightLb: number) {
  store.update((s) => updateExercise(s, exerciseId, { weightLb: Math.max(0, Number(weightLb) || 0) }));
}

function omitKey<T extends object>(obj: T, key: string): T {
  const copy = { ...obj } as Record<string, unknown>;
  delete copy[key];
  return copy as T;
}

export function removeExercise(id: string) {
  store.update((s) => {
    const days: StrengthDays = {};
    const logStamps = { ...s.logStamps };
    const goneLogs: string[] = [];
    for (const [date, byEx] of Object.entries(s.days)) {
      if (byEx[id]) {
        goneLogs.push(logKey(date, id));
        delete logStamps[logKey(date, id)];
      }
      const rest = omitKey(byEx, id);
      if (Object.keys(rest).length) days[date] = rest;
    }
    return {
      ...s,
      exercises: s.exercises.filter((e) => e.id !== id),
      days,
      logStamps,
      /* The movement's day logs are deleted with it — half a movement is not a
         state the other device should have to reconcile. */
      pendingDeletes: {
        exercises: [...new Set([...s.pendingDeletes.exercises, id])].slice(-MAX_PENDING_DELETES),
        logs: [...new Set([...s.pendingDeletes.logs, ...goneLogs])].slice(-MAX_PENDING_DELETES),
      },
    };
  });
}

/**
 * Write a day/movement log. The whole set array is the unit of change, so it
 * carries one clock: an empty array is a delete, and a write clears any pending
 * delete for the same key so a re-added set is not pushed then removed.
 */
function withSets(
  date: string,
  exerciseId: string,
  update: (sets: StrengthSet[]) => StrengthSet[],
) {
  store.update((s) => {
    const key = logKey(date, exerciseId);
    const forDay = s.days[date] ?? {};
    const had = (forDay[exerciseId]?.length ?? 0) > 0;
    const next = update(forDay[exerciseId] ?? []);
    const days = { ...s.days };
    const logStamps = { ...s.logStamps };
    let logs = s.pendingDeletes.logs;

    if (next.length) {
      days[date] = { ...forDay, [exerciseId]: next };
      logStamps[key] = stampAfter(s.logStamps[key]);
      logs = logs.filter((x) => x !== key);
    } else {
      const rest = omitKey(forDay, exerciseId);
      if (Object.keys(rest).length) days[date] = rest;
      else delete days[date];
      delete logStamps[key];
      if (had) logs = [...new Set([...logs, key])].slice(-MAX_PENDING_DELETES);
    }

    return { ...s, days, logStamps, pendingDeletes: { ...s.pendingDeletes, logs } };
  });
}

export function addSet(date: string, exerciseId: string) {
  withSets(date, exerciseId, (sets) => {
    /* Seed the new set from the last one logged so adding a set is one gesture,
       and from the movement's usual count when this is the first set of the day.
       Weight comes from the movement, because that is the one number the user
       sets and then leaves alone — a swipe has nowhere to ask for it. */
    const previous = sets[sets.length - 1];
    const exercise = store.getSnapshot().exercises.find((e) => e.id === exerciseId);
    const usual = exercise?.usualReps ?? 0;
    return [
      ...sets,
      {
        reps: previous?.reps ?? (usual > 0 ? usual : 8),
        weightLb: exercise && exercise.weightLb > 0 ? exercise.weightLb : (previous?.weightLb ?? null),
      },
    ];
  });
}

export function updateSet(
  date: string,
  exerciseId: string,
  index: number,
  patch: Partial<StrengthSet>,
) {
  withSets(date, exerciseId, (sets) => sets.map((set, i) => (i === index ? { ...set, ...patch } : set)));
}

export function removeSet(date: string, exerciseId: string, index: number) {
  withSets(date, exerciseId, (sets) => sets.filter((_, i) => i !== index));
}

export function totalReps(sets: StrengthSet[]) {
  return sets.reduce((n, set) => n + (Number.isFinite(set.reps) ? set.reps : 0), 0);
}

export type SessionProgress = { done: number; total: number; complete: boolean };

/**
 * Whether the day's workout is done, worked out from the sets actually logged
 * rather than from a stored flag. Deriving it is what lets the habit on Home
 * stay honest: delete a set and the workout un-completes itself, because there
 * is no separate "I did it" bit to fall out of step with the log.
 *
 * Movements with no set target are free-form extras and are left out of the
 * count entirely rather than being treated as either met or missed.
 */
export function sessionProgress(state: StrengthState, date: string): SessionProgress {
  const targeted = state.exercises.filter((e) => e.targetSets > 0);
  if (!targeted.length) return { done: 0, total: 0, complete: false };

  const byExercise = state.days[date] ?? {};
  const done = targeted.filter((e) => (byExercise[e.id]?.length ?? 0) >= e.targetSets).length;
  return { done, total: targeted.length, complete: done === targeted.length };
}

export function sessionComplete(state: StrengthState, date: string) {
  return sessionProgress(state, date).complete;
}

/** Every day on which the workout was worked to its targets, newest last, so it
 *  can be handed straight to currentStreak like any other habit history. */
export function completedDays(state: StrengthState): string[] {
  return Object.keys(state.days)
    .filter((d) => sessionProgress(state, d).complete)
    .sort();
}

/**
 * Consecutive finished days, counting back from today.
 *
 * Today not being finished yet does not break the streak — it is not over, and
 * treating an unfinished today as a miss would reset the count every morning and
 * make the number useless for the rest of the day. The run therefore walks back
 * from today, skipping today if it is not done, and stops at the first gap.
 */
export function liftingStreak(state: StrengthState, today: string): number {
  let cursor = today;
  if (!sessionProgress(state, cursor).complete) cursor = addDays(cursor, -1);
  let streak = 0;
  while (sessionProgress(state, cursor).complete) {
    streak++;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

/* --------------------------------------------------------------------------
 * The sync half.
 * ------------------------------------------------------------------------ */

/** A movement as it arrives from the server. Untrusted. */
function reviveRemoteExercise(raw: unknown): Exercise | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (!isStr(o.clientId) || !isStr(o.name) || !o.name.trim()) return null;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  return {
    id: o.clientId,
    name: o.name.slice(0, 120),
    usualReps: Math.max(0, Math.round(num(o.usualReps))),
    targetSets: Math.max(0, Math.round(num(o.targetSets))),
    weightLb: Math.max(0, num(o.weightLb)),
    updatedAt: isStr(o.updatedAt) ? o.updatedAt : new Date(0).toISOString(),
  };
}

/** A day/movement log as it arrives. The set array is validated element by element. */
function reviveRemoteLog(raw: unknown): { key: string; date: string; exerciseId: string; sets: StrengthSet[]; updatedAt: string } | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (!isStr(o.clientId) || !isStr(o.day) || !isStr(o.exerciseClientId)) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(o.day)) return null;
  const sets: StrengthSet[] = Array.isArray(o.sets)
    ? o.sets.flatMap((s): StrengthSet[] => {
        if (!s || typeof s !== "object") return [];
        const c = s as Record<string, unknown>;
        const reps = typeof c.reps === "number" && Number.isFinite(c.reps) ? Math.max(0, Math.round(c.reps)) : 0;
        const weightLb =
          typeof c.weightLb === "number" && Number.isFinite(c.weightLb) ? Math.max(0, c.weightLb) : null;
        return [{ reps, weightLb }];
      })
    : [];
  if (sets.length === 0) return null;
  return {
    key: o.clientId,
    date: o.day,
    exerciseId: o.exerciseClientId,
    sets,
    updatedAt: isStr(o.updatedAt) ? o.updatedAt : new Date(0).toISOString(),
  };
}

/** Last-write-wins per movement and per day/movement log. */
export function mergeRemote(
  state: StrengthState,
  remote: { exercises: unknown[]; logs: unknown[]; deleted: string[] },
): StrengthState {
  let exercises = state.exercises;
  for (const raw of remote.exercises) {
    const incoming = reviveRemoteExercise(raw);
    if (!incoming) continue;
    const existing = exercises.find((e) => e.id === incoming.id);
    if (!existing) exercises = [...exercises, incoming];
    else if (incoming.updatedAt > existing.updatedAt) {
      exercises = exercises.map((e) => (e.id === incoming.id ? incoming : e));
    }
  }

  let days = state.days;
  const logStamps = { ...state.logStamps };
  for (const raw of remote.logs) {
    const incoming = reviveRemoteLog(raw);
    if (!incoming) continue;
    const existingStamp = logStamps[incoming.key];
    if (existingStamp !== undefined && !(incoming.updatedAt > existingStamp)) continue;
    days = { ...days, [incoming.date]: { ...(days[incoming.date] ?? {}), [incoming.exerciseId]: incoming.sets } };
    logStamps[incoming.key] = incoming.updatedAt;
  }

  /* Deletes carry the store, because an exercise id and a log id are both bare
     strings the device minted. */
  const goneExercises = new Set(
    remote.deleted
      .filter((d): d is string => typeof d === "string" && d.startsWith("strengthExercise:"))
      .map((d) => d.slice("strengthExercise:".length)),
  );
  if (goneExercises.size) {
    exercises = exercises.filter((e) => !goneExercises.has(e.id));
  }
  const goneLogs = new Set(
    remote.deleted
      .filter((d): d is string => typeof d === "string" && d.startsWith("strengthLog:"))
      .map((d) => d.slice("strengthLog:".length)),
  );
  if (goneLogs.size) {
    for (const key of goneLogs) {
      const [date, exerciseId] = key.split("::");
      if (!date || !exerciseId || !days[date]?.[exerciseId]) continue;
      const rest = omitKey(days[date], exerciseId);
      days = { ...days };
      if (Object.keys(rest).length) days[date] = rest;
      else delete days[date];
      delete logStamps[key];
    }
  }

  if (exercises === state.exercises && days === state.days) return state;
  return { ...state, exercises, days, logStamps };
}

/** A movement as pushed. Position is the array index, so order survives. */
export function exercisePayload(e: Exercise, position: number) {
  return {
    clientId: e.id,
    name: e.name,
    position,
    usualReps: e.usualReps,
    targetSets: e.targetSets,
    weightLb: e.weightLb,
    updatedAt: e.updatedAt,
  };
}

/** A day/movement log as pushed. */
export function logPayload(date: string, exerciseId: string, sets: StrengthSet[], updatedAt: string) {
  return {
    clientId: logKey(date, exerciseId),
    day: date,
    exerciseClientId: exerciseId,
    sets,
    updatedAt,
  };
}

export function applyRemote(remote: { exercises: unknown[]; logs: unknown[]; deleted: string[] }) {
  store.update((s) => mergeRemote(s, remote));
}

export function acknowledgeDeletes(ids: { exercises: string[]; logs: string[] }) {
  if (ids.exercises.length === 0 && ids.logs.length === 0) return;
  const ge = new Set(ids.exercises);
  const gl = new Set(ids.logs);
  store.update((s) => ({
    ...s,
    pendingDeletes: {
      exercises: s.pendingDeletes.exercises.filter((x) => !ge.has(x)),
      logs: s.pendingDeletes.logs.filter((x) => !gl.has(x)),
    },
  }));
}

export function currentStrengthState(): StrengthState {
  return store.getSnapshot();
}
