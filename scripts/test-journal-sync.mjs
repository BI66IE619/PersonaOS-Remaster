/**
 * The journal sync's pure half: the merges, the payloads and the tombstones for
 * notes, check-ins and weigh-ins.
 *
 * No browser and no server. The property worth checking is the one the UI cannot
 * show: that a second device reading the server's answer ends up with the same
 * notes, scales and readings the first device had, that an older edit loses to a
 * newer one, and that a delete on one device does not take a same-day row in a
 * different store with it — the three stores all key a row by its day, so that
 * last one is the failure the prefixes exist to prevent.
 *
 * Run: node --env-file=.env.local --experimental-strip-types --no-warnings --import ./scripts/ts-alias.mjs scripts/test-journal-sync.mjs
 */
import { mergeRemote as mergeNotes, notePayload } from "../src/lib/notes.ts";
import { checkinPayload, mergeRemote as mergeCheckins } from "../src/lib/checkins.ts";
import {
  mergeRemote as mergeWeight,
  weightPayload,
} from "../src/lib/weight-log.ts";
import { mergeRemote as mergeSports, sportPayload } from "../src/lib/sports.ts";
import {
  exercisePayload,
  logPayload,
  mergeRemote as mergeStrength,
} from "../src/lib/strength.ts";
import { logKey } from "../src/lib/types-strength.ts";
import { stampAfter } from "../src/lib/sync-stamp.ts";

