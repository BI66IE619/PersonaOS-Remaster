/**
 * Direct tests for the weight log store. The browser suite in test-weight.mjs
 * drives the panel; this covers the parts a click cannot reach, chiefly the
 * migration of days that were briefly stored as a list of readings.
 *
 * Needs a localStorage, so it is faked before the store module loads. Note that
 * createStore caches its parsed value per module instance and only re-reads on a
 * storage event, so this file cannot "reset" the store between cases: each block
 * uses its own dates instead. The migration cases need the opposite — a genuinely
 * fresh load of the module against a pre-seeded storage — so those run in child
 * processes, which is also what an existing user gets.
 */
const backing = new Map();
globalThis.window = globalThis;
globalThis.localStorage = {
  getItem: (k) => (backing.has(k) ? backing.get(k) : null),
  setItem: (k, v) => void backing.set(k, String(v)),
  removeItem: (k) => void backing.delete(k),
  clear: () => backing.clear(),
  key: (i) => [...backing.keys()][i] ?? null,
  get length() {
    return backing.size;
  },
};

const { CADENCE_DAYS, latestLogged, logWeight, removeWeight, weightDue } = await import(
  "../src/lib/weight-log.ts"
);

const KEY = "personaos:weight-log";
let failed = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    failed++;
    console.log(`  FAIL ${name}: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
  } else {
    console.log(`  ok   ${name}`);
  }
}

const saved = () => JSON.parse(backing.get(KEY) ?? "{}");

/* --------------------------------------------------------- one per day */
const DAY = "2026-09-29";
logWeight(DAY, 148.1);
/* Weighing in again the same day corrects the first reading. A second reading
   cannot show a trend — it is the same day twice — so stacking would only make
   the number look busier than the evidence is. */
logWeight(DAY, 147.6);
check("a second reading the same day corrects it", saved()[DAY], 147.6);
check("the day holds one value, not a list", Array.isArray(saved()[DAY]), false);

logWeight("2026-09-30", 147);
check("another day is its own entry", saved()["2026-09-30"], 147);
check("the first day is untouched", saved()[DAY], 147.6);

/* Rounding happens before storage, so 147.64 and 147.6 are one reading. */
const ROUND = "2026-09-25";
logWeight(ROUND, 147.604);
check("a reading is rounded to a tenth", saved()[ROUND], 147.6);

logWeight(ROUND, 0);
logWeight(ROUND, -5);
logWeight(ROUND, Number.NaN);
check("junk is not written over a real reading", saved()[ROUND], 147.6);

/* ------------------------------------------------------------- removal */
const GONE = "2026-10-05";
logWeight(GONE, 152.2);
removeWeight(GONE);
check("removing clears the day", saved()[GONE], undefined);
removeWeight(GONE);
check("removing a day that is not there changes nothing", Object.keys(saved()).includes(GONE), false);

/* ------------------------------------------------------------- helpers */
logWeight("2026-11-01", 150);
logWeight("2026-11-10", 149.4);
check("the latest logged reading", latestLogged(saved(), "2026-11-20"), 149.4);
check("a future-dated reading is not the latest", latestLogged({ ...saved(), "2026-12-01": 100 }, "2026-11-20"), 149.4);
check("nothing logged has no latest", latestLogged({}, "2026-11-20"), null);

/* ------------------------------------------------------------- the cadence */
check("nothing logged means due", weightDue({}, "2026-09-29").due, true);
const FRESH = "2026-11-02";
logWeight(FRESH, 149);
check("a fresh weigh-in is not due", weightDue(saved(), FRESH).due, false);
check("the cadence is still a fortnight", CADENCE_DAYS, 14);
check("a future-dated reading cannot suppress the prompt forever", weightDue({ "2030-01-01": 140 }, FRESH).due, true);

/* ---------------------------------------------------------------- migration */
/* A fresh module against a pre-seeded storage. */
const PROBE = `
  const seed = process.argv[1];
  const m = new Map([["personaos:weight-log", seed]]);
  globalThis.window = globalThis;
  globalThis.localStorage = {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => void m.set(k, String(v)),
    removeItem: (k) => void m.delete(k),
    clear: () => m.clear(),
    key: (i) => [...m.keys()][i] ?? null,
    get length() { return m.size; },
  };
  const w = await import("./src/lib/weight-log.ts");
  process.stdout.write(JSON.stringify({ snap: w.getSnapshot(), due: w.weightDue(w.getSnapshot(), "2026-09-29") }));
`;
const { execFileSync } = await import("node:child_process");
function freshLoad(seed) {
  const out = execFileSync(
    process.execPath,
    ["--experimental-strip-types", "--no-warnings", "--import", "./scripts/ts-alias.mjs", "--input-type=module", "-e", PROBE, seed],
    { encoding: "utf8" },
  );
  return JSON.parse(out);
}

const plain = freshLoad(JSON.stringify({ "2026-09-01": 140, "2026-09-15": 138.5, "2026-09-29": 136 }));
check("an ordinary log is untouched", plain.snap, { "2026-09-01": 140, "2026-09-15": 138.5, "2026-09-29": 136 });
check("a migrated day still counts toward the cadence", plain.due.due, false);

/* Days logged while several readings a day were allowed came back as a list.
   The last reading is the one the old panel showed as that day's number, so
   nothing logged in the meantime is lost. */
const listed = freshLoad(JSON.stringify({ "2026-09-01": [140, 141.5, 139.8], "2026-09-15": [138.5], "2026-09-29": 136 }));
check("a day stored as a list collapses to its last reading", listed.snap, { "2026-09-01": 139.8, "2026-09-15": 138.5, "2026-09-29": 136 });
check("no list survives the migration", Object.values(listed.snap).some(Array.isArray), false);

/* Junk in either shape is dropped rather than carried into the log. */
const junk = freshLoad(JSON.stringify({ "2026-09-01": 0, "2026-09-02": [140, -5, "150", null], "2026-09-03": [], "2026-09-04": [0, -2] }));
check("a junk-only day is dropped", junk.snap["2026-09-01"], undefined);
check("a list of only junk is dropped", junk.snap["2026-09-04"], undefined);
check("an empty list is dropped", junk.snap["2026-09-03"], undefined);
check("junk inside a list is dropped", junk.snap["2026-09-02"], 140);
check("only real readings remain", Object.keys(junk.snap), ["2026-09-02"]);

const broken = freshLoad("{not json");
check("malformed storage falls back to empty rather than throwing", broken.snap, {});

console.log(failed ? `\n${failed} FAILING` : "\nall passing");
process.exit(failed ? 1 : 0);
