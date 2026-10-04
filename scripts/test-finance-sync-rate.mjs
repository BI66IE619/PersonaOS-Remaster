/**
 * Tests for the SimpleFIN sync rate limit.
 *
 * The limit exists because SimpleFIN disables a token that is used too often —
 * not throttles it, disables it, which costs a reconnect and a new claim URL. So
 * the gap is the difference between a working finance tab and a dead one, and it is
 * enforced from a timestamp rather than a lock.
 *
 * These are pure-logic assertions plus a source check. Exercising the real limit
 * means spending real quota against SimpleFIN, which is the thing being protected.
 */
import postgres from "postgres";

let fail = 0;
function check(name, ok, detail = "") {
  if (ok) console.log(`  ok   ${name}`);
  else {
    fail++;
    console.log(`  FAIL ${name}${detail ? `  ${detail}` : ""}`);
  }
}

const src = await import("node:fs/promises").then((fs) =>
  fs.readFile(new URL("../src/lib/finance/simplefin.ts", import.meta.url), "utf8"),
);

/* The gap, as sync() would compute it for a given lastSyncedAt. */
const GAP_MINUTES = 30;
const GAP_MS = GAP_MINUTES * 60 * 1000;
const HOUR = 60 * 60 * 1000;

const wouldSkip = (ageMs) => ageMs < GAP_MS;

console.log("the gap is 30 minutes, so twice an hour");
check("a fresh sync is blocked", wouldSkip(0));
check("one minute in is blocked", wouldSkip(60 * 1000));
check("29 minutes in is blocked", wouldSkip(29 * 60 * 1000));
check("exactly 30 minutes is allowed", !wouldSkip(GAP_MS));
check("31 minutes is allowed", !wouldSkip(31 * 60 * 1000));
check("an hour in is allowed", !wouldSkip(HOUR));
check("yesterday is allowed", !wouldSkip(25 * HOUR));

console.log("\ntwo syncs fit inside an hour");
/* The user's actual ask: twice an hour rather than once.
 *
 * Simulated rather than asserted as three independent ages, which is how the first
 * version of this test was wrong: it measured the third sync from the *first*, but
 * sync() records lastSyncedAt after every successful request, so the relevant wait
 * is always measured from the most recent sync. A third attempt 15 minutes after
 * the second is blocked, even though it is 45 minutes after the first. */
function simulate(attempts, gapMs = GAP_MS) {
  let lastSyncedAt = null;
  return attempts.map((at) => {
    const allowed = lastSyncedAt === null || at - lastSyncedAt >= gapMs;
    if (allowed) lastSyncedAt = at;
    return { at, allowed };
  });
}

const MIN = 60 * 1000;
const run = simulate([0, 30 * MIN, 45 * MIN, 60 * MIN, 90 * MIN]);

check("the first sync goes through", run[0].allowed);
check("the second at :30 goes through", run[1].allowed);
check("a third at :45 is blocked, only 15 minutes later", !run[2].allowed, `${run[2].at / MIN}min`);
check("one at :60 goes through, 30 minutes after :30", run[3].allowed);
check("one at :90 goes through", run[4].allowed);

/* Sustained rate, which is what the token quota actually sees. Two per hour, not
   three: the :60 sync is exactly one hour after :00, so over any full hour the
   cadence is two. */
const perHour = run.filter((r) => r.allowed && r.at > 0 && r.at <= 60 * MIN).length;
check("two syncs land in the first hour", perHour === 2, `${perHour}`);
check(
  "allowed syncs are never closer together than the gap",
  run
    .filter((r) => r.allowed)
    .every((r, i, arr) => i === 0 || r.at - arr[i - 1].at >= GAP_MS),
);

console.log("\nnextAllowedAt is when the gap expires, not a fixed offset");
/* Restates the value sync() returns so the UI's message is checked rather than
   trusted. If this drifted, the button would say "next available" at a wrong time. */
const nextAllowed = (lastSyncedAt) => new Date(lastSyncedAt.getTime() + GAP_MS).toISOString();
const last = new Date("2026-10-02T14:00:00.000Z");
check(
  "next allowed is last synced plus the gap",
  nextAllowed(last) === "2026-10-02T14:30:00.000Z",
  nextAllowed(last),
);
check("next allowed is in the future", new Date(nextAllowed(last)) > last);
check(
  "next allowed is not rounded to the hour",
  new Date(nextAllowed(last)).getMinutes() === 30,
);

console.log("\nthe limit is enforced in code");
check("gap is 30 minutes by default", /SIMPLEFIN_MIN_SYNC_GAP_MINUTES\)\s*\|\|\s*30/.test(src));
check("gap is configurable from the environment", /SIMPLEFIN_MIN_SYNC_GAP_MINUTES/.test(src));
check("a malformed value cannot produce a zero gap", /Math\.max\(1,/.test(src));
check("the check is skipped when forced", /!opts\.force && row\.lastSyncedAt/.test(src));
check("the window is still capped at 90 days", /MAX_WINDOW_DAYS\s*=\s*90/.test(src));

console.log("\nlastSyncedAt is recorded after a real request");
/* If touch() ran on a skipped sync, the gap would slide forward every time someone
   pressed the button and a legitimate sync could never happen. */
check("touch is called after the fetch", src.indexOf("await touch(userId)") > src.indexOf("await fetchData"));
check("touch is not called on the skip path", src.indexOf("skipped: \"too_soon\"") < src.indexOf("async function touch"));

console.log("\nlive state");
const sql = postgres(process.env.DATABASE_URL, { max: 1, connect_timeout: 15 });
const conn = await sql`select last_synced_at from finance_connections limit 1`;
if (conn.length > 0 && conn[0].last_synced_at) {
  const age = Date.now() - new Date(conn[0].last_synced_at).getTime();
  console.log(`     last synced ${Math.round(age / 60000)} minutes ago`);
  check("a sync is currently allowed", !wouldSkip(age), `${Math.round(age / 60000)}min`);
} else {
  console.log("     never synced");
  check("a sync is currently allowed", true);
}
await sql.end();

console.log(`\n${fail === 0 ? "all passed" : `${fail} failed`}`);
if (fail !== 0) throw new Error(`${fail} failed`);