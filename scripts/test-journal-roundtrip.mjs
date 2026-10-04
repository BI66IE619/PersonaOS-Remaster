/**
 * The journal's half of /api/sync, against a real database.
 *
 * The pure merge is covered in test-journal-sync.mjs. What this covers is what the
 * merge cannot: that a note's tags and a check-in's soreness survive a round trip
 * through the columns added in 0010, that a weigh-in stored as kg comes back as the
 * pound reading that went in, that the (user_id, client_id) index makes a re-push
 * idempotent, and that a tombstone stops a row.
 *
 * Rows are written under a throwaway user id and removed after, so this never
 * touches a real account.
 *
 * Run: node --env-file=.env.local --experimental-strip-types --no-warnings --import ./scripts/ts-alias.mjs scripts/test-journal-roundtrip.mjs
 */
import postgres from "postgres";
import nextEnv from "@next/env";
import { randomUUID } from "node:crypto";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

let failures = 0;
function check(name, condition, detail = "") {
  if (condition) console.log(`  ok    ${name}`);
  else {
    failures++;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const sql = postgres(process.env.DATABASE_URL ?? "", { max: 1 });
const TEST_USER = randomUUID();

const dal = await import("../src/lib/dal.ts");

const DAY = "2026-04-12";
const EARLIER = new Date(Date.now() - 60_000).toISOString();
const LATER = new Date(Date.now() + 60_000).toISOString();

console.log("\njournal round trip: through the database, both directions\n");

await sql`insert into profiles (id, email, display_name) values (${TEST_USER}::uuid, ${`journal-test-${TEST_USER}@example.invalid`}, 'journal test') on conflict do nothing`;

const cleanup = async () => {
  await sql`delete from profiles where id = ${TEST_USER}::uuid`;
  await sql.end({ timeout: 5 }).catch(() => {});
};

try {
  console.log("notes carry their tags");
  await dal.upsertNotes(TEST_USER, [
    { clientId: DAY, day: DAY, text: "first", tags: ["alpha", "beta"], updatedAt: EARLIER },
  ]);
  let notes = await dal.getNotes(TEST_USER);
  check("one row written", notes.length === 1, `${notes.length}`);
  check("the text round-trips", notes[0].text === "first", notes[0].text);
  check(
    "the tags round-trip as an array",
    Array.isArray(notes[0].tags) && notes[0].tags.join(",") === "alpha,beta",
    JSON.stringify(notes[0].tags),
  );

  await dal.upsertNotes(TEST_USER, [
    { clientId: DAY, day: DAY, text: "second", tags: ["gamma"], updatedAt: LATER },
  ]);
  notes = await dal.getNotes(TEST_USER);
  check("a re-push is an upsert, not a duplicate", notes.length === 1, `${notes.length}`);
  check("the newer push won", notes[0].text === "second", notes[0].text);
  check("the tags were replaced with it", JSON.stringify(notes[0].tags) === '["gamma"]');

  await dal.upsertNotes(TEST_USER, [
    { clientId: DAY, day: DAY, text: "stale", tags: [], updatedAt: EARLIER },
  ]);
  check("an older push is rejected", (await dal.getNotes(TEST_USER))[0].text === "second");

  await dal.tombstoneNotes(TEST_USER, [DAY]);
  check("a tombstone hides the note", (await dal.getNotes(TEST_USER)).length === 0);

  console.log("\ncheck-ins carry soreness");
  await dal.upsertCheckins(TEST_USER, [
    { clientId: DAY, day: DAY, text: "", mood: 2, energy: 4, soreness: 5, updatedAt: LATER },
  ]);
  const checkins = await dal.getCheckins(TEST_USER);
  check("one check-in written", checkins.length === 1, `${checkins.length}`);
  check("soreness round-trips", checkins[0].soreness === 5, `${checkins[0].soreness}`);
  check("mood and energy round-trip", checkins[0].mood === 2 && checkins[0].energy === 4);
  await dal.tombstoneCheckins(TEST_USER, [DAY]);
  check("a check-in tombstone hides it", (await dal.getCheckins(TEST_USER)).length === 0);

  console.log("\nweigh-ins store as kg");
  /* 135 lb, the same value the pure test uses. */
  await dal.upsertWeightLog(TEST_USER, [
    { clientId: DAY, day: DAY, kg: 135 / 2.2046226, updatedAt: LATER },
  ]);
  const weights = await dal.getWeightLog(TEST_USER);
  check("one reading written", weights.length === 1, `${weights.length}`);
  const lb = weights[0].kg * 2.2046226;
  check("the kg round-trips to the pound reading", Math.abs(lb - 135) < 0.05, `${lb}`);
  await dal.tombstoneWeightLog(TEST_USER, [DAY]);
  check("a weight tombstone hides it", (await dal.getWeightLog(TEST_USER)).length === 0);

  console.log("\nthe three stores are independent");
  /* The reason the route now namespaces its tombstones: notes, check-ins and
     weights all key by day, so a delete for one must not read as a delete for the
     others. Proven here at the row level.
     
     A fresh day, because the earlier sections left tombstones on DAY and a re-push
     with the same clock would correctly lose to them — which would make this fail
     for a reason that has nothing to do with the isolation being checked. */
  const DAY2 = "2026-04-13";
  await dal.upsertNotes(TEST_USER, [
    { clientId: DAY2, day: DAY2, text: "keep me", tags: [], updatedAt: LATER },
  ]);
  await dal.upsertCheckins(TEST_USER, [
    { clientId: DAY2, day: DAY2, text: "", mood: 1, energy: 1, soreness: 1, updatedAt: LATER },
  ]);
  await dal.tombstoneNotes(TEST_USER, [DAY2]);
  check("tombstoning the note leaves the check-in", (await dal.getCheckins(TEST_USER)).length === 1);
  check("the note itself is gone", (await dal.getNotes(TEST_USER)).length === 0);

  console.log("\nsport sessions round-trip");
  await dal.upsertSportSessions(TEST_USER, [
    {
      clientId: "sport-1",
      day: DAY,
      name: "Soccer",
      kind: "game",
      minutes: 90,
      intensity: 4,
      source: "manual",
      deviceId: null,
      avgHr: null,
      calories: null,
      updatedAt: EARLIER,
    },
  ]);
  let sports = await dal.getSportSessions(TEST_USER);
  check("one session written", sports.length === 1, `${sports.length}`);
  check("the name round-trips", sports[0].name === "Soccer", sports[0].name);
  check(
    "kind, minutes and intensity round-trip",
    sports[0].kind === "game" && sports[0].minutes === 90 && sports[0].intensity === 4,
  );

  await dal.upsertSportSessions(TEST_USER, [
    {
      clientId: "sport-1",
      day: DAY,
      name: "Soccer",
      kind: "practice",
      minutes: 60,
      intensity: 3,
      source: "manual",
      updatedAt: LATER,
    },
  ]);
  sports = await dal.getSportSessions(TEST_USER);
  check("a re-push is an upsert, not a duplicate", sports.length === 1, `${sports.length}`);
  check("the newer push won", sports[0].minutes === 60 && sports[0].kind === "practice");

  await dal.tombstoneSportSessions(TEST_USER, ["sport-1"]);
  check("a tombstone hides the session", (await dal.getSportSessions(TEST_USER)).length === 0);
  const deletedSports = await dal.getDeletedSportSessions(TEST_USER, 100);
  check(
    "the tombstone is offered for the delete list",
    deletedSports.some((r) => r.clientId === "sport-1"),
    JSON.stringify(deletedSports),
  );

  console.log("\nstrength movements and day logs round-trip");
  await dal.upsertStrengthExercises(TEST_USER, [
    {
      clientId: "bench",
      name: "Bench press",
      position: 0,
      usualReps: 12,
      targetSets: 4,
      weightLb: 100,
      updatedAt: EARLIER,
    },
  ]);
  let ex = await dal.getStrengthExercises(TEST_USER);
  check("one movement written", ex.length === 1, `${ex.length}`);
  check("the name round-trips", ex[0].name === "Bench press");
  check(
    "the three numbers round-trip",
    ex[0].usualReps === 12 && ex[0].targetSets === 4 && ex[0].weightLb === 100,
  );
  await dal.upsertStrengthExercises(TEST_USER, [
    {
      clientId: "bench",
      name: "Bench press",
      position: 0,
      usualReps: 10,
      targetSets: 4,
      weightLb: 120,
      updatedAt: LATER,
    },
  ]);
  ex = await dal.getStrengthExercises(TEST_USER);
  check("a re-push is an upsert, not a duplicate", ex.length === 1, `${ex.length}`);
  check("the newer movement won", ex[0].weightLb === 120);

  const logKey = `${DAY}::bench`;
  await dal.upsertStrengthLogs(TEST_USER, [
    {
      clientId: logKey,
      day: DAY,
      exerciseClientId: "bench",
      sets: [
        { reps: 12, weightLb: 120 },
        { reps: 10, weightLb: null },
      ],
      updatedAt: LATER,
    },
  ]);
  const logs = await dal.getStrengthLogs(TEST_USER);
  check("one day log written", logs.length === 1, `${logs.length}`);
  check("the set array round-trips", Array.isArray(logs[0].sets) && logs[0].sets.length === 2);
  check("a bodyweight set keeps its null weight", logs[0].sets[1].weightLb === null);
  check("the exercise client id round-trips", logs[0].exerciseClientId === "bench");

  await dal.tombstoneStrengthLogs(TEST_USER, [logKey]);
  check("a log tombstone hides it", (await dal.getStrengthLogs(TEST_USER)).length === 0);
  check(
    "the log tombstone is offered for the delete list",
    (await dal.getDeletedStrengthLogs(TEST_USER, 100)).some((r) => r.clientId === logKey),
  );
  await dal.tombstoneStrengthExercises(TEST_USER, ["bench"]);
  check("a movement tombstone hides it", (await dal.getStrengthExercises(TEST_USER)).length === 0);
  check(
    "the movement tombstone is offered for the delete list",
    (await dal.getDeletedStrengthExercises(TEST_USER, 100)).some((r) => r.clientId === "bench"),
  );
} finally {
  await cleanup();
}

console.log(`\n${failures === 0 ? "all passed" : `${failures} failed`}`);
if (failures !== 0) throw new Error(`${failures} failed`);
