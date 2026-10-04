/**
 * Reports which migrations the database has actually applied.
 *
 * Read-only. `drizzle-kit migrate` only reports what it is about to do, and the
 * failure this guards against is quieter than that: if 0000 was applied by hand or
 * by an earlier `db push`, the migrator treats the tables as done and moves on,
 * which is correct, but it is not something you can tell by reading the files.
 */
import postgres from "postgres";
import nextEnv from "@next/env";

/* @next/env is CommonJS, so the named import is not available under ESM. */
const { loadEnvConfig } = nextEnv;

loadEnvConfig(process.cwd());

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");

/* postgres.js rather than pg, because that is the driver src/db/index.ts uses.
   Two drivers means two sets of type coercion and SSL defaults, and the status
   this reports is only trustworthy if it came back over the same one the app
   will. */
const sql = postgres(url, { max: 1, connect_timeout: 15 });

try {
  /* Before anything else: confirm which database this is. A Supabase pooler URL
     carries the database in its path, and pointing at the wrong project, or at
     `postgres` on the wrong host, is the failure that makes every later line of
     this report describe somebody else's database. */
  const who = await sql`
    select current_database() as db, current_user as usr,
           inet_server_addr()::text as host, inet_server_port() as port`;
  const w = who[0];
  /* The password is not printed. The URL is not printed either. */
  console.log(`connected to database "${w.db}" as "${w.usr}" on ${w.host}:${w.port}`);

  const schemas = await sql`select nspname from pg_namespace
    where nspname not like 'pg_%' and nspname <> 'information_schema'
    order by nspname`;
  console.log(`schemas: ${schemas.map((s) => s.nspname).join(", ")}`);

  const tables = await sql`select schemaname, tablename from pg_tables
    where schemaname not in ('pg_catalog', 'information_schema')
    order by schemaname, tablename`;
  console.log(`\ntables: ${tables.length}`);
  for (const t of tables) console.log(`  ${t.schemaname}.${t.tablename}`);

  /* to_regclass rather than a plain query: 0000 has not necessarily run, and
     asking for the migrations table directly would throw and abort the report. */
  const hasLedger = await sql`select to_regclass('drizzle.__drizzle_migrations') as reg`;
  if (!hasLedger[0].reg) {
    console.log("\nmigrations recorded: none (drizzle schema does not exist)");
  } else {
    const applied = await sql`select created_at from drizzle.__drizzle_migrations
      order by created_at`;
    console.log(`\nmigrations recorded: ${applied.length}`);
    /* drizzle stores created_at as bigint milliseconds, which postgres.js returns
       as a string. Date would also be wrong, since new Date("1759...") is invalid. */
    for (const m of applied) console.log(`  ${new Date(Number(m.created_at)).toISOString()}`);
  }

  const rls = await sql`
    select c.relname, c.relrowsecurity, c.relforcerowsecurity
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
    order by c.relname`;
  const guarded = rls.filter((r) => r.relrowsecurity);
  console.log(`\ntables with RLS enabled: ${guarded.length} of ${rls.length}`);
  for (const r of guarded) {
    console.log(`  ${r.relname}${r.relforcerowsecurity ? " (forced)" : ""}`);
  }

  const policies = await sql`
    select tablename from pg_policies
    where schemaname = 'public' order by tablename`;
  const perTable = {};
  for (const p of policies) perTable[p.tablename] = (perTable[p.tablename] ?? 0) + 1;
  console.log(`\ntables with policies: ${Object.keys(perTable).length}`);
  for (const [table, count] of Object.entries(perTable)) {
    console.log(`  ${table}: ${count}`);
  }

  /* finance_connections does not exist until 0000 runs, so this is guarded too.
     A thrown error here would be the first sign the table is missing, but it
     would arrive as an exception rather than as the report's actual subject. */
  const hasConn = await sql`select to_regclass('public.finance_connections') as reg`;
  if (!hasConn[0].reg) {
    console.log("\nfinance_connections: table does not exist");
  } else {
    const conn = await sql`select count(*)::int as n from finance_connections`;
    console.log(`\nfinance_connections rows: ${conn[0].n}`);
  }
} finally {
  await sql.end();
}