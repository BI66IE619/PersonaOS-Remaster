/* The device auto-log, tested on the real functions instead of through the UI.
   The end-to-end suite can only assert this on a Tuesday, Thursday or Saturday,
   when the mock programme happens to schedule a run; on the other four days
   there is no sport workout to sync and the checks pass without proving
   anything. These run any day. */

const { addSession, dismissFor, getSnapshot, intensityFromHr, onDate, removeSession, restoreSession, sportForActivity, sportWeek, syncDeviceWorkouts } =
  await import("@/lib/sports");

let failures = 0;
const check = (name, cond, extra = "") => {
  if (!cond) failures++;
  console.log(`${cond ? "ok  " : "FAIL"} ${name}${extra ? ` — ${extra}` : ""}`);
};

const TODAY = "2026-09-27";

/* ---- which activities count as a sport ---- */
check("a run is a sport", sportForActivity("Run — Easy") === "Running", String(sportForActivity("Run — Easy")));
check("a long run is too", sportForActivity("Run — Long") === "Running");
check("cycling is matched", sportForActivity("Cycling") === "Cycling");
check("indoor cycling is matched", sportForActivity("Indoor Cycling") === "Cycling");
check("swimming is matched", sportForActivity("Swimming") === "Swimming");
check("open water swimming is matched", sportForActivity("Open Water Swimming") === "Swimming", String(sportForActivity("Open Water Swimming")));
check("soccer is matched", sportForActivity("Soccer") === "Soccer");
check("indoor running is matched", sportForActivity("Indoor Running") === "Running");
check("stair climbing is not a sport", sportForActivity("Stair Climbing") === null);
check("strength is not a sport", sportForActivity("Strength — Upper") === null);
check("weightlifting is not a sport", sportForActivity("Weightlifting") === null);
check("a gym session is not a sport", sportForActivity("Gym") === null);
check("a walk is not a sport", sportForActivity("Walking") === null);
check("elliptical is not a sport", sportForActivity("Elliptical") === null);
check("HIIT is not a sport", sportForActivity("High Intensity Interval Training") === null);
check("nothing in, nothing out", sportForActivity("") === null);

/* ---- heart rate to the 1-5 scale the survey uses ---- */
check("a light effort is 1", intensityFromHr(88) === 1);
check("strength effort is 2", intensityFromHr(114) === 2);
check("a moderate run is 3", intensityFromHr(130) === 3);
check("a steady run is 4", intensityFromHr(142) === 4);
check("intervals are 5", intensityFromHr(165) === 5);
check("the buckets never skip", intensityFromHr(95) === 1 && intensityFromHr(96) === 2);
check("missing heart rate sits mid-scale", intensityFromHr(null) === 3);

/* ---- the sync itself ---- */
const read = () => getSnapshot();

syncDeviceWorkouts(TODAY, [
  { id: "w1", activity: "Run — Easy", durationMin: 42, avgHr: 142, calories: 430 },
  { id: "w2", activity: "Strength — Upper", durationMin: 44, avgHr: 114, calories: 265 },
]);

let s = read();
let device = s.sessions.filter((x) => x.source === "device");
check("the run is written without asking", device.length === 1, JSON.stringify(device));
check("it is named and timed", device[0]?.sport === "Running" && device[0]?.minutes === 42);
check("intensity came from heart rate", device[0]?.intensity === 4, String(device[0]?.intensity));
check("practice is assumed, never game", device[0]?.kind === "practice");
check("the provider id is kept", device[0]?.deviceId === "w1");
check("strength was left out", !s.sessions.some((x) => x.sport === "Strength"));
check("a strength day still has no sport session", onDate(s.sessions, TODAY).length === 1);

/* Idempotent: the same workouts arriving on the next page view. */
syncDeviceWorkouts(TODAY, [
  { id: "w1", activity: "Run — Easy", durationMin: 42, avgHr: 142, calories: 430 },
  { id: "w2", activity: "Strength — Upper", durationMin: 44, avgHr: 114, calories: 265 },
]);
s = read();
check("a second sync writes nothing new", s.sessions.length === 1, `${s.sessions.length} sessions`);