let failures = 0;
function check(name, condition, detail = "") {
  if (condition) console.log(`  ok    ${name}`);
  else {
    failures++;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const DAY = "2026-03-04";
const at = (msFromNow) => new Date(Date.now() + msFromNow).toISOString();
const LATER = at(60_000);
const EARLIER = at(-60_000);

const notesState = (entries = [], pendingDeletes = []) => ({
  entries,
  seeded: true,
  owner: "u1",
  pendingDeletes,
});
const checkinsState = (entries = [], pendingDeletes = []) => ({
  entries,
  seeded: true,
  owner: "u1",
  pendingDeletes,
});
const weightState = (logs = {}, stamps = {}, pendingDeletes = []) => ({
  logs,
  stamps,
  owner: "u1",
  pendingDeletes,
});

console.log("the clock never repeats within a row");
check("a first stamp is a real date", !Number.isNaN(Date.parse(stampAfter(undefined))));
const first = at(0);
const bumped = stampAfter(first);
check("a stamp after a known one is strictly newer", Date.parse(bumped) > Date.parse(first));
check("bumping twice stays monotonic", Date.parse(stampAfter(bumped)) > Date.parse(bumped));

console.log("\nnotes merge by day, newest wins");
const base = notesState([
  { date: DAY, note: "local", tags: [], updatedAt: EARLIER },
]);
const newer = mergeNotes(base, {
  notes: [{ day: DAY, text: "remote", tags: [], updatedAt: LATER }],
  deleted: [],
});
check("a newer remote edit wins", newer.entries[0].note === "remote", newer.entries[0].note);
const older = mergeNotes(base, {
  notes: [{ day: DAY, text: "stale", tags: [], updatedAt: EARLIER }],
  deleted: [],
});
check("an older remote edit loses", older.entries[0].note === "local", older.entries[0].note);
check("an older pull is a no-op by reference", older === base);
const added = mergeNotes(notesState(), {
  notes: [{ day: "2026-03-05", text: "new", tags: ["a"], updatedAt: LATER }],
  deleted: [],
});
check("a day the pull introduces is added", added.entries.length === 1);
check("tags survive the trip", added.entries[0].tags[0] === "a");
check(
  "silence is not a delete",
  mergeNotes(base, { notes: [], deleted: [] }).entries.length === 1,
);

console.log("\na note tombstone does not touch other stores");
const withThree = notesState([{ date: DAY, note: "n", tags: [], updatedAt: LATER }]);
const afterDelete = mergeNotes(withThree, { notes: [], deleted: [`note:${DAY}`] });
check("the note is gone", afterDelete.entries.length === 0);
check(
  "a check-in tombstone is ignored by notes",
  mergeNotes(withThree, { notes: [], deleted: [`checkin:${DAY}`] }).entries.length === 1,
);
check(
  "a weight tombstone is ignored by notes",
  mergeNotes(withThree, { notes: [], deleted: [`weight:${DAY}`] }).entries.length === 1,
);
check(
  "a chat tombstone is ignored by notes",
  mergeNotes(withThree, { notes: [], deleted: [`chat:${DAY}`] }).entries.length === 1,
);

console.log("\ncheck-ins merge by day");
const ci = checkinsState([
  { date: DAY, energy: 3, mood: 3, soreness: 3, updatedAt: EARLIER },
]);
const ciNewer = mergeCheckins(ci, {
  checkins: [{ day: DAY, energy: 5, mood: 5, soreness: 1, updatedAt: LATER }],
  deleted: [],
});
check("a newer check-in wins", ciNewer.entries[0].energy === 5);
check(
  "a cleared check-in (all zero) is dropped, not stored",
  mergeCheckins(checkinsState(), {
    checkins: [{ day: DAY, energy: 0, mood: 0, soreness: 0, updatedAt: LATER }],
    deleted: [],
  }).entries.length === 0,
);
check(
  "a check-in tombstone is ignored by notes and weight",
  mergeCheckins(ci, { checkins: [], deleted: [`note:${DAY}`] }).entries.length === 1,
);
const ciDeleted = mergeCheckins(ci, { checkins: [], deleted: [`checkin:${DAY}`] });
check("a check-in tombstone removes the check-in", ciDeleted.entries.length === 0);

console.log("\nweigh-ins survive the pound/kg round trip");
const lb = 135;
const payload = weightPayload(DAY, lb, LATER);
check("the push carries kg, not pounds", Math.abs(payload.kg - 61.23) < 0.02, `${payload.kg}`);
check("the push carries the day as the client id", payload.clientId === DAY);
const pulled = mergeWeight(weightState(), {
  weight: [{ day: DAY, kg: payload.kg, updatedAt: LATER }],
  deleted: [],
});
check("the pulled reading is in pounds again", Math.abs(pulled.logs[DAY] - lb) < 0.05, `${pulled.logs[DAY]}`);
check(
  "a whole-pound reading lands back exactly",
  Math.round(pulled.logs[DAY]) === 135,
  `${pulled.logs[DAY]}`,
);
check("the stamp is kept for conflict resolution", pulled.stamps[DAY] === LATER);

console.log("\nweigh-ins merge by day");
const w = weightState({ [DAY]: 140 }, { [DAY]: EARLIER });
/* 68 kg is ~150 lb — deliberately not near 140, so "the newer reading won" is a
   real assertion rather than a rounding coincidence. */
const wNewer = mergeWeight(w, { weight: [{ day: DAY, kg: 68, updatedAt: LATER }], deleted: [] });
check("a newer reading wins", Math.abs(wNewer.logs[DAY] - 150) < 0.5, `${wNewer.logs[DAY]}`);
check("the old reading is replaced, not duplicated", Object.keys(wNewer.logs).length === 1);
const wOlder = mergeWeight(w, { weight: [{ day: DAY, kg: 68, updatedAt: EARLIER }], deleted: [] });
check("an older reading loses", wOlder.logs[DAY] === 140);
check("an older pull is a no-op by reference", wOlder === w);
const wDeleted = mergeWeight(w, { weight: [], deleted: [`weight:${DAY}`] });
check("a weight tombstone removes the reading", wDeleted.logs[DAY] === undefined);
check(
  "a note tombstone leaves the weight alone",
  mergeWeight(w, { weight: [], deleted: [`note:${DAY}`] }).logs[DAY] === 140,
);

console.log("\npayloads carry the fields the server expects");
const np = notePayload({ date: DAY, note: "x", tags: ["t"], updatedAt: LATER });
check("note payload has clientId and day", np.clientId === DAY && np.day === DAY);
check("note payload sends text", np.text === "x");
const cp = checkinPayload({ date: DAY, energy: 4, mood: 2, soreness: 5, updatedAt: LATER });
check("checkin payload sends the three scales", cp.energy === 4 && cp.mood === 2 && cp.soreness === 5);
check("checkin payload sends blank text", cp.text === "");
check("checkin payload nulls an unrated scale", checkinPayload({ date: DAY, energy: 0, mood: 0, soreness: 0, updatedAt: LATER }).energy === null);

console.log("\nsport sessions merge by id, manual only in the payload");
const sportsState = (sessions = [], pendingDeletes = []) => ({
  sessions,
  dismissed: [],
  hiddenDevice: [],
  owner: "u1",
  pendingDeletes,
});
const manual = {
  id: "s1",
  date: DAY,
  sport: "Soccer",
  kind: "game",
  minutes: 90,
  intensity: 4,
  source: "manual",
  updatedAt: EARLIER,
};
const sp = mergeSports(sportsState([manual]), {
  sports: [
    {
      clientId: "s1",
      day: DAY,
      name: "Soccer",
      kind: "practice",
      minutes: 60,
      intensity: 3,
      source: "manual",
      updatedAt: LATER,
    },
  ],
  deleted: [],
});
check("a newer remote session wins", sp.sessions[0].minutes === 60, `${sp.sessions[0].minutes}`);
const spBase = sportsState([manual]);
const spOld = mergeSports(spBase, {
  sports: [
    { clientId: "s1", day: DAY, name: "Soccer", minutes: 60, updatedAt: EARLIER },
  ],
  deleted: [],
});
check("an older remote session loses", spOld.sessions[0].minutes === 90);
check("an older pull is a no-op by reference", spOld === spBase);
const spAdded = mergeSports(sportsState(), {
  sports: [
    { clientId: "s2", day: DAY, name: "Running", minutes: 30, intensity: 2, updatedAt: LATER },
  ],
  deleted: [],
});
check("a new session is added", spAdded.sessions.length === 1);
const spDeleted = mergeSports(sportsState([manual]), {
  sports: [],
  deleted: [`sport:s1`],
});
check("a sport tombstone removes the session", spDeleted.sessions.length === 0);
check(
  "a note tombstone leaves the sport session alone",
  mergeSports(sportsState([manual]), { sports: [], deleted: [`note:${DAY}`] }).sessions.length === 1,
);

const payloadManual = sportPayload(manual);
check("the push carries clientId and day", payloadManual.clientId === "s1" && payloadManual.day === DAY);
check("the push names the sport", payloadManual.name === "Soccer");
check("the push carries kind, minutes and intensity", payloadManual.kind === "game" && payloadManual.minutes === 90 && payloadManual.intensity === 4);
check("the push marks it manual", payloadManual.source === "manual");
const device = { ...manual, id: "dev-1", source: "device", deviceId: "hc-1" };
check("a device session keeps its provider id in the payload", sportPayload(device).deviceId === "hc-1");

console.log("\nstrength movements and day logs merge by id");
const strengthState = (exercises = [], days = {}, logStamps = {}, pendingDeletes = { exercises: [], logs: [] }) => ({
  exercises,
  days,
  logStamps,
  owner: "u1",
  pendingDeletes,
});
const bench = { id: "bench", name: "Bench press", usualReps: 12, targetSets: 4, weightLb: 100, updatedAt: EARLIER };
const K = logKey(DAY, "bench");
const stBase = strengthState([bench], { [DAY]: { bench: [{ reps: 12, weightLb: 100 }] } }, { [K]: EARLIER });

const stNewer = mergeStrength(stBase, {
  exercises: [{ clientId: "bench", name: "Bench press", usualReps: 10, targetSets: 4, weightLb: 120, updatedAt: LATER }],
  logs: [],
  deleted: [],
});
check("a newer movement wins", stNewer.exercises[0].weightLb === 120, `${stNewer.exercises[0].weightLb}`);
const stOlder = mergeStrength(stBase, {
  exercises: [{ clientId: "bench", name: "Bench press", usualReps: 10, targetSets: 4, weightLb: 120, updatedAt: EARLIER }],
  logs: [],
  deleted: [],
});
check("an older movement loses", stOlder.exercises[0].weightLb === 100);
check("an older movement pull is a no-op by reference", stOlder === stBase);

const stLogNewer = mergeStrength(stBase, {
  exercises: [],
  logs: [{ clientId: K, day: DAY, exerciseClientId: "bench", sets: [{ reps: 8, weightLb: 110 }], updatedAt: LATER }],
  deleted: [],
});
check("a newer day log replaces the whole set array", stLogNewer.days[DAY].bench.length === 1 && stLogNewer.days[DAY].bench[0].reps === 8);
const stLogOlder = mergeStrength(stBase, {
  exercises: [],
  logs: [{ clientId: K, day: DAY, exerciseClientId: "bench", sets: [{ reps: 1, weightLb: 1 }], updatedAt: EARLIER }],
  deleted: [],
});
check("an older day log loses", stLogOlder.days[DAY].bench[0].reps === 12);
check("an older log pull is a no-op by reference", stLogOlder === stBase);

const stExDeleted = mergeStrength(stBase, { exercises: [], logs: [], deleted: ["strengthExercise:bench"] });
check("a movement tombstone removes it", stExDeleted.exercises.length === 0);
const stLogDeleted = mergeStrength(stBase, { exercises: [], logs: [], deleted: [`strengthLog:${K}`] });
check("a log tombstone removes that day's sets", stLogDeleted.days[DAY]?.bench === undefined);
check(
  "a note tombstone leaves strength alone",
  mergeStrength(stBase, { exercises: [], logs: [], deleted: [`note:${DAY}`] }).days[DAY].bench.length === 1,
);

const exPayload = exercisePayload(bench, 2);
check("the movement payload carries clientId and position", exPayload.clientId === "bench" && exPayload.position === 2);
check("the movement payload carries the three numbers", exPayload.usualReps === 12 && exPayload.targetSets === 4 && exPayload.weightLb === 100);
const logP = logPayload(DAY, "bench", [{ reps: 10, weightLb: null }], LATER);
check("the log payload keys day and exercise", logP.clientId === K && logP.day === DAY && logP.exerciseClientId === "bench");
check("the log payload carries the set array", logP.sets.length === 1 && logP.sets[0].reps === 10);

console.log(`\n${failures === 0 ? "all passed" : `${failures} failed`}`);
if (failures !== 0) throw new Error(`${failures} failed`);
