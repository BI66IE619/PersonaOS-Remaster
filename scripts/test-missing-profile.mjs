/**
 * Regression test for the missing-profile foreign key failure.
 *
 * The failure: finance_connections.user_id references profiles.id, but the profile
 * is created lazily by /api/me. A user who signed in and went straight to the money
 * screen never runs that route, so the connect insert failed with a unique-violation
 * message that gave no hint the real problem was a missing parent row.
 *
 * Reproduces the shape — a user id with no profiles row — and asserts that the
 * finance write path creates the profile first. Runs against the live database,
 * because the constraint is what is under test, not the TypeScript.
 *
 * Uses a synthetic user id and cleans up everything it creates. No SimpleFIN
 * credential is involved: this exercises the FK, not the token exchange.
 */
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL not set");

const sql = postgres(url, { max: 1, connect_timeout: 15 });

const USER = "00000000-0000-4000-8000-0000000000f1";
let fail = 0;

function check(name, ok, detail = "") {
  if (ok) {
    console.log(`  ok   ${name}`);
  } else {
    fail++;
    console.log(`  FAIL ${name}${detail ? `  ${detail}` : ""}`);
  }
}

async function cleanup() {
  await sql`
    delete from finance_transactions where user_id = ${USER}
  `;
  await sql`
    delete from finance_accounts where user_id = ${USER}
  `;
  await sql`
    delete from finance_connections where user_id = ${USER}
  `;
  await sql`
    delete from notes where user_id = ${USER}
  `;
  await sql`
    delete from profiles where id = ${USER}
  `;
}

await cleanup();

console.log("preconditions");
  /* postgres.js resolves a query to the rows array directly, not to { rows }.
     Note the array also carries its own `count` property (rows affected), so a
     `const { count } = await sql...` reads that instead of the aliased column and
     silently reports the row count as the value. */
  const existing = await sql`select id from profiles where id = ${USER}`;
  check("synthetic user has no profile row", existing.length === 0, `found ${existing.length}`);

  let rejected = false;
  try {
    await sql`insert into finance_connections (user_id, access_url) values (${USER}, 'v1.x')`;
  } catch (e) {
    rejected = /foreign key|profiles/i.test(String(e.message ?? e));
  }
  check("insert rejected without a profile", rejected);

console.log("\nafter ensureProfile");
/* Mirrors ensureProfile in src/lib/dal.ts: insert-or-nothing, then read back. */
await sql`insert into profiles (id) values (${USER}) on conflict do nothing`;
const rows = await sql`select id from profiles where id = ${USER}`;
check("profile created", rows.length === 1);

await sql`insert into finance_connections (user_id, access_url) values (${USER}, 'v1.x') on conflict (user_id) do update set access_url = excluded.access_url`;
const conns = await sql`select user_id from finance_connections where user_id = ${USER}`;
check("finance connect insert now succeeds", conns.length === 1);

console.log("\nrace safety");
/* Two connects arriving together both try to create the profile. on conflict do
   nothing is what keeps the second one from failing on the primary key. */
const results = await Promise.allSettled([
  sql`insert into profiles (id) values (${USER}) on conflict do nothing`,
  sql`insert into profiles (id) values (${USER}) on conflict do nothing`,
]);
check(
  "concurrent profile creation does not error",
  results.every((r) => r.status === "fulfilled"),
);

console.log(`\n${fail === 0 ? "all passed" : `${fail} failed`}`);
await cleanup();
await sql.end();
process.exit(fail === 0 ? 0 : 1);