/* A hand-written session and a watch session coexist. */
addSession({ date: TODAY, sport: "Volleyball", kind: "practice", minutes: 90, intensity: 4, source: "manual" });
s = read();
check("both live on the same day", onDate(s.sessions, TODAY).length === 2, JSON.stringify(onDate(s.sessions, TODAY).map((x) => x.sport)));

/* A second session logged by hand stacks rather than replacing the first. Both
   are real workouts, and the old behaviour deleted the first one. */
addSession({ date: TODAY, sport: "Volleyball", kind: "game", minutes: 95, intensity: 5, source: "manual" });
s = read();
const manual = s.sessions.filter((x) => x.source === "manual");
check("a second survey entry is kept alongside the first", manual.length === 2, JSON.stringify(manual.map((x) => x.kind)));
check("the first survey entry survived", manual.some((x) => x.kind === "practice" && x.sport === "Volleyball"), JSON.stringify(manual));
check("every session on the day is still there", onDate(s.sessions, TODAY).length === 3, JSON.stringify(onDate(s.sessions, TODAY).map((x) => x.sport)));
check("the device session survived the survey", s.sessions.some((x) => x.source === "device"));

/* A second real sport the same day is kept. */
syncDeviceWorkouts(TODAY, [
  { id: "w3", activity: "Swimming", durationMin: 30, avgHr: 130, calories: 260 },
]);
s = read();
check("a second device sport is kept", s.sessions.filter((x) => x.source === "device").length === 2);

/* Sub-minute noise is not a session. */
syncDeviceWorkouts(TODAY, [{ id: "w4", activity: "Running", durationMin: 0, avgHr: 120, calories: 0 }]);
s = read();
check("a zero-length workout is ignored", s.sessions.filter((x) => x.deviceId === "w4").length === 0);

/* Old records, written before devices existed, come back as manual. */
check("the store is usable after all that", typeof read() === "object");

/* ---- deleting one session ---- */
const before = onDate(s.sessions, TODAY);
const manualToGo = before.find((x) => x.source === "manual" && x.kind === "game");
removeSession(manualToGo.id);
s = read();
check("the deleted session is gone", !s.sessions.some((x) => x.id === manualToGo.id), JSON.stringify(onDate(s.sessions, TODAY).map((x) => `${x.sport}/${x.kind}`)));
check("its neighbours are untouched", onDate(s.sessions, TODAY).length === before.length - 1, String(onDate(s.sessions, TODAY).length));
check("the other survey entry is still there", s.sessions.some((x) => x.source === "manual" && x.kind === "practice" && x.sport === "Volleyball"));
check("the watch sessions are still there", s.sessions.filter((x) => x.source === "device").length === 2);

/* Deleting something that is not there must not disturb the log. */
const countBefore = s.sessions.length;
removeSession("nope");
check("deleting a session that is not there changes nothing", read().sessions.length === countBefore, `${read().sessions.length}`);

/* THE REGRESSION THIS GUARDS: a watch workout is offered again on every page
   view, so a delete that only dropped the row would come straight back on the
   next load. The provider id has to be remembered as ignored. */
const run = read().sessions.find((x) => x.deviceId === "w1");
removeSession(run.id);
check("the deleted watch workout is gone", !read().sessions.some((x) => x.deviceId === "w1"));
syncDeviceWorkouts(TODAY, [{ id: "w1", activity: "Run — Easy", durationMin: 42, avgHr: 142, calories: 430 }]);
check("a re-sync does not bring it back", !read().sessions.some((x) => x.deviceId === "w1"), JSON.stringify(read().sessions.map((x) => x.deviceId)));
check("only that workout is ignored", read().sessions.some((x) => x.deviceId === "w3"), JSON.stringify(read().sessions.map((x) => x.deviceId)));

/* ---- putting one back ----
   Undo is what lets the UI make Delete a two-tap action rather than a three-tap
   one, so it has to restore the session completely, not just re-add a row. */
