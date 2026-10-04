/**
 * Verifies the RLS migration actually does what 0001 claims.
 *
 * Both halves matter and they pull in opposite directions:
 *
 *   1. The app connects as postgres, and 0001 uses FORCE ROW LEVEL SECURITY, which
 *      makes RLS apply to the table owner too. If that combination locked the app
 *      out of its own tables, every screen would 500. So prove postgres still reads
 *      and writes.
 *
 *   2. anon and authenticated are granted access by Supabase, and the publishable
 *      key that identifies them is in the client bundle. With RLS on and policies
 *      scoped to auth.uid(), they should see nothing. So prove anon reads zero rows
 *      and cannot insert into someone else's account.
 *
 * Writes go to a scratch row keyed to a random user id and are removed at the end,
 * so this is safe to run against a live database.
 */
import postgres from "postgres";
import nextEnv from "@next/env";
import { randomUUID } from "node:crypto";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");

const sql = postgres(url, { max: 1, connect_timeout: 15 });
const failures = [];
const clientId = randomUUID();

/* notes is a synced table: day, text and client_id are all NOT NULL. An insert
   that omits them fails on a constraint violation, which is an error, not a failed
   RLS assertion -- and the first version of this script got that wrong. */
const NOTE = {
  day: "2026-01-01",
  text: "rls-probe",
  body: "anon-probe",
};

function check(name, condition, detail = "") {
  if (condition) {
    console.log(`  ok   ${name}`);
  } else {
    console.log(`  FAIL ${name}${detail ? ` -- ${detail}` : ""}`);
    failures.push(name);
  }
}

const userId = randomUUID();

try {
  /* The profile insert has to come first: notes.user_id references profiles.id,
     so inserting the child directly would fail on the foreign key and tell us
     nothing about RLS. */
  const profile = await sql`
    insert into profiles (id, display_name) values (${userId}, 'rls-probe')
    returning id`;
  check("app role can insert into profiles", profile.length === 1);

  const asApp = await sql`select id from notes where user_id = ${userId}`;
  check("app role can select from notes", Array.isArray(asApp));

  const note = await sql`
    insert into notes (user_id, client_id, day, text)
    values (${userId}, ${clientId}, ${NOTE.day}, ${NOTE.text})
    returning id`;
  check("app role can insert into notes", note.length === 1);

  const asAppRead = await sql`select text from notes where id = ${note[0].id}`;
  check(
    "app role reads back its own row",
    asAppRead[0]?.text === NOTE.text,
    `got ${JSON.stringify(asAppRead[0]?.text)}`,
  );

  /* Same queries as anon. SET ROLE is used rather than a second connection because
     the pooler authenticates as postgres; switching role mid-session is what
     actually exercises the policy. */
  await sql`set role anon`;

  const anonRead = await sql`select count(*)::int as n from notes`;
  check("anon sees zero notes", anonRead[0].n === 0, `saw ${anonRead[0].n}`);

  const anonProfiles = await sql`select count(*)::int as n from profiles`;
  check("anon sees zero profiles", anonProfiles[0].n === 0, `saw ${anonProfiles[0].n}`);

  const anonFinance = await sql`select count(*)::int as n from finance_connections`;
  check("anon sees zero finance_connections", anonFinance[0].n === 0, `saw ${anonFinance[0].n}`);

  /* The write that matters most: anon holding a valid-looking user_id must not be
     able to plant a row, which is the WITH CHECK half of the policy. */
  let anonInsert = "succeeded";
  try {
    await sql`insert into notes (user_id, client_id, day, text)
               values (${userId}, ${randomUUID()}, ${NOTE.day}, ${NOTE.body})`;
  } catch (e) {
    anonInsert = e.code ?? e.message;
  }
  check(
    "anon cannot insert into notes",
    anonInsert !== "succeeded",
    "insert was allowed",
  );

  /* authenticated with no JWT, so auth.uid() is null and the policy's
     user_id = auth.uid() comparison is null -- matches nothing. */
  await sql`reset role`;
  await sql`set role authenticated`;

  const authRead = await sql`select count(*)::int as n from notes`;
  check(
    "authenticated without a JWT sees zero notes",
    authRead[0].n === 0,
    `saw ${authRead[0].n}`,
  );

  let authFinance = "succeeded";
  try {
    await sql`insert into finance_connections (user_id, access_url)
               values (${userId}, 'probe')`;
  } catch (e) {
    authFinance = e.code ?? e.message;
  }
  check(
    "authenticated cannot insert into finance_connections",
    authFinance !== "succeeded",
    "insert was allowed",
  );

  await sql`reset role`;

  const surviving = await sql`select count(*)::int as n from notes
    where text = ${NOTE.body}`;
  check("no probe rows leaked through", surviving[0].n === 0, `${surviving[0].n} leaked`);
} catch (e) {
  /* Recorded rather than thrown. An unexpected throw used to be swallowed by a
     process.exit in the finally block, which printed "all passed" after two checks
     and hid the fact that most of the script never ran. */
  failures.push(`unexpected error: ${e.message}`);
  console.error(`\n  ERROR ${e.message}`);
} finally {
  await sql`delete from notes where user_id = ${userId}`.catch(() => {});
  await sql`delete from profiles where id = ${userId}`.catch(() => {});
  await sql.end();
  console.log(failures.length ? `\n${failures.length} failed` : "\nall passed");
}