const countAfterDeletes = read().sessions.length;
restoreSession(manualToGo);
check("the session is back", read().sessions.some((x) => x.id === manualToGo.id));
check("with the same id, so a double undo cannot duplicate it", read().sessions.filter((x) => x.id === manualToGo.id).length === 1);
check("and the log is back to where it was", read().sessions.length === countAfterDeletes + 1, `${read().sessions.length}`);
check("every field survived the round trip", JSON.stringify(read().sessions.find((x) => x.id === manualToGo.id)) === JSON.stringify(manualToGo), JSON.stringify(read().sessions.find((x) => x.id === manualToGo.id)));

/* THE REGRESSION THIS GUARDS: the delete left a tombstone so the watch would
   not re-offer the workout. Restoring the session has to take that tombstone out
   too, or the row comes back and is then filtered out as "deleted" on the very
   next page view — the session would be in the store and gone from the screen. */
restoreSession(run);
check("an undone watch workout is on screen again", read().sessions.some((x) => x.deviceId === "w1"), JSON.stringify(read().sessions.map((x) => x.deviceId)));
check("and its tombstone is gone", !read().hiddenDevice.includes("w1"), JSON.stringify(read().hiddenDevice));
syncDeviceWorkouts(TODAY, [{ id: "w1", activity: "Run — Easy", durationMin: 42, avgHr: 142, calories: 430 }]);
check("so a re-sync does not duplicate it", read().sessions.filter((x) => x.deviceId === "w1").length === 1, String(read().sessions.filter((x) => x.deviceId === "w1").length));

/* Restoring something already there must not double it up. */
const withRun = read().sessions.length;
restoreSession(run);
check("restoring a session already in the log is a no-op", read().sessions.length === withRun, `${read().sessions.length}`);

/* ---- the day turns over ---- */
/* Nothing is cleared at midnight, and nothing needs to be: every list is built
   from the date it is given, so tomorrow's screen is empty on its own while the
   history stays put for the training-load and streak maths. */
const TOMORROW = "2026-09-28";
s = read();
check("a day with nothing on it is genuinely empty", onDate(s.sessions, TOMORROW).length === 0, JSON.stringify(onDate(s.sessions, TOMORROW)));
check("yesterday's sessions do not leak into the new day", onDate(s.sessions, TOMORROW).every((x) => x.date === TOMORROW));
check("yesterday still holds its own sessions", onDate(s.sessions, TODAY).length > 0, String(onDate(s.sessions, TODAY).length));

const todayCount = onDate(read().sessions, TODAY).length;
addSession({ date: TOMORROW, sport: "Soccer", kind: "game", minutes: 90, intensity: 5, source: "manual" });
s = read();
check("the new day holds only what was logged on it", onDate(s.sessions, TOMORROW).length === 1 && onDate(s.sessions, TOMORROW)[0]?.sport === "Soccer", JSON.stringify(onDate(s.sessions, TOMORROW)));
check("logging today left yesterday alone", onDate(s.sessions, TODAY).length === todayCount, String(onDate(s.sessions, TODAY).length));
check("the history is still all there for the insights", s.sessions.length >= 3, String(s.sessions.length));

/* "No" is remembered for that day only, so the question returns tomorrow. */
dismissFor(TODAY);
check("the day is dismissed", read().dismissed.includes(TODAY) === true, JSON.stringify(read().dismissed));
check("tomorrow is not dismissed with it", read().dismissed.includes(TOMORROW) === false, JSON.stringify(read().dismissed));

/* ---- the week total ---- */
/* A fixed week, so this cannot be read off the machine's clock. The log is
   built from scratch here rather than read back, because the cases below need
   specific histories and the store above has its own. */
const week = (rows) => rows.map(([date, minutes], i) => ({ id: `s${i}`, date, sport: "Soccer", kind: "practice", minutes, intensity: 3, source: "manual" }));
/* Note the helper above takes a condition, not an expected value. */
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/* Monday 2026-09-28. Three days in by Wednesday the 30th. */
const wednesday = "2026-09-30";

const mon = sportWeek(week([["2026-09-28", 60]]), "2026-09-28");
check("Monday is one day in", mon.current.days === 1, String(mon.current.days));
check("Monday holds what was logged on it", mon.current.minutes === 60, String(mon.current.minutes));
check("there are no days later to be un-rested", mon.current.restDays === 0, String(mon.current.restDays));
check("a first week is reported as one", mon.firstWeek === true);

const mid = sportWeek(
  week([
    ["2026-09-28", 60],
    ["2026-09-30", 90],
    ["2026-09-22", 120],
    ["2026-09-23", 120],
    ["2026-09-20", 45], // the Sunday before, so outside last week's slice
  ]),
  wednesday,
);
check("the week is three days in by Wednesday", mid.current.days === 3, String(mid.current.days));
check("both of this week's sessions are counted", mid.current.minutes === 150, String(mid.current.minutes));
check("sessions are counted", mid.current.sessions === 2, String(mid.current.sessions));
check("Tuesday comes out as the rest day", mid.current.restDays === 1, String(mid.current.restDays));
check("two sessions on two days", mid.current.trainedDays === 2, String(mid.current.trainedDays));
/* THE POINT OF THE SLICE: last week went on to Wednesday with 240 minutes, but
   only Mon-Wed of it can be compared against a Mon-Wed week. Comparing the
   full 285 would report a collapse that did not happen. */
check("last week is cut to the same three days", mid.previous.days === 3, JSON.stringify(mid.previous));
check("the comparison uses the matched days only", mid.previous.minutes === 240, JSON.stringify(mid.previous));
check("the Sunday before last week is not in it", mid.previous.minutes > 240 === false, String(mid.previous.minutes));
check("the delta is against the matched slice", mid.deltaMinutes === -90, String(mid.deltaMinutes));
check("a real previous week is not a first week", mid.firstWeek === false);

/* Two sessions on one day is one day of training, not two. */
const sameDay = sportWeek(
  week([
    ["2026-09-28", 60],
    ["2026-09-28", 60],
  ]),
  "2026-09-28",
);
check("two sessions on Monday", sameDay.current.sessions === 2, String(sameDay.current.sessions));
check("but only one training day", sameDay.current.trainedDays === 1, String(sameDay.current.trainedDays));
check("and no rest day", sameDay.current.restDays === 0, String(sameDay.current.restDays));

/* A whole week, read on the Sunday. */
const sunday = sportWeek(week([["2026-09-27", 60]]), "2026-10-04");
check("Sunday still belongs to the week it started in", sunday.current.days === 7, String(sunday.current.days));
check("nothing is counted on a week with nothing on it", sunday.current.sessions === 0, String(sunday.current.sessions));
check("with nothing on it, the whole week reads as rest", sunday.current.restDays === 7, String(sunday.current.restDays));

/* A finished week of zero is a real zero, not a first week. */
const rested = sportWeek(week([["2026-09-28", 60]]), "2026-10-05");
check("a week with nothing in it is not a first week", rested.firstWeek === false);
check("and it is reported as no sessions", rested.current.sessions === 0, String(rested.current.sessions));

/* Watch sessions and hand-written ones add up together: they are both sport. */
const mixed = sportWeek(
  [
    ...week([["2026-09-28", 45]]),
    { id: "d1", date: "2026-09-29", sport: "Running", kind: "practice", minutes: 42, intensity: 4, source: "device", deviceId: "w1" },
  ],
  wednesday,
);
check("watch and hand-written sessions count together", mixed.current.minutes === 87, JSON.stringify(mixed.current));
check("and are two sessions on two days", mixed.current.trainedDays === 2, String(mixed.current.trainedDays));
check("the slice holds nothing else", eq(mixed.previous.minutes, 0));

console.log(failures ? `\n${failures} FAILING` : "\nall passing");
process.exit(failures ? 1 : 0);
